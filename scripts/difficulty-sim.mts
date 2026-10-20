/**
 * CPUの難易度の強さを測る。「難易度Aの1人 対 難易度Bの3人」の東風戦を回して、Aの成績を出す。
 *
 *   npm run difficulty-sim -- <A:1-5> <B:1-5> <対局数> [seed]
 *   例) npm run difficulty-sim -- 5 2 100 1     Lv5の1人 対 Lv2の3人を100戦
 *
 * Aの席は対局ごとに持ち回り。キャラ・カードは付けない（打牌・鳴き・押し引きの強さだけを見る）。
 * 4人が互角なら平均順位は2.5。誤差の目安は 平均順位の ±(2.2 / √対局数)。
 * 1戦に4〜6秒かかるので、数を増やすときは seed を変えて並列に回して合算する。
 * （balance-sim.mts はキャラ・カードの強さを測るもので、全員が同じ難易度で打つ。）
 */
import {
  advanceToNextRound, applyMatchAction, createMatch, decideCpuCallResponse, decideCpuTurnAction,
  pendingDecision, settleRound, type AiDifficulty, type PlayerIndex,
} from "@majyan/core";

const SEATS: readonly PlayerIndex[] = [0, 1, 2, 3];
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const subject = Number(process.argv[2]) as AiDifficulty;
const field = Number(process.argv[3]) as AiDifficulty;
const matches = Number(process.argv[4]);
const rng = makeRng(Number(process.argv[5] ?? 1));
const places = [0, 0, 0, 0];
let wins = 0, dealIns = 0, rounds = 0, scoreSum = 0;
const t0 = Date.now();
for (let m = 0; m < matches; m++) {
  const subjSeat = SEATS[m % 4]!;
  const level = (seat: number) => (seat === subjSeat ? subject : field);
  let match = createMatch("tonpuusen", rng, ["", "", "", ""], false, [null, null, null, null]);
  let steps = 0;
  while (!match.finished) {
    const d = pendingDecision(match.round);
    if (d.kind === "round-over") {
      const end = match.round.result!;
      rounds++;
      if ((end.type === "tsumo" || end.type === "ron") && end.winners.includes(subjSeat)) wins++;
      if (end.type === "ron" && end.loser === subjSeat) dealIns++;
      match = settleRound(match).match;
      if (!match.finished) match = advanceToNextRound(match, rng, SEATS);
      steps = 0;
      continue;
    }
    if (++steps > 5000 || d.kind === "none") throw new Error("stuck");
    const action =
      d.kind === "draw" ? ({ type: "draw", player: d.seat } as const)
      : d.kind === "turn" ? decideCpuTurnAction(match.round, d.seat, level(d.seat))
      : decideCpuCallResponse(match.round, d.seat, level(d.seat));
    match = applyMatchAction(match, action).match;
  }
  places[match.finalRanking!.indexOf(subjSeat)]!++;
  scoreSum += match.scores[subjSeat];
}
const mean = places.reduce((s, n, i) => s + n * (i + 1), 0) / matches;
console.log(`Lv${subject} vs Lv${field}x3 : ${matches}戦 平均順位 ${mean.toFixed(3)} 1位${(places[0]! / matches * 100).toFixed(1)}% 4位${(places[3]! / matches * 100).toFixed(1)}% 和了率${(wins / rounds * 100).toFixed(1)}% 放銃率${(dealIns / rounds * 100).toFixed(1)}% 平均点${Math.round(scoreSum / matches)} (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
