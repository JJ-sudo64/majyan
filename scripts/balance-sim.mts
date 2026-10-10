/**
 * キャラ・カードの強さを、CPU同士の対局を大量に回して測る。
 *
 *   npm run balance -- [--matches 2000] [--format tonpuusen|hanchan] [--difficulty 1-5]
 *                      [--workers 6] [--seed 1] [--json 出力先.json]
 *
 * 毎回4席にキャラとカード（「なし」も含む）を無作為に配り、最後の順位を席ごとに集める。
 * キャラとカードは互いに無関係に配るので、キャラの表はカードの影響を、カードの表はキャラの
 * 影響を平均でならしたものになる。
 *
 * 読み方の注意:
 * - 打っているのはCPU（simpleAi）。必殺技は「使えるなら即使う」ので、使いどころを選ぶと
 *   強い技は低めに、いつ使っても得な技は高めに出る。人が打った時の強さそのものではない
 * - 平均順位の誤差の目安は 1.12 / √対局数（表の ± は標準誤差の2倍）。差がそれより
 *   小さければ「違いがあるとは言えない」
 */
import { fork } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import {
  advanceToNextRound,
  applyMatchAction,
  CARD_IDS,
  CARDS,
  cardRarity,
  CHARACTER_IDS,
  CHARACTERS,
  characterRarity,
  createMatch,
  decideCpuCallResponse,
  decideCpuTurnAction,
  pendingDecision,
  settleRound,
  type AiDifficulty,
  type MatchFormat,
  type PlayerIndex,
} from "@majyan/core";

const SEATS: readonly PlayerIndex[] = [0, 1, 2, 3];
/** カードを持たない席も混ぜる（カード全体が「なし」よりどれだけ得かの基準になる）。 */
const NO_CARD = "(なし)";
/** 1局がこの手数を超えたら異常として止める。 */
const MAX_STEPS_PER_ROUND = 5000;

interface Tally {
  games: number;
  /** 1位〜4位の回数。 */
  places: [number, number, number, number];
  scoreSum: number;
  rounds: number;
  wins: number;
  dealIns: number;
}

interface Result {
  matches: number;
  rounds: number;
  characters: Record<string, Tally>;
  cards: Record<string, Tally>;
}

const emptyTally = (): Tally => ({ games: 0, places: [0, 0, 0, 0], scoreSum: 0, rounds: 0, wins: 0, dealIns: 0 });
const emptyResult = (): Result => ({ matches: 0, rounds: 0, characters: {}, cards: {} });

function makeRng(seed: number): () => number {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(matches: number, format: MatchFormat, difficulty: AiDifficulty, seed: number): Result {
  const rng = makeRng(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)]!;
  const cardChoices: (string | null)[] = [null, ...CARD_IDS];
  const result = emptyResult();

  for (let m = 0; m < matches; m++) {
    const characterIds = SEATS.map(() => pick(CHARACTER_IDS)) as [string, string, string, string];
    const cardIds = SEATS.map(() => pick(cardChoices)) as [string | null, string | null, string | null, string | null];
    const tallies = SEATS.map((seat) => [
      (result.characters[characterIds[seat]] ??= emptyTally()),
      (result.cards[cardIds[seat] ?? NO_CARD] ??= emptyTally()),
    ]);
    let match = createMatch(format, rng, characterIds, false, cardIds);
    let steps = 0;

    while (!match.finished) {
      const decision = pendingDecision(match.round);
      if (decision.kind === "round-over") {
        const end = match.round.result!;
        result.rounds++;
        for (const seat of SEATS) {
          for (const t of tallies[seat]!) {
            t.rounds++;
            if ((end.type === "tsumo" || end.type === "ron") && end.winners.includes(seat)) t.wins++;
            if (end.type === "ron" && end.loser === seat) t.dealIns++;
          }
        }
        match = settleRound(match).match;
        if (!match.finished) match = advanceToNextRound(match, rng, SEATS);
        steps = 0;
        continue;
      }
      if (++steps > MAX_STEPS_PER_ROUND || decision.kind === "none") {
        throw new Error(`局が進みません（seed=${seed} 対局${m} ${characterIds.join(",")} / ${cardIds.join(",")}）`);
      }
      const action =
        decision.kind === "draw"
          ? ({ type: "draw", player: decision.seat } as const)
          : decision.kind === "turn"
            ? decideCpuTurnAction(match.round, decision.seat, difficulty)
            : decideCpuCallResponse(match.round, decision.seat, difficulty);
      match = applyMatchAction(match, action).match;
    }

    result.matches++;
    match.finalRanking!.forEach((seat, index) => {
      for (const t of tallies[seat]!) {
        t.games++;
        t.places[index]!++;
        t.scoreSum += match.scores[seat];
      }
    });
  }
  return result;
}

