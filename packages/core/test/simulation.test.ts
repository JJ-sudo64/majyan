import { describe, expect, it } from "vitest";
import { createMatch } from "../src/matchFormat.js";
import { planNextRound, dealNewRound } from "../src/matchFormat.js";
import { applyAction, computeRoundScoreOutcome, RIICHI_STICK_COST } from "../src/gameEngine.js";
import { decideTurnAction, decideCallResponse } from "../src/ai/simpleAi.js";
import type { PlayerIndex } from "../src/actions.js";
import type { MatchFormat } from "../src/gameState.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function playFullMatch(format: MatchFormat, seed: number) {
  const rng = makeRng(seed);
  let match = createMatch(format, rng);
  let scores = match.scores;
  let iterations = 0;
  const MAX_ITERATIONS = 20000;
  let roundsPlayed = 0;

  while (iterations++ < MAX_ITERATIONS) {
    let round = match.round;

    // 1局を最後まで進める
    let roundIterations = 0;
    while (round.phase !== "round-over" && roundIterations++ < 3000) {
      if (round.phase === "awaiting-draw") {
        round = applyAction(round, { type: "draw", player: round.currentTurn });
      } else if (round.phase === "awaiting-discard") {
        const action = decideTurnAction(round, round.currentTurn);
        if (action.type === "riichi") {
          scores = scores.map((s, i) => (i === round.currentTurn ? s - RIICHI_STICK_COST : s)) as typeof scores;
        }
        round = applyAction(round, action);
      } else if (round.phase === "awaiting-calls") {
        const window = round.pendingCallWindow!;
        const next = window.awaitingPlayers.find((p) => !window.respondedBy.includes(p));
        if (next === undefined) break;
        const action = decideCallResponse(round, next);
        round = applyAction(round, action);
      } else {
        break;
      }
    }
    expect(roundIterations).toBeLessThan(3000);

    const outcome = computeRoundScoreOutcome(round);
    scores = scores.map((s, i) => s + outcome.scoreDeltas[i]!) as typeof scores;
    roundsPlayed++;

    const result = round.result!;
    const keepKyotaku = result.type !== "tsumo" && result.type !== "ron";
    const kyotakuAfter = result.type === "tsumo" || result.type === "ron" ? 0 : round.kyotaku;
    const plan = planNextRound(round, format, result.dealerContinues, keepKyotaku);

    if (plan.matchOver) {
      match = { ...match, round, scores, finished: true };
      break;
    }
    const nextRound = dealNewRound(plan.roundWind, plan.roundNumber, plan.honba, kyotakuAfter, plan.dealerSeat, rng);
    match = { ...match, round: nextRound, scores };
  }

  return { match, scores, roundsPlayed, iterations };
}

describe("full match simulation (headless, AI vs AI)", () => {
  it("plays many tonpuusen matches to completion without crashing, staying zero-sum", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const { match, scores, roundsPlayed } = playFullMatch("tonpuusen", seed * 7919);
      expect(match.finished).toBe(true);
      expect(roundsPlayed).toBeGreaterThan(0);
      const total = scores.reduce((a, b) => a + b, 0);
      expect(total).toBe(100000);
    }
  });

  it("plays a few hanchan matches to completion without crashing, staying zero-sum", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { match, scores, roundsPlayed } = playFullMatch("hanchan", seed * 104729);
      expect(match.finished).toBe(true);
      expect(roundsPlayed).toBeGreaterThan(0);
      const total = scores.reduce((a, b) => a + b, 0);
      expect(total).toBe(100000);
    }
  });
});
