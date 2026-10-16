import { describe, expect, it } from "vitest";
import type { GameAction } from "../src/actions.js";
import type { MatchState } from "../src/gameState.js";
import { createMatch } from "../src/matchFormat.js";
import { advanceToNextRound, applyMatchAction, pendingDecision, settleRound } from "../src/matchController.js";
import { decideCpuCallResponse, decideCpuTurnAction } from "../src/ai/cpuPlayer.js";
import { summarizeRound } from "../src/roundStats.js";
import type { ReplayRound } from "../src/replay.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** CPU同士で1局を最後まで打ち、牌譜（局の始まりと操作の並び）と、終わった局面を返す。 */
function playRound(match: MatchState): { replay: ReplayRound; ended: MatchState } {
  const start = match;
  const actions: GameAction[] = [];
  let current = match;
  const apply = (action: GameAction) => {
    actions.push(action);
    current = applyMatchAction(current, action).match;
  };
  for (let steps = 0; pendingDecision(current.round).kind !== "round-over"; steps++) {
    if (steps > 5000) throw new Error("局が終わりません");
    const d = pendingDecision(current.round);
    if (d.kind === "draw") apply({ type: "draw", player: d.seat });
    else if (d.kind === "turn") apply(decideCpuTurnAction(current.round, d.seat));
    else if (d.kind === "call") apply(decideCpuCallResponse(current.round, d.seat));
    else throw new Error(`想定外の局面: ${d.kind}`);
  }
  return { replay: { start, actions }, ended: current };
}

describe("summarizeRound", () => {
  it("counts wins, deal-ins, riichi, open hands and win points consistently with the real round", () => {
    let wins = 0;
    let draws = 0;
    let tsumoWins = 0;
    let ronWins = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const rng = makeRng(seed * 31);
      let match = createMatch("tonpuusen", rng);
      for (let round = 0; round < 5 && !match.finished; round++) {
        const { replay, ended } = playRound(match);
        const stats = summarizeRound(replay);
        expect(stats).not.toBeNull();
        const s = stats!;
        const real = ended.round;
        const result = real.result!;
        expect(s).toHaveLength(4);
        // 親はちょうど1人で、立直・副露は実際の局面と同じ。
        expect(s.filter((x) => x.dealer)).toHaveLength(1);
        expect(s.find((x) => x.dealer)!.seat).toBe(real.dealerSeat);
        for (const x of s) {
          expect(x.riichi).toBe(real.players[x.seat]!.riichi);
          expect(x.open).toBe(real.players[x.seat]!.hand.melds.some((m) => m.type !== "ankan"));
        }
        if (result.type === "tsumo" || result.type === "ron") {
          expect(s.filter((x) => x.win).map((x) => x.seat)).toEqual([...result.winners].sort());
          for (const x of s.filter((y) => y.win)) {
            expect(x.winPoints).toBeGreaterThan(0);
            expect(x.winTurn).toBeGreaterThan(0);
            expect(x.tsumo).toBe(result.type === "tsumo");
          }
          wins += result.winners.length;
          if (result.type === "tsumo") tsumoWins++;
          else {
            ronWins++;
            expect(s.filter((x) => x.dealtIn).map((x) => x.seat)).toEqual([result.loser]);
          }
        } else {
          draws++;
          expect(s.some((x) => x.win || x.dealtIn || x.winPoints > 0)).toBe(false);
        }
        if (result.type !== "ron") expect(s.some((x) => x.dealtIn)).toBe(false);
        match = advanceToNextRound(settleRound(ended).match, rng, []);
        if (match.finished) break;
      }
    }
    // 検証が空振りにならないよう、ツモ・ロン・流局がそれぞれ出ていること。
    expect(tsumoWins).toBeGreaterThan(0);
    expect(ronWins).toBeGreaterThan(0);
    expect(draws).toBeGreaterThan(0);
    expect(wins).toBeGreaterThan(0);
  });

  it("returns null when the record stops before the round ends", () => {
    const match = createMatch("tonpuusen", makeRng(5));
    const { replay } = playRound(match);
    expect(summarizeRound({ start: replay.start, actions: replay.actions.slice(0, 5) })).toBeNull();
  });
});
