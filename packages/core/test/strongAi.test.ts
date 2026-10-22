import { describe, expect, it } from "vitest";
import { createMatch } from "../src/matchFormat.js";
import { advanceToNextRound, applyMatchAction, pendingDecision, settleRound } from "../src/matchController.js";
import { decideCpuCallResponse, decideCpuTurnAction } from "../src/ai/cpuPlayer.js";
import { decideTurnAction } from "../src/ai/simpleAi.js";
import type { PlayerIndex } from "../src/actions.js";
import type { RoundState, DiscardedTile } from "../src/gameState.js";
import type { TileCode } from "../src/tiles.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const tiles = (codes: TileCode[], prefix: string) => codes.map((code, i) => ({ id: `${prefix}${i}`, code }));
const river = (codes: TileCode[], prefix: string): DiscardedTile[] =>
  tiles(codes, prefix).map((tile) => ({ tile, calledAway: false, isRiichiDeclaration: false, isTsumogiri: false }));

/** 席0がこの14枚を持って打牌する場面（席1・席2がリーチ中）を作る。 */
function defenseRound(): RoundState {
  const base = createMatch("hanchan", makeRng(7)).round;
  const players = base.players.map((p) => ({ ...p })) as RoundState["players"];
  // ばらばらの手（向聴数が大きい）。切る候補: 8p（席1だけが切っている）、3z（席1・席2の両方が切っている）
  const hand = tiles(["1m", "4m", "8m", "2p", "6p", "8p", "3s", "5s", "9s", "1z", "2z", "3z", "4z", "7z"], "h");
  players[0] = { ...players[0]!, hand: { concealed: hand, melds: [] }, riichi: false, discards: [] };
  players[1] = { ...players[1]!, riichi: true, discards: river(["8p", "3z", "9m"], "a") };
  players[2] = { ...players[2]!, riichi: true, discards: river(["3z", "6m", "1p"], "b") };
  return {
    ...base,
    players,
    characterIds: ["", "", "", ""],
    currentTurn: 0,
    phase: "awaiting-discard",
    lastDrawnTile: hand[13]!,
    handsRevealedTo: null,
  };
}

describe("strong CPU defense", () => {
  it("Lv5 folds with a tile that is safe against every riichi player, not just one of them", () => {
    const action = decideTurnAction(defenseRound(), 0, 5);
    expect(action.type).toBe("discard");
    if (action.type !== "discard") return;
    // 3zは席1・席2のどちらの河にもある（安全）。8pは席1の現物だが席2には通っていない。
    expect(action.tileId).toBe("h11");
  });

  it("Lv2 keeps the old behaviour of treating a tile discarded by anyone as safe", () => {
    const action = decideTurnAction(defenseRound(), 0, 2);
    expect(action.type).toBe("discard");
  });
});

/** 席1のライコがリーチ後の一発中（ゲージ満タン）で、席0が席3の捨てた牌に鳴ける場面。 */
function issenRound(gauge: number): RoundState {
  const base = createMatch("hanchan", makeRng(7)).round;
  const players = base.players.map((p) => ({ ...p })) as RoundState["players"];
  // 1向聴のまま、4pをポンしても向聴数が悪くならない手。
  const hand = tiles(["2m", "3m", "4m", "6m", "7m", "8m", "4p", "4p", "3s", "5s", "9s", "1z", "7z"], "h");
  players[0] = { ...players[0]!, hand: { concealed: hand, melds: [] }, riichi: false, discards: [] };
  players[1] = { ...players[1]!, riichi: true, ippatsuActive: true, skillGauge: gauge };
  const discardTile = { id: "d0", code: "4p" as TileCode };
  return {
    ...base,
    players,
    characterIds: ["", "raiko", "", ""],
    currentTurn: 3,
    phase: "awaiting-call",
    pendingCallWindow: { discardTile, discarderIndex: 3, isChankan: false } as RoundState["pendingCallWindow"],
    handsRevealedTo: null,
  };
}

describe("strong CPU vs Raiko's issen", () => {
  it("Lv4/5 call to break the ippatsu while Raiko has a full gauge, but not when the gauge is empty", () => {
    for (const level of [4, 5] as const) {
      expect(decideCpuCallResponse(issenRound(100), 0, level).type).toBe("pon");
    }
    expect(decideCpuCallResponse(issenRound(0), 0, 5).type).toBe("skip");
  });
});

describe("strong CPU self-play", () => {
  it("plays a whole round at Lv5 against Lv2 without getting stuck", () => {
    const rng = makeRng(42);
    let match = createMatch("tonpuusen", rng, ["", "", "", ""], false, [null, null, null, null]);
    const level = (seat: PlayerIndex) => (seat === 0 ? 5 : 2) as 5 | 2;
    let rounds = 0;
    let steps = 0;
    while (!match.finished && rounds < 2) {
      const d = pendingDecision(match.round);
      if (d.kind === "round-over") {
        rounds++;
        match = settleRound(match).match;
        if (!match.finished) match = advanceToNextRound(match, rng, [0, 1, 2, 3]);
        steps = 0;
        continue;
      }
      expect(++steps).toBeLessThan(5000);
      expect(d.kind).not.toBe("none");
      const action =
        d.kind === "draw"
          ? ({ type: "draw", player: d.seat } as const)
          : d.kind === "turn"
            ? decideCpuTurnAction(match.round, d.seat, level(d.seat))
            : decideCpuCallResponse(match.round, d.seat, level(d.seat));
      match = applyMatchAction(match, action).match;
    }
    expect(rounds).toBe(2);
  });
});
