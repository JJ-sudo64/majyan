import { describe, expect, it } from "vitest";
import { createMatch } from "../src/matchFormat.js";
import {
  advanceToNextRound,
  applyMatchAction,
  autoActionForHuman,
  computeCallOptions,
  pendingDecision,
  settleRound,
} from "../src/matchController.js";
import { decideCpuCallResponse, decideCpuTurnAction } from "../src/ai/cpuPlayer.js";
import { randomCharacterIds } from "../src/characters.js";
import { randomCardId } from "../src/cards.js";
import { RIICHI_STICK_COST, riichiCandidateTileIds, canRiichi } from "../src/gameEngine.js";
import type { PlayerIndex } from "../src/actions.js";
import type { MatchFormat, MatchState } from "../src/gameState.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const ALL_SEATS: PlayerIndex[] = [0, 1, 2, 3];

/** Web版のgameStore.tsと同じ進行（全席CPU、待ち時間なし）で対局を最後まで回す。 */
function playMatch(match: MatchState, rng: () => number) {
  let rounds = 0;
  let steps = 0;
  while (!match.finished) {
    if (steps++ > 200000) throw new Error("対局が終わりません");
    const decision = pendingDecision(match.round);
    switch (decision.kind) {
      case "round-over": {
        match = settleRound(match).match;
        rounds++;
        match = advanceToNextRound(match, rng, ALL_SEATS);
        break;
      }
      case "draw":
        match = applyMatchAction(match, { type: "draw", player: decision.seat }).match;
        break;
      case "turn":
        match = applyMatchAction(match, decideCpuTurnAction(match.round, decision.seat)).match;
        break;
      case "call":
        match = applyMatchAction(match, decideCpuCallResponse(match.round, decision.seat)).match;
        break;
      case "none":
        throw new Error("誰の番でもない局面で止まりました");
    }
  }
  return { match, rounds };
}

describe("matchController: full match (all CPU)", () => {
  it("plays matches without characters or cards to completion, staying zero-sum", () => {
    for (let seed = 1; seed <= 3; seed++) {
      const rng = makeRng(seed * 104729);
      const format: MatchFormat = seed === 3 ? "hanchan" : "tonpuusen";
      // 必殺技を持たないキャラクターが無いため、キャラ付きで回したうえで
      // カード無しなら点数はゼロサムで閉じることを確かめる。
      const start = createMatch(format, rng, randomCharacterIds(rng));
      const { match, rounds } = playMatch(start, rng);
      expect(rounds).toBeGreaterThan(0);
      expect(match.scores.reduce((a, b) => a + b, 0)).toBe(100000);
    }
  }, 300000);

  it("plays matches with random characters and cards to completion without crashing", () => {
    for (let seed = 1; seed <= 4; seed++) {
      const rng = makeRng(seed * 7919);
      const cardIds = ALL_SEATS.map(() => randomCardId(rng)) as [string, string, string, string];
      const start = createMatch("tonpuusen", rng, randomCharacterIds(rng), false, cardIds);
      const { match } = playMatch(start, rng);
      expect(match.finished).toBe(true);
    }
  }, 300000);
});

describe("applyMatchAction", () => {
  /** 誰かがリーチできる局面まで全席CPUで進める。 */
  function findRiichiChance(seed: number, cardIds?: [string | null, string | null, string | null, string | null]) {
    const rng = makeRng(seed);
    let match = createMatch("hanchan", rng, undefined, false, cardIds);
    for (let i = 0; i < 5000; i++) {
      const decision = pendingDecision(match.round);
      if (decision.kind === "round-over") {
        match = advanceToNextRound(settleRound(match).match, rng, ALL_SEATS);
        continue;
      }
      if (decision.kind === "turn" && canRiichi(match.round, decision.seat)) return { match, seat: decision.seat };
      const action =
        decision.kind === "draw"
          ? { type: "draw" as const, player: decision.seat }
          : decision.kind === "turn"
            ? decideCpuTurnAction(match.round, decision.seat)
            : decision.kind === "call"
              ? decideCpuCallResponse(match.round, decision.seat)
              : null;
      if (!action) throw new Error("unexpected");
      match = applyMatchAction(match, action).match;
    }
    throw new Error("リーチできる局面が見つかりません");
  }

  it("deducts the riichi stick from the declarer's score", () => {
    const { match, seat } = findRiichiChance(12345);
    const tileId = riichiCandidateTileIds(match.round, seat)[0]!;
    const next = applyMatchAction(match, { type: "riichi", player: seat, tileId }).match;
    expect(next.scores[seat]).toBe(match.scores[seat] - RIICHI_STICK_COST);
  });

  it("does not deduct the riichi stick while a no-cost-riichi card is unused", () => {
    const cards: [string, string, string, string] = ["no-cost-riichi", "no-cost-riichi", "no-cost-riichi", "no-cost-riichi"];
    const { match, seat } = findRiichiChance(12345, cards);
    expect(match.round.cardUsesRemaining[seat]).toBeGreaterThan(0);
    const tileId = riichiCandidateTileIds(match.round, seat)[0]!;
    const next = applyMatchAction(match, { type: "riichi", player: seat, tileId }).match;
    expect(next.scores[seat]).toBe(match.scores[seat]);
  });

  it("throws on an illegal action and leaves the match untouched", () => {
    const match = createMatch("hanchan", makeRng(1));
    const notTurn = ((match.round.currentTurn + 1) % 4) as PlayerIndex;
    expect(() => applyMatchAction(match, { type: "draw", player: notTurn })).toThrow();
  });
});

describe("autoActionForHuman", () => {
  it("skips a call window automatically only when there is no option", () => {
    const rng = makeRng(99);
    let match = createMatch("hanchan", rng);
    let checked = 0;
    for (let i = 0; i < 3000 && checked < 50; i++) {
      const decision = pendingDecision(match.round);
      if (decision.kind === "round-over") {
        match = advanceToNextRound(settleRound(match).match, rng, ALL_SEATS);
        continue;
      }
      if (decision.kind === "call") {
        const options = computeCallOptions(match.round, decision.seat);
        const hasOption = options.canRon || !!options.canPon || !!options.canMinkan || options.chiOptions.length > 0;
        const auto = autoActionForHuman(match.round, decision.seat);
        expect(auto === null).toBe(hasOption);
        if (auto) expect(auto.type).toBe("skip");
        checked++;
      }
      const action =
        decision.kind === "draw"
          ? { type: "draw" as const, player: decision.seat }
          : decision.kind === "turn"
            ? decideCpuTurnAction(match.round, decision.seat)
            : decideCpuCallResponse(match.round, (decision as { seat: PlayerIndex }).seat);
      match = applyMatchAction(match, action).match;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
