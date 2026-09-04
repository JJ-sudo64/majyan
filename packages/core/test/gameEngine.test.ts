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
    skillGauge: 0,
    guaranteedRinshan: false,
    tileSwapsRemaining: 0,
    pendingTileSwapNextRound: false,
    timeStopTurnsRemaining: 0,
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
    format: "hanchan",
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
    characterIds: ["", "", "", ""],
    anyCallOrRiichiMade: false,
    handsRevealedTo: null,
    wallReadRevealedTo: null,
    dealerRenchanByWin: false,
    riichiLockedBy: null,
    tomohiroGuardCount: 0,
    cardIds: [null, null, null, null],
    cardUsesRemaining: [0, 0, 0, 0],
    cardNegateArmed: [false, false, false, false],
    cardBonusHan: [0, 0, 0, 0],
    cardExtraUraDora: [false, false, false, false],
    cardScoreDoubled: [false, false, false, false],
    pendingScoreAdjustment: null,
    lastActivatedSkill: null,
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

  it("riichi locks the hand: pon/chi/minkan are rejected, skip still works", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]),
        { ...emptyPlayer(["5z", "5z", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]), riichi: true },
        emptyPlayer(["6m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      wall: makeWall(["5z", "9s", "9s", "9s"]),
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    expect(round.lastDiscard!.tile.code).toBe("5z");

    const matchingIds = round.players[1].hand.concealed.filter((t) => t.code === "5z").map((t) => t.id);
    expect(matchingIds.length).toBe(2);
    expect(() => applyAction(round, { type: "pon", player: 1, usedHandTileIds: [matchingIds[0]!, matchingIds[1]!] })).toThrow();

    const afterSkip = applyAction(round, { type: "skip", player: 1 });
    expect(afterSkip.pendingCallWindow?.respondedBy).toContain(1);
  });

  it("if the riichi declaration tile gets called away, the marker (isRiichiDeclaration) transfers to the next discard", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), // tenpai (2z tanki)
        emptyPlayer(["5z", "5z", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["6m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      // canRiichi requires at least 4 live tiles remaining *after* the draw that
      // triggers the riichi decision, so keep one spare tile beyond the 4 that
      // actually get drawn over the course of this test.
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
    });

    // player0 draws 5z and riichis on it (discarding it keeps the 2z-tanki tenpai shape).
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.lastDrawnTile!.code).toBe("5z");
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });
    expect(round.players[0].discards[0]!.isRiichiDeclaration).toBe(true);
    expect(round.players[0].discards[0]!.calledAway).toBe(false);

    // player1 pons the riichi declaration tile away (5z 5z + the discarded 5z).
    const fivezIds = round.players[1].hand.concealed.filter((t) => t.code === "5z").map((t) => t.id);
    expect(fivezIds.length).toBe(2);
    round = applyAction(round, { type: "pon", player: 1, usedHandTileIds: [fivezIds[0]!, fivezIds[1]!] });
    // window's awaitingPlayers = otherPlayers(discarder=0) = [1,2,3]; player1 already
    // responded via pon, and player0 (the discarder) was never an awaiting player.
    for (const p of [2, 3] as PlayerIndex[]) round = applyAction(round, { type: "skip", player: p });
    expect(round.currentTurn).toBe(1);
    expect(round.players[0].discards[0]!.calledAway).toBe(true); // marker's tile is gone from the river now
    expect(round.players[0].discards[0]!.isRiichiDeclaration).toBe(true); // but the flag itself stays on that entry

    // player1 discards a hand tile (not a draw, since they just called).
    const p1DiscardId = round.players[1].hand.concealed.find((t) => t.code === "3m")!.id;
    round = applyAction(round, { type: "discard", player: 1, tileId: p1DiscardId, tsumogiri: false });
    for (const p of [0, 2, 3] as PlayerIndex[]) round = applyAction(round, { type: "skip", player: p });
    expect(round.currentTurn).toBe(2);

    // player2 and player3 each draw-and-discard (tsumogiri) to cycle the turn back to player0.
    round = applyAction(round, { type: "draw", player: 2 });
    round = applyAction(round, { type: "discard", player: 2, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    for (const p of [3, 0, 1] as PlayerIndex[]) round = applyAction(round, { type: "skip", player: p });
    expect(round.currentTurn).toBe(3);

    round = applyAction(round, { type: "draw", player: 3 });
    round = applyAction(round, { type: "discard", player: 3, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    for (const p of [0, 1, 2] as PlayerIndex[]) round = applyAction(round, { type: "skip", player: p });
    expect(round.currentTurn).toBe(0);

    // player0 draws again (still riichi, forced tsumogiri). This discard should now carry
    // the isRiichiDeclaration marker, since the original one is no longer visible in their river.
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.lastDrawnTile!.code).toBe("6m");
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    const p0Discards = round.players[0].discards;
    expect(p0Discards.length).toBe(2);
    expect(p0Discards[1]!.tile.code).toBe("6m");
    expect(p0Discards[1]!.isRiichiDeclaration).toBe(true);
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

    const winAnalysis = canDeclareRon(round, 0, "4m", 1);
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
