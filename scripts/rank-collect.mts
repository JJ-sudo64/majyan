/**
 * 段位戦のポイント設計用に、「難易度Aの1人 対 難易度Bの3人」の対局を回して、
 * Aの (順位, 終局時の持ち点) を1戦ごとに記録する（rank-analyze.mts がこれを読む）。
 *
 *   npx tsx scripts/rank-collect.mts <A:1-5> <B:1-5> <東風戦tonpuusen|半荘hanchan> <対局数> <seed> <出力.json>
 *
 * difficulty-sim.mts と同じ打ち方（キャラ・カードなし、Aの席は持ち回り）。
 * 並列に回すときは seed を変えて別ファイルに出し、rank-analyze 側で合算する。
 */
import { writeFileSync } from "node:fs";
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
const format = process.argv[4] as "tonpuusen" | "hanchan";
const matches = Number(process.argv[5]);
const rng = makeRng(Number(process.argv[6] ?? 1));
const out = process.argv[7]!;
const records: [number, number][] = []; // [順位1-4, 持ち点]
const t0 = Date.now();
for (let m = 0; m < matches; m++) {
  const subjSeat = SEATS[m % 4]!;
  const level = (seat: number) => (seat === subjSeat ? subject : field);
  let match = createMatch(format, rng, ["", "", "", ""], false, [null, null, null, null]);
  let steps = 0;
  while (!match.finished) {
    const d = pendingDecision(match.round);
    if (d.kind === "round-over") {
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
  records.push([match.finalRanking!.indexOf(subjSeat) + 1, match.scores[subjSeat]!]);
  if (out) writeFileSync(out, JSON.stringify({ subject, field, format, records }));
}
console.log(`Lv${subject} vs Lv${field}x3 ${format} ${matches}戦 ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