function merge(into: Result, from: Result): Result {
  into.matches += from.matches;
  into.rounds += from.rounds;
  for (const key of ["characters", "cards"] as const) {
    for (const [id, t] of Object.entries(from[key])) {
      const target = (into[key][id] ??= emptyTally());
      target.games += t.games;
      target.scoreSum += t.scoreSum;
      target.rounds += t.rounds;
      target.wins += t.wins;
      target.dealIns += t.dealIns;
      t.places.forEach((n, i) => (target.places[i]! += n));
    }
  }
  return into;
}

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`.padStart(6);

function table(title: string, tallies: Record<string, Tally>, label: (id: string) => string): string[] {
  const rows = Object.entries(tallies)
    .map(([id, t]) => {
      const mean = t.places.reduce((sum, n, i) => sum + n * (i + 1), 0) / t.games;
      const variance = t.places.reduce((sum, n, i) => sum + n * (i + 1 - mean) ** 2, 0) / t.games;
      return { id, t, mean, margin: 2 * Math.sqrt(variance / t.games) };
    })
    .sort((a, b) => a.mean - b.mean);
  const lines = [``, `■ ${title}（平均順位の良い順）`, `  平均順位   ±    1位率  4位率  和了率  放銃率  平均点  対局数  名前`];
  for (const { id, t, mean, margin } of rows) {
    lines.push(
      `  ${mean.toFixed(3)}  ${margin.toFixed(3)}  ${pct(t.places[0], t.games)} ${pct(t.places[3], t.games)} ${pct(t.wins, t.rounds)} ${pct(t.dealIns, t.rounds)}  ${String(Math.round(t.scoreSum / t.games)).padStart(6)}  ${String(t.games).padStart(6)}  ${label(id)}`,
    );
  }
  return lines;
}

function report(result: Result): string[] {
  const stars = (n: number) => "★".repeat(n).padEnd(3, "　");
  return [
    `対局 ${result.matches}、局 ${result.rounds}（1対局あたり ${(result.rounds / result.matches).toFixed(1)} 局）`,
    ...table("キャラ", result.characters, (id) => `${stars(characterRarity(id))} ${CHARACTERS[id]?.name ?? id} (${id})`),
    ...table("カード", result.cards, (id) => (id === NO_CARD ? `　　　 ${NO_CARD}` : `${stars(cardRarity(id))} ${CARDS[id]?.name ?? id} (${id})`)),
  ];
}

const { values } = parseArgs({
  options: {
    matches: { type: "string", default: "2000" },
    format: { type: "string", default: "tonpuusen" },
    difficulty: { type: "string", default: "2" },
    workers: { type: "string" },
    seed: { type: "string", default: "1" },
    json: { type: "string" },
    // 内部用: 子プロセスとして1かたまりを回し、結果を親へ送る。
    child: { type: "boolean" },
  },
});
const matches = Number(values.matches);
const format = values.format as MatchFormat;
const difficulty = Number(values.difficulty) as AiDifficulty;
const seed = Number(values.seed);
if (!Number.isInteger(matches) || matches <= 0 || !["tonpuusen", "hanchan"].includes(format) || ![1, 2, 3, 4, 5].includes(difficulty) || !Number.isInteger(seed)) {
  console.error("使い方: npm run balance -- [--matches 数] [--format tonpuusen|hanchan] [--difficulty 1-5] [--workers 数] [--seed 数] [--json ファイル]");
  process.exit(1);
}

if (values.child) {
  process.send!(simulate(matches, format, difficulty, seed));
} else {
  const workers = Math.max(1, Math.min(matches, Number(values.workers) || Math.max(1, availableParallelism() - 2)));
  const started = Date.now();
  const share = Math.ceil(matches / workers);
  const parts = await Promise.all(
    Array.from({ length: workers }, (_, i) => {
      const count = Math.min(share, matches - share * i);
      if (count <= 0) return Promise.resolve(emptyResult());
      return new Promise<Result>((resolve, reject) => {
        const child = fork(import.meta.filename, [
          "--child",
          "--matches",
          String(count),
          "--format",
          format,
          "--difficulty",
          String(difficulty),
          "--seed",
          String(seed * 1000 + i),
        ]);
        child.once("message", (message) => resolve(message as Result));
        child.once("error", reject);
        child.once("exit", (code) => code !== 0 && reject(new Error(`子プロセスが失敗しました（${code}）`)));
      });
    }),
  );
  const result = parts.reduce(merge, emptyResult());
  const lines = [`${format} / CPUの強さ ${difficulty} / seed ${seed} / ${workers} 並列 / ${((Date.now() - started) / 1000).toFixed(0)} 秒`, ...report(result)];
  console.log(lines.join("\n"));
  if (values.json) writeFileSync(values.json, JSON.stringify(result, null, 2));
}
