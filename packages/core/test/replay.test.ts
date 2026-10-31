import { describe, expect, it } from "vitest";
import { createMatch } from "../src/matchFormat.js";
import { replayRoundFrames, withSecondCardSlot } from "../src/replay.js";
import type { MatchState } from "../src/gameState.js";

function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** カードが1枠だった頃に保存された形（2枠目の項目が無い）にする。 */
function withoutSecondSlot(match: MatchState): MatchState {
  const { cardIds2: _a, cardUsesRemaining2: _b, ...rest } = match.round;
  return { ...match, round: rest as MatchState["round"] };
}

describe("replays saved before the second card slot existed", () => {
  const match = createMatch("tonpuusen", makeSeededRng(3), ["", "", "", ""], false, ["meld-guarantee", null, null, null]);
  const old = withoutSecondSlot(match);

  it("gets an empty second slot filled in, and leaves a current-format match untouched", () => {
    const fixed = withSecondCardSlot(old);
    expect(fixed.round.cardIds2).toEqual([null, null, null, null]);
    expect(fixed.round.cardUsesRemaining2).toEqual([0, 0, 0, 0]);
    expect(fixed.round.cardIds).toEqual(old.round.cardIds);
    expect(withSecondCardSlot(match)).toBe(match);
  });

  it("still replays the actions instead of stopping at the first one", () => {
    const dealer = match.round.dealerSeat;
    const frames = replayRoundFrames({ start: old, actions: [{ type: "draw", player: dealer }] });
    expect(frames.states).toHaveLength(2);
    expect(frames.states[1]!.round.phase).toBe("awaiting-discard");
  });
});
