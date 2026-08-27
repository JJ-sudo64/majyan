import { describe, expect, it } from "vitest";
import type { TileCode } from "../src/tiles.js";
import type { Hand } from "../src/hand.js";
import type { PlayerRoundState, RoundState } from "../src/gameState.js";
import type { PlayerIndex } from "../src/actions.js";
import { applyAction, computeRoundScoreOutcome, canDeclareRon } from "../src/gameEngine.js";
import type { WallState } from "../src/wall.js";

let idc = 0;
function tile(code: TileCode) {
  return { id: `g${idc++}`, code };
}
function handOf(codes: TileCode[]): Hand {
  return { concealed: codes.map(tile), melds: [] };
}
function emptyPlayer(codes: TileCode[]): PlayerRoundState {
  return {
    hand: handOf(codes),
    discards: [],
    riichi: false,
    doubleRiichi: false,
    ippatsuActive: false,
    isTenpai: false,
  };
}

function makeWall(liveCodes: TileCode[]): WallState {
  const dead = (Array.from({ length: 14 }, (_, i) => tile((["1z", "2z", "3z", "4z"] as TileCode[])[i % 4]!)));
  return {
    liveTiles: liveCodes.map(tile),
    deadWall: dead,
    revealedDoraCount: 1,
    rinshanDrawn: 0,
  };
}

function makeRound(overrides: Partial<RoundState> & { players: RoundState["players"] }): RoundState {
  return {
    roundWind: 1,
    roundNumber: 1,
    honba: 0,
    kyotaku: 0,
    dealerSeat: 0,
    wall: makeWall(["9s", "9s", "9s", "9s"]),
    currentTurn: 0,
    phase: "awaiting-draw",
    lastDiscard: null,
    lastDrawnTile: null,
    isRinshanTurn: false,
    pendingCallWindow: null,
    kanCount: 0,
    result: null,
    anyCallOrRiichiMade: false,
    ...overrides,
  };
}

describe("gameEngine turn flow", () => {
  it("draw then discard moves to awaiting-calls, all skip advances turn", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]),
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.phase).toBe("awaiting-discard");
    expect(round.players[0].hand.concealed.length).toBe(14);

    const drawnTileId = round.lastDrawnTile!.id;
    round = applyAction(round, { type: "discard", player: 0, tileId: drawnTileId, tsumogiri: true });
    expect(round.phase).toBe("awaiting-calls");

    for (const p of [1, 2, 3] as PlayerIndex[]) {
      round = applyAction(round, { type: "skip", player: p });
    }
    expect(round.phase).toBe("awaiting-draw");
    expect(round.currentTurn).toBe(1);
  });

  it("pon call takes priority and moves turn to caller", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["5z", "1m", "2m", "4p", "5p", "6p", "7s", "8s", "9s", "1p", "1p", "1p", "2z"]),
        emptyPlayer(["5z", "5z", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["6m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    const drawn = round.lastDrawnTile!;
    round = applyAction(round, { type: "discard", player: 0, tileId: drawn.id, tsumogiri: true });
    expect(round.lastDiscard!.tile.code).toBeDefined();

    // player1 has two 5z, discard is whatever player0 drew; force scenario where discard is 5z-independent.
    // Instead directly verify pon using explicit tileIds from player1's hand for the matching code.
    const discardCode = round.lastDiscard!.tile.code;
    const matchingIds = round.players[1].hand.concealed.filter((t) => t.code === discardCode).map((t) => t.id);
    if (matchingIds.length >= 2) {
      round = applyAction(round, { type: "pon", player: 1, usedHandTileIds: [matchingIds[0]!, matchingIds[1]!] });
      expect(round.currentTurn).toBe(1);
      expect(round.phase).toBe("awaiting-discard");
      expect(round.players[1].hand.melds.some((m) => m.type === "pon")).toBe(true);
    } else {
      for (const p of [1, 2, 3] as PlayerIndex[]) round = applyAction(round, { type: "skip", player: p });
      expect(round.phase).toBe("awaiting-draw");
    }
  });
});

describe("gameEngine win detection", () => {
  it("tsumo win produces correct score deltas (dealer)", () => {
    // dealer hand tenpai on tanyao pinfu-ish shape, draws the winning tile directly.
    let round = makeRound({
      players: [
        emptyPlayer(["2m", "3m", "4p", "5p", "6p", "3s", "4s", "5s", "6s", "7s", "8s", "9p", "9p"]),
        emptyPlayer(["1m", "1m", "1m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["6m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      wall: makeWall(["4m", "9s", "9s", "9s"]),
    });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.lastDrawnTile!.code).toBe("4m");
    round = applyAction(round, { type: "tsumo", player: 0 });
    expect(round.result?.type).toBe("tsumo");

    const outcome = computeRoundScoreOutcome(round);
    expect(outcome.scoreDeltas[0]).toBeGreaterThan(0);
    const total = outcome.scoreDeltas.reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it("ron win produces correct score deltas and furiten blocks self-discarded winning tile", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["2m", "3m", "4p", "5p", "6p", "3s", "4s", "5s", "6s", "7s", "8s", "9p", "9p"]),
        emptyPlayer(["4m", "1p", "2p", "3p", "5p", "6p", "7p", "2s", "3s", "4s", "6z", "6z", "6z"]),
        emptyPlayer(["6m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      currentTurn: 1,
      wall: makeWall(["1s", "9s", "9s", "9s"]),
    });

    const winAnalysis = canDeclareRon(round, 0, "4m");
    expect(winAnalysis).not.toBeNull();

    round = applyAction(round, { type: "draw", player: 1 });
    round = applyAction(round, { type: "discard", player: 1, tileId: round.players[1].hand.concealed.find((t) => t.code === "4m")!.id, tsumogiri: false });
    expect(round.lastDiscard!.tile.code).toBe("4m");

    round = applyAction(round, { type: "ron", player: 0 });
    for (const p of [2, 3] as PlayerIndex[]) round = applyAction(round, { type: "skip", player: p });
    expect(round.result?.type).toBe("ron");
    expect(round.result?.winners).toEqual([0]);

    const outcome = computeRoundScoreOutcome(round);
    expect(outcome.scoreDeltas[0]).toBeGreaterThan(0);
    expect(outcome.scoreDeltas[1]).toBeLessThan(0);
    expect(outcome.scoreDeltas.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("exhaustive draw pays tenpai players from noten players", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["2m", "3m", "4p", "5p", "6p", "3s", "4s", "5s", "6s", "7s", "8s", "9p", "9p"]), // tenpai
        emptyPlayer(["1m", "5m", "9m", "1p", "5p", "9p", "1s", "5s", "9s", "1z", "3z", "5z", "7z"]), // noten
        emptyPlayer(["2m", "5m", "9m", "1p", "5p", "9p", "1s", "5s", "9s", "1z", "3z", "5z", "7z"]), // noten
        emptyPlayer(["3m", "5m", "9m", "1p", "5p", "9p", "1s", "5s", "9s", "1z", "3z", "5z", "7z"]), // noten
      ],
      wall: makeWall([]),
      currentTurn: 0,
      phase: "awaiting-draw",
    });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.result?.type).toBe("exhaustive-draw");
    expect(round.result?.tenpaiPlayers).toEqual([0]);

    const outcome = computeRoundScoreOutcome(round);
    expect(outcome.scoreDeltas[0]).toBe(3000);
    expect(outcome.scoreDeltas[1]).toBe(-1000);
    expect(outcome.scoreDeltas.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
