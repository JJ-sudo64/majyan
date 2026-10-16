import { describe, expect, it } from "vitest";
import type { TileCode } from "../src/tiles.js";
import type { Hand } from "../src/hand.js";
import type { RoundState } from "../src/gameState.js";
import { applyAction, canDeclareRon, canDeclareTsumo, canUseCard, computeRoundScoreOutcome } from "../src/gameEngine.js";
import {
  applyCardBustGuards,
  applyCardMatchEndBonuses,
  CARDS,
  CARD_IDS,
  randomCardId,
  resolveKyotakuWithCard,
} from "../src/cards.js";
import { CHARACTERS } from "../src/characters.js";
import { dealNewRound } from "../src/matchFormat.js";
import { isNumbered, numberOf, suitOf, nextTileForDora } from "../src/tiles.js";
import { doraIndicators, type WallState } from "../src/wall.js";
import type { PlayerRoundState } from "../src/gameState.js";

function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function hasCompleteMeld(hand: Hand): boolean {
  const counts = new Map<TileCode, number>();
  for (const t of hand.concealed) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
  for (const c of counts.values()) if (c >= 3) return true;
  for (const [code, c] of counts) {
    if (!isNumbered(code) || c < 1) continue;
    const n = numberOf(code);
    if (n > 7) continue;
    const suit = suitOf(code);
    const b = counts.get(`${n + 1}${suit}` as TileCode) ?? 0;
    const cc = counts.get(`${n + 2}${suit}` as TileCode) ?? 0;
    if (b >= 1 && cc >= 1) return true;
  }
  return false;
}

function handHasDora(hand: Hand, wall: WallState): boolean {
  const doraCodes = new Set(doraIndicators(wall).map(nextTileForDora));
  return hand.concealed.some((t) => doraCodes.has(t.code) || t.isRed);
}

let idc = 0;
function tile(code: TileCode) {
  return { id: `c${idc++}`, code };
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
    pendingPairDealNextRound: false,
    openRiichi: false,
    guaranteedUraDora: false,
    revealedFutureDraws: [],
    futopparaPending: false,
    guaranteedUsefulDraw: false,
    bettaoriActive: false,
    bettaoriShield: false,
    atomicRiichi: false,
    timeStopTurnsRemaining: 0,
    ruleChangeActive: false,
    ronOnlyRiichi: false,
  };
}

function makeWall(liveCodes: TileCode[]): WallState {
  const dead = Array.from({ length: 14 }, (_, i) => tile((["1z", "2z", "3z", "4z"] as TileCode[])[i % 4]!));
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
    // 消費型カードのデフォルト(maxUses未指定=1)を想定した「未使用」状態。
    // 複数回使えるカード(future-sight等)をテストする際は明示的に上書きする。
    cardUsesRemaining: [1, 1, 1, 1],
    cardNegateArmed: [false, false, false, false],
    cardBonusHan: [0, 0, 0, 0],
    cardExtraUraDora: [false, false, false, false],
    cardScoreDoubled: [false, false, false, false],
    pendingScoreAdjustment: null,
    lastActivatedSkill: null,
    ...overrides,
  };
}

describe("meld-guarantee card (面子確約)", () => {
  // 総当たりで確認済み: このシードでの素の配牌(座席0)はたまたま面子0個になる。
  const NO_MELD_SEED = 2;

  it("forces at least one meld at deal time when the raw deal has none", () => {
    const baseline = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(NO_MELD_SEED), ["", "", "", ""]);
    expect(hasCompleteMeld(baseline.players[0]!.hand)).toBe(false);

    const withCard = dealNewRound(
      1, 1, 0, 0, 0, makeSeededRng(NO_MELD_SEED), ["", "", "", ""], undefined, undefined, false,
      ["meld-guarantee", null, null, null],
    );
    expect(hasCompleteMeld(withCard.players[0]!.hand)).toBe(true);
    expect(withCard.players[0]!.hand.concealed.length).toBe(13);
    expect(withCard.wall.liveTiles.length).toBe(baseline.wall.liveTiles.length);
    for (const seat of [1, 2, 3] as const) {
      expect(withCard.players[seat]!.hand.concealed.map((t) => t.code)).toEqual(
        baseline.players[seat]!.hand.concealed.map((t) => t.code),
      );
    }
  });

  it("applies independently per seat when multiple seats hold the card", () => {
    const withHumanOnly = dealNewRound(
      1, 1, 0, 0, 0, makeSeededRng(NO_MELD_SEED), ["", "", "", ""], undefined, undefined, false,
      ["meld-guarantee", null, null, null],
    );
    const withAll = dealNewRound(
      1, 1, 0, 0, 0, makeSeededRng(NO_MELD_SEED), ["", "", "", ""], undefined, undefined, false,
      ["meld-guarantee", "meld-guarantee", "meld-guarantee", "meld-guarantee"],
    );
    expect(withHumanOnly.players[0]!.hand.concealed.map((t) => t.code)).toEqual(
      withAll.players[0]!.hand.concealed.map((t) => t.code),
    );
    for (const seat of [1, 2, 3] as const) {
      expect(withAll.players[seat]!.hand.concealed.length).toBe(13);
    }
  });
});

describe("dora-guarantee card (ドラ確約)", () => {
  // 総当たりで確認済み: このシードでの素の配牌(座席0)はたまたまドラ0枚になる。
  const NO_DORA_SEED = 2;

  it("forces at least one dora tile at deal time when the raw deal has none", () => {
    const baseline = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(NO_DORA_SEED), ["", "", "", ""]);
    expect(handHasDora(baseline.players[0]!.hand, baseline.wall)).toBe(false);

    const withCard = dealNewRound(
      1, 1, 0, 0, 0, makeSeededRng(NO_DORA_SEED), ["", "", "", ""], undefined, undefined, false,
      ["dora-guarantee", null, null, null],
    );
    expect(handHasDora(withCard.players[0]!.hand, withCard.wall)).toBe(true);
    expect(withCard.players[0]!.hand.concealed.length).toBe(13);
  });
});

describe("CPU seats receive a random card", () => {
  it("randomCardId always returns a valid, non-null CARDS key", () => {
    const rng = makeSeededRng(42);
    for (let i = 0; i < 20; i++) {
      const id = randomCardId(rng);
      expect(CARD_IDS).toContain(id);
      expect(CARDS[id]).toBeDefined();
    }
  });
});

describe("canUseCard", () => {
  const tenpaiHand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];

  it("is true for a consumable card on the owner's turn before discarding", () => {
    const round = makeRound({
      players: [{ ...emptyPlayer(tenpaiHand) }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["future-sight", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseCard(round, 0)).toBe(true);
  });

  it("is true for a CPU seat holding a consumable card", () => {
    const round = makeRound({
      players: [emptyPlayer([]), { ...emptyPlayer(tenpaiHand) }, emptyPlayer([]), emptyPlayer([])],
      cardIds: [null, "future-sight", null, null],
      currentTurn: 1,
      phase: "awaiting-discard",
    });
    expect(canUseCard(round, 1)).toBe(true);
    expect(canUseCard(round, 0)).toBe(false);
  });

  it("is false for a passive card (no onUse)", () => {
    const round = makeRound({
      players: [emptyPlayer(tenpaiHand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["meld-guarantee", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseCard(round, 0)).toBe(false);
  });

  it("is false once no uses remain", () => {
    const round = makeRound({
      players: [emptyPlayer(tenpaiHand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["future-sight", null, null, null],
      cardUsesRemaining: [0, 1, 1, 1],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseCard(round, 0)).toBe(false);
  });

  it("is false with no card selected", () => {
    const round = makeRound({
      players: [emptyPlayer(tenpaiHand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseCard(round, 0)).toBe(false);
  });
});

describe("future-sight card (未来視)", () => {
  const wall = () => makeWall(["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"]);

  it("reveals only the single next upcoming draw (not mirai's full 3-ahead preview) and consumes one use", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["future-sight", null, null, null],
      cardUsesRemaining: [CARDS["future-sight"]!.maxUses!, 1, 1, 1],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: wall(),
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.players[0]!.revealedFutureDraws).toEqual(["4m"]);
    expect(next.cardUsesRemaining[0]).toBe(CARDS["future-sight"]!.maxUses! - 1);
  });

  it("can be used up to 3 times total across the match, becoming unusable once exhausted", () => {
    expect(CARDS["future-sight"]!.maxUses).toBe(3);
    let round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["future-sight", null, null, null],
      cardUsesRemaining: [3, 1, 1, 1],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: wall(),
    });

    expect(canUseCard(round, 0)).toBe(true);
    round = applyAction(round, { type: "useCard", player: 0 });
    expect(round.cardUsesRemaining[0]).toBe(2);

    expect(canUseCard(round, 0)).toBe(true);
    round = applyAction(round, { type: "useCard", player: 0 });
    expect(round.cardUsesRemaining[0]).toBe(1);

    expect(canUseCard(round, 0)).toBe(true);
    round = applyAction(round, { type: "useCard", player: 0 });
    expect(round.cardUsesRemaining[0]).toBe(0);

    expect(canUseCard(round, 0)).toBe(false);
    expect(() => applyAction(round, { type: "useCard", player: 0 })).toThrow();
  });
});

describe("han-up cards (小手先の一翻・会心の二翻)", () => {
  it("han-up-1 sets cardBonusHan[owner] to 1 and consumes the card", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["han-up-1", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.cardBonusHan[0]).toBe(1);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });

  it("han-up-2 sets cardBonusHan[owner] to 2", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["han-up-2", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.cardBonusHan[0]).toBe(2);
  });

  it("applies bonus han only to the owning seat when a CPU holds the card", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: [null, null, "han-up-2", null],
      currentTurn: 2,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 2 });
    expect(next.cardBonusHan).toEqual([0, 0, 2, 0]);
  });
});

describe("point-drain card (点棒吸収)", () => {
  it("sets a pendingScoreAdjustment of +3000 for the owner and -1000 for each other seat", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["point-drain", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.pendingScoreAdjustment).toEqual([3000, -1000, -1000, -1000]);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });
});

describe("nullify card (無効化)", () => {
  const tenpaiHand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];

  it("onUse arms cardNegateArmed[owner] without touching anything else", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["nullify", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.cardNegateArmed[0]).toBe(true);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });

  it("negates an opponent's useSkill activation: the effect is discarded but the gauge is still spent, and the shield disarms", () => {
    const round = makeRound({
      players: [emptyPlayer([]), { ...emptyPlayer([]), skillGauge: CHARACTERS.hiiragi!.gaugeMax }, emptyPlayer([]), emptyPlayer([])],
      characterIds: ["", "hiiragi", "", ""],
      currentTurn: 1,
      phase: "awaiting-discard",
      cardIds: ["nullify", null, null, null],
      cardNegateArmed: [true, false, false, false],
    });
    const before = round.wall.revealedDoraCount;
    const next = applyAction(round, { type: "useSkill", player: 1 });
    expect(next.players[1]!.skillGauge).toBe(0); // 空撃ちでゲージは消費される
    expect(next.wall.revealedDoraCount).toBe(before); // 「開花」の効果自体は無効化される
    expect(next.cardNegateArmed[0]).toBe(false); // 構えは消費される
  });

  it("does not negate the card owner's own useSkill", () => {
    const round = makeRound({
      players: [{ ...emptyPlayer([]), skillGauge: CHARACTERS.hiiragi!.gaugeMax }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      cardIds: ["nullify", null, null, null],
      cardNegateArmed: [true, false, false, false],
    });
    const before = round.wall.revealedDoraCount;
    const next = applyAction(round, { type: "useSkill", player: 0 });
    expect(next.wall.revealedDoraCount).toBe(before + 1); // 自分自身の発動は無効化されない
    expect(next.cardNegateArmed[0]).toBe(true); // 構えも消費されない
  });

  it("negates an opponent's atomic-riichi auto-activation (onRiichi): the riichi stays a normal riichi", () => {
    const round = makeRound({
      players: [
        emptyPlayer([]),
        { ...emptyPlayer(tenpaiHand), skillGauge: CHARACTERS.nyanjiro!.gaugeMax },
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["", "nyanjiro", "", ""],
      currentTurn: 1,
      phase: "awaiting-draw",
      cardIds: ["nullify", null, null, null],
      cardNegateArmed: [true, false, false, false],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
    });
    let next = applyAction(round, { type: "draw", player: 1 });
    next = applyAction(next, { type: "riichi", player: 1, tileId: next.lastDrawnTile!.id });
    expect(next.players[1]!.atomicRiichi).toBe(false);
    expect(next.riichiLockedBy).toBeNull();
    expect(next.players[1]!.skillGauge).toBe(0); // ゲージは消費される
    expect(next.cardNegateArmed[0]).toBe(false);
  });

  it("only negates once: a second opponent skill use afterward goes through normally", () => {
    let round = makeRound({
      players: [
        emptyPlayer([]),
        { ...emptyPlayer([]), skillGauge: CHARACTERS.hiiragi!.gaugeMax },
        { ...emptyPlayer([]), skillGauge: CHARACTERS.hiiragi!.gaugeMax },
        emptyPlayer([]),
      ],
      characterIds: ["", "hiiragi", "hiiragi", ""],
      currentTurn: 1,
      phase: "awaiting-discard",
      cardIds: ["nullify", null, null, null],
      cardNegateArmed: [true, false, false, false],
    });
    const firstCount = round.wall.revealedDoraCount;
    round = applyAction(round, { type: "useSkill", player: 1 });
    expect(round.wall.revealedDoraCount).toBe(firstCount); // 1回目は無効化される
    expect(round.cardNegateArmed[0]).toBe(false);

    round = { ...round, currentTurn: 2 };
    const secondCount = round.wall.revealedDoraCount;
    round = applyAction(round, { type: "useSkill", player: 2 });
    expect(round.wall.revealedDoraCount).toBe(secondCount + 1); // 構えは使い切ったので2回目は通常通り発動
  });

  it("works when a CPU seat holds nullify against another CPU's skill", () => {
    const round = makeRound({
      players: [
        emptyPlayer([]),
        { ...emptyPlayer([]), skillGauge: CHARACTERS.hiiragi!.gaugeMax },
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["", "hiiragi", "", ""],
      currentTurn: 1,
      phase: "awaiting-discard",
      cardIds: [null, null, null, "nullify"],
      cardNegateArmed: [false, false, false, true],
    });
    const before = round.wall.revealedDoraCount;
    const next = applyAction(round, { type: "useSkill", player: 1 });
    expect(next.wall.revealedDoraCount).toBe(before);
    expect(next.cardNegateArmed[3]).toBe(false);
  });
});

describe("houjuu-guard card (一閃の盾)", () => {
  // 三暗刻+一刻子(対々和)+9m単騎待ち。tenpaiWaitingOn9mはskills.test.tsの
  // タカハルの盾テストと同じ形（トイトイで役が成立し普通にロンできる待ち）。
  const tenpaiWaitingOn9m = ["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4z", "4z", "4z", "9m"] as TileCode[];

  it("has no onUse (no useCard button) even though it is a consumable card", () => {
    expect(CARDS["houjuu-guard"]!.kind).toBe("consumable");
    expect(CARDS["houjuu-guard"]!.hooks.onUse).toBeUndefined();
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["houjuu-guard", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseCard(round, 0)).toBe(false);
  });

  it("canDeclareRon is blocked for everyone while the discarder holds an unused guard", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer(tenpaiWaitingOn9m), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["", "hiiragi", "", ""],
      cardIds: ["houjuu-guard", null, null, null],
    });
    expect(canDeclareRon(round, 1, "9m", 0)).toBeNull();

    const withoutGuard = { ...round, cardUsesRemaining: [0, 1, 1, 1] as RoundState["cardUsesRemaining"] };
    expect(canDeclareRon(withoutGuard, 1, "9m", 0)).not.toBeNull(); // 盾が無ければ普通にロンできる状況であることの確認
  });

  it("stays armed through the call window and is only consumed once it resolves with no ron", () => {
    const round = makeRound({
      players: [
        emptyPlayer(["9m", "1p", "1p", "1p", "2s", "2s", "2s", "4z", "4z", "4z", "6z", "6z", "3z"]),
        emptyPlayer(tenpaiWaitingOn9m), // 9m単騎待ち＝盾が無ければ9mを切った瞬間ロンされる
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      cardIds: ["houjuu-guard", null, null, null],
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "9m")!.id;

    const afterDiscard = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    // 応答ウィンドウがまだ解決していない間は、盾はまだ消費されず立ったまま。
    expect(afterDiscard.cardUsesRemaining[0]).toBe(1);
    expect(canDeclareRon(afterDiscard, 1, "9m", 0)).toBeNull();

    const afterP1Skip = applyAction(afterDiscard, { type: "skip", player: 1 });
    const afterP2Skip = applyAction(afterP1Skip, { type: "skip", player: 2 });
    const next = applyAction(afterP2Skip, { type: "skip", player: 3 });

    expect(next.cardUsesRemaining[0]).toBe(0); // 実際に守ったので消費される
  });

  it("is preserved when the discard was not actually dangerous", () => {
    const round = makeRound({
      players: [
        emptyPlayer(["6z", "1p", "1p", "1p", "2s", "2s", "2s", "4z", "4z", "4z", "6z", "6z", "3z"]),
        emptyPlayer(tenpaiWaitingOn9m), // 6zは誰の当たり牌でもない
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      cardIds: ["houjuu-guard", null, null, null],
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "6z")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.cardUsesRemaining[0]).toBe(1); // 安全牌だったので温存される
  });

  it("works for a CPU seat guarding against another CPU's ron", () => {
    const round = makeRound({
      players: [
        emptyPlayer([]),
        emptyPlayer(["9m", "1p", "1p", "1p", "2s", "2s", "2s", "4z", "4z", "4z", "6z", "6z", "3z"]),
        emptyPlayer(tenpaiWaitingOn9m),
        emptyPlayer([]),
      ],
      characterIds: ["", "", "hiiragi", ""],
      currentTurn: 1,
      phase: "awaiting-discard",
      cardIds: [null, "houjuu-guard", null, null],
    });
    const discardId = round.players[1]!.hand.concealed.find((t) => t.code === "9m")!.id;
    expect(canDeclareRon(round, 2, "9m", 1)).toBeNull();

    const afterDiscard = applyAction(round, { type: "discard", player: 1, tileId: discardId, tsumogiri: false });
    const afterP0Skip = applyAction(afterDiscard, { type: "skip", player: 0 });
    const afterP2Skip = applyAction(afterP0Skip, { type: "skip", player: 2 });
    const next = applyAction(afterP2Skip, { type: "skip", player: 3 });
    expect(next.cardUsesRemaining[1]).toBe(0);
  });
});

describe("last-place-bonus card (起死回生)", () => {
  const round = makeRound({ players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] });

  it("adds 5000 to the holder's final score only when they are strictly last", () => {
    const withCard = { ...round, cardIds: ["last-place-bonus", null, null, null] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(withCard, [10000, 20000, 15000, 30000])).toEqual([15000, 20000, 15000, 30000]);
    expect(applyCardMatchEndBonuses(withCard, [30000, 20000, 15000, 10000])).toEqual([30000, 20000, 15000, 10000]);
  });

  it("also applies on a tied-for-last score", () => {
    const withCard = { ...round, cardIds: [null, null, null, "last-place-bonus"] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(withCard, [30000, 25000, 20000, 20000])).toEqual([30000, 25000, 20000, 25000]);
  });

  it("does nothing when no seat holds the card", () => {
    expect(applyCardMatchEndBonuses(round, [10000, 20000, 15000, 30000])).toEqual([10000, 20000, 15000, 30000]);
  });

  it("applies independently to multiple holders (e.g. both stuck tied for last)", () => {
    const withCard = { ...round, cardIds: ["last-place-bonus", null, null, "last-place-bonus"] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(withCard, [10000, 40000, 40000, 10000])).toEqual([15000, 40000, 40000, 15000]);
  });
});

describe("tenpai-insurance card (聴牌保険)", () => {
  const players: TileCode[][] = [
    ["2m", "3m", "4p", "5p", "6p", "3s", "4s", "5s", "6s", "7s", "8s", "9p", "9p"], // tenpai (自力)
    ["1m", "5m", "9m", "1p", "5p", "9p", "1s", "5s", "9s", "1z", "3z", "5z", "7z"], // noten
    ["2m", "5m", "9m", "1p", "5p", "9p", "1s", "5s", "9s", "1z", "3z", "5z", "7z"], // noten
    ["3m", "5m", "9m", "1p", "5p", "9p", "1s", "5s", "9s", "1z", "3z", "5z", "7z"], // noten
  ];

  it("treats a noten holder as tenpai on exhaustive draw and consumes the card", () => {
    let round = makeRound({
      players: players.map((h) => emptyPlayer(h)) as RoundState["players"],
      wall: makeWall([]),
      currentTurn: 0,
      phase: "awaiting-draw",
      cardIds: [null, "tenpai-insurance", null, null],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.result?.type).toBe("exhaustive-draw");
    expect(round.result?.tenpaiPlayers).toEqual([0, 1]);
    expect(round.cardUsesRemaining[1]).toBe(0);
  });

  it("does not consume the card when the holder is already tenpai on their own", () => {
    let round = makeRound({
      players: players.map((h) => emptyPlayer(h)) as RoundState["players"],
      wall: makeWall([]),
      currentTurn: 0,
      phase: "awaiting-draw",
      cardIds: ["tenpai-insurance", null, null, null],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.result?.tenpaiPlayers).toEqual([0]);
    expect(round.cardUsesRemaining[0]).toBe(1); // 自力テンパイだったので消費されない
  });

  it("does nothing once already used up", () => {
    let round = makeRound({
      players: players.map((h) => emptyPlayer(h)) as RoundState["players"],
      wall: makeWall([]),
      currentTurn: 0,
      phase: "awaiting-draw",
      cardIds: [null, "tenpai-insurance", null, null],
      cardUsesRemaining: [1, 0, 1, 1],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.result?.tenpaiPlayers).toEqual([0]);
  });
});

describe("double-ura-dora card (裏ドラ倍加)", () => {
  it("onUse arms cardExtraUraDora[owner] and consumes the card", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["double-ura-dora", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.cardExtraUraDora[0]).toBe(true);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });

  it("adds one extra ura-dora indicator on a riichi win, increasing the counted han", () => {
    // 東(1z)の刻子(1つだけ・四暗刻にはならない) + 2m3m4m + 5p6p7p + 7s8s9s + 9m対子の
    // 門前自摸手（役牌かどうかは翻数の差分には無関係）。
    const player0 = emptyPlayer(["1z", "1z", "1z", "2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "9s", "9m", "9m"]);
    const drawnTile = player0.hand.concealed[player0.hand.concealed.length - 1]!; // 末尾の9m
    const round = makeRound({
      players: [{ ...player0, riichi: true }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
      // リーチ宣言済み＝少なくとも1巡目の打牌は既に済んでいるはずなので、
      // 天和/地和（firstTurnWin）の条件には該当させない。
      anyCallOrRiichiMade: true,
      // makeWallのdeadWallは常に[1z,2z,3z,4z,1z,2z,3z,4z,1z,2z,3z,4z,1z,2z]、
      // revealedDoraCount=1固定。通常の裏ドラ表示牌はdeadWall[5]="2z"→ドラは3z
      // （手牌に無いので通常は0翻）。追加の裏ドラ表示牌はdeadWall[7]="4z"→
      // ドラは1z（手牌に3枚あるので+3翻）。
    });

    const withoutCard = { ...round, cardExtraUraDora: [false, false, false, false] as RoundState["cardExtraUraDora"] };
    const analysisWithout = canDeclareTsumo(withoutCard, 0)!;
    expect(analysisWithout.yaku.some((y) => y.name === "裏ドラ")).toBe(false);

    const withCard = { ...round, cardExtraUraDora: [true, false, false, false] as RoundState["cardExtraUraDora"] };
    const analysisWith = canDeclareTsumo(withCard, 0)!;
    const uraDoraYaku = analysisWith.yaku.find((y) => y.name === "裏ドラ");
    expect(uraDoraYaku?.han).toBe(3);
    expect(analysisWith.han).toBe(analysisWithout.han + 3);
  });

  it("does not add the extra indicator to a non-riichi win", () => {
    const player0 = emptyPlayer(["1z", "1z", "1z", "2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "9s", "9m", "9m"]);
    const drawnTile = player0.hand.concealed[player0.hand.concealed.length - 1]!;
    const round = makeRound({
      players: [{ ...player0, riichi: false }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
      cardExtraUraDora: [true, false, false, false],
    });
    const analysis = canDeclareTsumo(round, 0)!;
    expect(analysis.yaku.some((y) => y.name === "裏ドラ")).toBe(false);
  });
});

describe("bust-guard card (箱割れ防止)", () => {
  const round = makeRound({ players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] });

  it("clamps a negative score to 0 and consumes the card", () => {
    const withCard = { ...round, cardIds: ["bust-guard", null, null, null] as RoundState["cardIds"] };
    const { round: nextRound, scores } = applyCardBustGuards(withCard, [-500, 20000, 15000, 10000]);
    expect(scores).toEqual([0, 20000, 15000, 10000]);
    expect(nextRound.cardUsesRemaining[0]).toBe(0);
  });

  it("does nothing when the score is not negative", () => {
    const withCard = { ...round, cardIds: ["bust-guard", null, null, null] as RoundState["cardIds"] };
    const { round: nextRound, scores } = applyCardBustGuards(withCard, [500, 20000, 15000, 10000]);
    expect(scores).toEqual([500, 20000, 15000, 10000]);
    expect(nextRound.cardUsesRemaining[0]).toBe(1); // 未使用のまま（makeRoundのデフォルトは1）
  });

  it("does not save a seat without the card, or once already used up", () => {
    expect(applyCardBustGuards(round, [-500, 20000, 15000, 10000]).scores).toEqual([-500, 20000, 15000, 10000]);
    const usedUp = {
      ...round,
      cardIds: ["bust-guard", null, null, null] as RoundState["cardIds"],
      cardUsesRemaining: [0, 1, 1, 1] as RoundState["cardUsesRemaining"],
    };
    expect(applyCardBustGuards(usedUp, [-500, 20000, 15000, 10000]).scores).toEqual([-500, 20000, 15000, 10000]);
  });

  it("saves multiple seats independently in the same round", () => {
    const withCard = { ...round, cardIds: ["bust-guard", null, null, "bust-guard"] as RoundState["cardIds"] };
    const { scores, round: nextRound } = applyCardBustGuards(withCard, [-100, 20000, 15000, -200]);
    expect(scores).toEqual([0, 20000, 15000, 0]);
    expect(nextRound.cardUsesRemaining).toEqual([0, 1, 1, 0]);
  });
});

describe("insight card (偵察)", () => {
  it("onUse reveals all hands to the owner (same as kagerou's skill) and consumes the card", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["insight", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.handsRevealedTo).toBe(0);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });
});

describe("tile-count-insight card (牌読み)", () => {
  it("onUse reveals accurate wall counts to the owner (same as subaru's skill) and consumes the card", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["tile-count-insight", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.wallReadRevealedTo).toBe(0);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });
});

describe("furiten-clear card (フリテン解除)", () => {
  const tenpaiWaitingOn9m = ["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4z", "4z", "4z", "9m"] as TileCode[];
  const furitenPlayer1 = {
    ...emptyPlayer(tenpaiWaitingOn9m),
    discards: [{ tile: { id: "d1", code: "9m" as TileCode }, calledAway: false, isRiichiDeclaration: false, isTsumogiri: false }],
  };

  it("canDeclareRon bypasses furiten while the card is active, but not without it", () => {
    const round = makeRound({
      players: [emptyPlayer([]), furitenPlayer1, emptyPlayer([]), emptyPlayer([])],
      cardIds: [null, "furiten-clear", null, null],
    });
    expect(canDeclareRon(round, 1, "9m", 0)).not.toBeNull();

    const withoutCard = { ...round, cardIds: [null, null, null, null] as RoundState["cardIds"] };
    expect(canDeclareRon(withoutCard, 1, "9m", 0)).toBeNull();
  });

  it("consumes the card only when the ron actually needed the furiten bypass", () => {
    const round = makeRound({
      players: [emptyPlayer([]), furitenPlayer1, emptyPlayer([]), emptyPlayer([])],
      currentTurn: 0,
      phase: "awaiting-calls",
      pendingCallWindow: {
        discarderIndex: 0,
        discardTile: { id: "d2", code: "9m" },
        isChankan: false,
        // ロン宣言のみを単独で検証するため応答対象を1人に絞る
        // （複数人の応答待ち合わせはgameEngine.test.ts側で別途検証済み）。
        awaitingPlayers: [1],
        respondedBy: [],
        declaredCalls: [],
      },
      cardIds: [null, "furiten-clear", null, null],
    });
    const next = applyAction(round, { type: "ron", player: 1 });
    expect(next.result?.type).toBe("ron");
    expect(next.cardUsesRemaining[1]).toBe(0);
  });

  it("does not consume the card for a normal (non-furiten) ron", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer(tenpaiWaitingOn9m), emptyPlayer([]), emptyPlayer([])],
      currentTurn: 0,
      phase: "awaiting-calls",
      pendingCallWindow: {
        discarderIndex: 0,
        discardTile: { id: "d2", code: "9m" },
        isChankan: false,
        awaitingPlayers: [1],
        respondedBy: [],
        declaredCalls: [],
      },
      cardIds: [null, "furiten-clear", null, null],
    });
    const next = applyAction(round, { type: "ron", player: 1 });
    expect(next.cardUsesRemaining[1]).toBe(1);
  });
});

describe("uncallable-yakuhai card (鳴かれず)", () => {
  it("blocks pon on the discarder's guarded dragon tile (treated as a skip) and consumes the card", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1p", "1p", "1p", "2z"]),
        emptyPlayer(["5z", "5z", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      wall: makeWall(["5z", "9s", "9s", "9s"]),
      cardIds: ["uncallable-yakuhai", null, null, null],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    expect(round.lastDiscard!.tile.code).toBe("5z");

    const matchingIds = round.players[1]!.hand.concealed.filter((t) => t.code === "5z").map((t) => t.id);
    const afterPonAttempt = applyAction(round, { type: "pon", player: 1, usedHandTileIds: [matchingIds[0]!, matchingIds[1]!] });
    expect(afterPonAttempt.players[1]!.hand.melds.length).toBe(0); // ブロックされ、鳴きは成立しない
    expect(afterPonAttempt.phase).toBe("awaiting-calls"); // player2/3がまだ未応答なのでウィンドウは継続
    expect(afterPonAttempt.cardUsesRemaining[0]).toBe(0); // discarder(0)のカードが消費される
  });

  it("does not block pon on a non-dragon tile", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1p", "1p", "1p", "2z"]),
        emptyPlayer(["6m", "6m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      wall: makeWall(["6m", "9s", "9s", "9s"]),
      cardIds: ["uncallable-yakuhai", null, null, null],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    const matchingIds = round.players[1]!.hand.concealed.filter((t) => t.code === "6m").map((t) => t.id);
    let next = applyAction(round, { type: "pon", player: 1, usedHandTileIds: [matchingIds[0]!, matchingIds[1]!] });
    next = applyAction(next, { type: "skip", player: 2 });
    next = applyAction(next, { type: "skip", player: 3 });
    expect(next.players[1]!.hand.melds.some((m) => m.type === "pon")).toBe(true);
    expect(next.cardUsesRemaining[0]).toBe(1); // 消費されない
  });

  it("no longer blocks once the guard is already used up", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1p", "1p", "1p", "2z"]),
        emptyPlayer(["5z", "5z", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      wall: makeWall(["5z", "9s", "9s", "9s"]),
      cardIds: ["uncallable-yakuhai", null, null, null],
      cardUsesRemaining: [0, 1, 1, 1],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    const matchingIds = round.players[1]!.hand.concealed.filter((t) => t.code === "5z").map((t) => t.id);
    let next = applyAction(round, { type: "pon", player: 1, usedHandTileIds: [matchingIds[0]!, matchingIds[1]!] });
    next = applyAction(next, { type: "skip", player: 2 });
    next = applyAction(next, { type: "skip", player: 3 });
    expect(next.players[1]!.hand.melds.some((m) => m.type === "pon")).toBe(true);
  });
});

describe("ippatsu-extend card (一発延長)", () => {
  it("preserves the card holder's ippatsu through another player's pon, and consumes the card", () => {
    let round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1p", "1p", "1p", "2z"]), ippatsuActive: true },
        emptyPlayer(["6m", "6m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      wall: makeWall(["6m", "9s", "9s", "9s"]),
      cardIds: ["ippatsu-extend", null, null, null],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    const matchingIds = round.players[1]!.hand.concealed.filter((t) => t.code === "6m").map((t) => t.id);
    let next = applyAction(round, { type: "pon", player: 1, usedHandTileIds: [matchingIds[0]!, matchingIds[1]!] });
    next = applyAction(next, { type: "skip", player: 2 });
    next = applyAction(next, { type: "skip", player: 3 });

    expect(next.players[0]!.ippatsuActive).toBe(true); // 通常なら鳴きで消えるはずが維持される
    expect(next.cardUsesRemaining[0]).toBe(0);
  });

  it("does not preserve ippatsu once the card is already used up", () => {
    let round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1p", "1p", "1p", "2z"]), ippatsuActive: true },
        emptyPlayer(["6m", "6m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      wall: makeWall(["6m", "9s", "9s", "9s"]),
      cardIds: ["ippatsu-extend", null, null, null],
      cardUsesRemaining: [0, 1, 1, 1],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    const matchingIds = round.players[1]!.hand.concealed.filter((t) => t.code === "6m").map((t) => t.id);
    let next = applyAction(round, { type: "pon", player: 1, usedHandTileIds: [matchingIds[0]!, matchingIds[1]!] });
    next = applyAction(next, { type: "skip", player: 2 });
    next = applyAction(next, { type: "skip", player: 3 });

    expect(next.players[0]!.ippatsuActive).toBe(false);
  });
});

describe("no-cost-riichi card (ノーコストリーチ)", () => {
  const tenpaiHand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];

  it("does not add to kyotaku when declaring riichi with the card active, and consumes it", () => {
    let round = makeRound({
      players: [emptyPlayer(tenpaiHand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
      cardIds: ["no-cost-riichi", null, null, null],
      kyotaku: 0,
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });
    expect(round.players[0]!.riichi).toBe(true);
    expect(round.kyotaku).toBe(0); // 通常なら1になるはずが積まれない
    expect(round.cardUsesRemaining[0]).toBe(0);
  });

  it("a normal riichi without the card still adds to kyotaku", () => {
    let round = makeRound({
      players: [emptyPlayer(tenpaiHand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
      kyotaku: 0,
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });
    expect(round.kyotaku).toBe(1);
  });
});

describe("score-double card (大逆転の目)", () => {
  it("onUse arms cardScoreDoubled[owner] and consumes the card", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["score-double", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.cardScoreDoubled[0]).toBe(true);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });

  it("doubles the final tsumo payment (non-yakuman)", () => {
    // 2m3m4m + 5p6p7p + 7s8s9s + 1z1z1z + 9m9mの門前自摸手（役満ではない）。
    const player0 = emptyPlayer(["2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "9s", "1z", "1z", "1z", "9m", "9m"]);
    const drawnTile = player0.hand.concealed[player0.hand.concealed.length - 1]!;
    const round = makeRound({
      players: [player0, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
      result: { type: "tsumo", winners: [0], dealerContinues: true },
      // 天和（firstTurnWin）扱いにならないよう、1巡目ではないことを明示する。
      anyCallOrRiichiMade: true,
    });
    const outcomeWithout = computeRoundScoreOutcome(round);
    const withCard = { ...round, cardScoreDoubled: [true, false, false, false] as RoundState["cardScoreDoubled"] };
    const outcomeWith = computeRoundScoreOutcome(withCard);

    expect(outcomeWith.scoreDeltas[0]).toBe(outcomeWithout.scoreDeltas[0]! * 2);
  });

  it("does not double a yakuman win", () => {
    // 1z1z1z + 2z2z2z + 3z3z3z + 4z4z4z + 5z5zの大四喜（役満）。
    const player0 = emptyPlayer(["1z", "1z", "1z", "2z", "2z", "2z", "3z", "3z", "3z", "4z", "4z", "4z", "5z", "5z"]);
    const drawnTile = player0.hand.concealed[player0.hand.concealed.length - 1]!;
    const round = makeRound({
      players: [player0, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
      result: { type: "tsumo", winners: [0], dealerContinues: true },
      cardScoreDoubled: [true, false, false, false],
    });
    const analysis = canDeclareTsumo(round, 0)!;
    expect(analysis.isYakuman).toBe(true);
    const outcome = computeRoundScoreOutcome(round);
    const withoutCard = computeRoundScoreOutcome({ ...round, cardScoreDoubled: [false, false, false, false] });
    expect(outcome.scoreDeltas[0]).toBe(withoutCard.scoreDeltas[0]);
  });
});

describe("last-stand card (最後の粘り)", () => {
  const hand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];

  it("doubles gauge gain on the final hand of the match format", () => {
    let round = makeRound({
      players: [emptyPlayer(hand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "", "", ""],
      cardIds: ["last-stand", null, null, null],
      format: "tonpuusen",
      roundWind: 1,
      roundNumber: 4, // 東4局＝東風戦のオーラス
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9m", "9p", "9p", "9p"]),
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    expect(round.players[0]!.skillGauge).toBe(20); // 通常10のところ2倍
  });

  it("does not double gauge gain outside the final hand", () => {
    let round = makeRound({
      players: [emptyPlayer(hand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "", "", ""],
      cardIds: ["last-stand", null, null, null],
      format: "tonpuusen",
      roundWind: 1,
      roundNumber: 1, // オーラスではない
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9m", "9p", "9p", "9p"]),
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    expect(round.players[0]!.skillGauge).toBe(10);
  });
});

describe("kyotaku-collector card (供託回収)", () => {
  const round = makeRound({ players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] });
  const fallbackToTop = (scores: [number, number, number, number], kyotaku: number): [number, number, number, number] => {
    const next = [...scores] as [number, number, number, number];
    const topIndex = next.reduce((best, s, i) => (s > next[best]! ? i : best), 0);
    next[topIndex] = next[topIndex]! + kyotaku * 1000;
    return next;
  };

  it("routes leftover kyotaku to the holder instead of the fallback recipient", () => {
    const withCard = { ...round, cardIds: [null, null, null, "kyotaku-collector"] as RoundState["cardIds"] };
    const result = resolveKyotakuWithCard(withCard, [30000, 25000, 20000, 15000], 2, fallbackToTop);
    expect(result).toEqual([30000, 25000, 20000, 17000]);
  });

  it("falls back to the given function when no seat holds the card", () => {
    const result = resolveKyotakuWithCard(round, [30000, 25000, 20000, 15000], 2, fallbackToTop);
    expect(result).toEqual([32000, 25000, 20000, 15000]);
  });

  it("does nothing when there is no leftover kyotaku", () => {
    const withCard = { ...round, cardIds: [null, null, null, "kyotaku-collector"] as RoundState["cardIds"] };
    const result = resolveKyotakuWithCard(withCard, [30000, 25000, 20000, 15000], 0, fallbackToTop);
    expect(result).toEqual([30000, 25000, 20000, 15000]);
  });
});

describe("dealer-honba-boost card (親孝行)", () => {
  it("doubles the honba bonus when the holder wins as dealer", () => {
    const player0 = emptyPlayer(["2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "9s", "1z", "1z", "1z", "9m", "9m"]);
    const drawnTile = player0.hand.concealed[player0.hand.concealed.length - 1]!;
    const round = makeRound({
      players: [player0, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      dealerSeat: 0,
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
      honba: 2,
      result: { type: "tsumo", winners: [0], dealerContinues: true },
    });
    const without = computeRoundScoreOutcome(round);
    const withCard = { ...round, cardIds: ["dealer-honba-boost", null, null, null] as RoundState["cardIds"] };
    const withBoost = computeRoundScoreOutcome(withCard);
    // honba=2、ツモは3人払いなので通常ぶんの本場ボーナス合計は2*100*3=600。
    // 2倍になるので差分もその600ぶん増えるはず。
    expect(withBoost.scoreDeltas[0]! - without.scoreDeltas[0]!).toBe(2 * 100 * 3);
  });

  it("does not double the honba bonus when the holder is not the dealer", () => {
    const player1 = emptyPlayer(["2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "9s", "1z", "1z", "1z", "9m", "9m"]);
    const drawnTile = player1.hand.concealed[player1.hand.concealed.length - 1]!;
    const round = makeRound({
      players: [emptyPlayer([]), player1, emptyPlayer([]), emptyPlayer([])],
      dealerSeat: 0,
      currentTurn: 1,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
      honba: 2,
      result: { type: "tsumo", winners: [1], dealerContinues: false },
    });
    const without = computeRoundScoreOutcome(round);
    const withCard = { ...round, cardIds: [null, "dealer-honba-boost", null, null] as RoundState["cardIds"] };
    const withBoost = computeRoundScoreOutcome(withCard);
    expect(withBoost.scoreDeltas[1]).toBe(without.scoreDeltas[1]);
  });
});

describe("han-up-3 card (渾身の三翻)", () => {
  it("sets cardBonusHan[owner] to 3", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["han-up-3", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.cardBonusHan).toEqual([3, 0, 0, 0]);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });
});

describe("point-drain-small card (小銭拾い)", () => {
  it("sets a pendingScoreAdjustment of +1500 for the owner and -500 for each other seat", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: [null, "point-drain-small", null, null],
      currentTurn: 1,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 1 });
    expect(next.pendingScoreAdjustment).toEqual([-500, 1500, -500, -500]);
    expect(next.cardUsesRemaining[1]).toBe(0);
  });
});

describe("catch-up card (追い上げ)", () => {
  const round = makeRound({ players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] });
  const withCard = { ...round, cardIds: [null, null, "catch-up", null] as RoundState["cardIds"] };

  it("adds 3000 to the holder's final score when they are not in first place", () => {
    expect(applyCardMatchEndBonuses(withCard, [30000, 25000, 20000, 25000])).toEqual([30000, 25000, 23000, 25000]);
  });

  it("does nothing for the holder in first place (a tie for first counts as first)", () => {
    expect(applyCardMatchEndBonuses(withCard, [10000, 20000, 40000, 30000])).toEqual([10000, 20000, 40000, 30000]);
    expect(applyCardMatchEndBonuses(withCard, [10000, 20000, 30000, 30000])).toEqual([10000, 20000, 30000, 30000]);
  });
});

describe("gauge-boost card (ゲージ加速)", () => {
  const hand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];

  it("raises gauge gain by 1.5x on any hand", () => {
    let round = makeRound({
      players: [emptyPlayer(hand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "", "", ""],
      cardIds: ["gauge-boost", null, null, null],
      format: "tonpuusen",
      roundWind: 1,
      roundNumber: 1,
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9m", "9p", "9p", "9p"]),
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    expect(round.players[0]!.skillGauge).toBe(15); // 通常10のところ1.5倍
  });
});

describe("pair-guarantee card (対子確約)", () => {
  const pairsOf = (hand: Hand) => {
    const counts = new Map<string, number>();
    for (const t of hand.concealed) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
    return [...counts.values()].filter((c) => c >= 2).length;
  };

  it("brings the opening hand up to at least 3 pairs, keeping 13 tiles", () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const baseline = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""]);
      if (pairsOf(baseline.players[0]!.hand) >= 3) continue;
      const withCard = dealNewRound(
        1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""], undefined, undefined, false,
        ["pair-guarantee", null, null, null],
      );
      expect(pairsOf(withCard.players[0]!.hand)).toBeGreaterThanOrEqual(3);
      expect(withCard.players[0]!.hand.concealed.length).toBe(13);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("red-guarantee card (赤ドラ確約)", () => {
  it("forces at least one red five into the opening hand when the raw deal has none", () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const baseline = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""]);
      if (baseline.players[0]!.hand.concealed.some((t) => t.isRed)) continue;
      // 赤が山（引ける範囲）に無い配牌は不発になるので、この検証の対象外。
      if (!baseline.wall.liveTiles.some((t) => t.isRed)) continue;
      const withCard = dealNewRound(
        1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""], undefined, undefined, false,
        ["red-guarantee", null, null, null],
      );
      expect(withCard.players[0]!.hand.concealed.some((t) => t.isRed)).toBe(true);
      expect(withCard.players[0]!.hand.concealed.length).toBe(13);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("extra-dora card (新ドラ)", () => {
  it("reveals one more dora indicator and is consumed", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["extra-dora", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const before = round.wall.revealedDoraCount;
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.wall.revealedDoraCount).toBe(before + 1);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });
});

describe("gauge-fill card (気合充填)", () => {
  it("fills the holder's skill gauge to the character's maximum", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "", "", ""],
      cardIds: ["gauge-fill", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.players[0]!.skillGauge).toBe(CHARACTERS["hiiragi"]!.gaugeMax);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });

  it("does nothing for a seat without a character", () => {
    const round = makeRound({
      players: [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      cardIds: ["gauge-fill", null, null, null],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.players[0]!.skillGauge).toBe(0);
  });
});

describe("yakuhai-guarantee card (役牌確約)", () => {
  // 東1局・親は座席0。座席0の自風・場風はどちらも東(1z)。
  const yakuhai = ["1z", "5z", "6z", "7z"];
  const hasYakuhaiPair = (hand: Hand) => yakuhai.some((c) => hand.concealed.filter((t) => t.code === c).length >= 2);

  it("gives the opening hand a yakuhai pair when the raw deal has none, keeping 13 tiles", () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const baseline = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""]);
      if (hasYakuhaiPair(baseline.players[0]!.hand)) continue;
      const withCard = dealNewRound(
        1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""], undefined, undefined, false,
        ["yakuhai-guarantee", null, null, null],
      );
      expect(hasYakuhaiPair(withCard.players[0]!.hand)).toBe(true);
      expect(withCard.players[0]!.hand.concealed.length).toBe(13);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("tanyao-guarantee card (断么確約)", () => {
  const yaochuCount = (hand: Hand) => hand.concealed.filter((t) => !isNumbered(t.code) || numberOf(t.code) === 1 || numberOf(t.code) === 9).length;

  it("replaces up to 4 terminals and honors with simples, keeping 13 tiles", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const baseline = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""]);
      const withCard = dealNewRound(
        1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""], undefined, undefined, false,
        ["tanyao-guarantee", null, null, null],
      );
      const before = yaochuCount(baseline.players[0]!.hand);
      expect(yaochuCount(withCard.players[0]!.hand)).toBe(Math.max(0, before - 4));
      expect(withCard.players[0]!.hand.concealed.length).toBe(13);
    }
  });
});

describe("weak ★1 cards", () => {
  const blank = () => [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] as RoundState["players"];

  it("point-drain-tiny takes 300 from each other seat", () => {
    const round = makeRound({ players: blank(), cardIds: [null, null, "point-drain-tiny", null], currentTurn: 2, phase: "awaiting-discard" });
    const next = applyAction(round, { type: "useCard", player: 2 });
    expect(next.pendingScoreAdjustment).toEqual([-300, -300, 900, -300]);
  });

  it("gauge-fill-small adds 40% of the gauge maximum without exceeding it", () => {
    const max = CHARACTERS["hiiragi"]!.gaugeMax;
    const round = makeRound({ players: blank(), characterIds: ["hiiragi", "", "", ""], cardIds: ["gauge-fill-small", null, null, null], currentTurn: 0, phase: "awaiting-discard" });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.players[0]!.skillGauge).toBe(Math.ceil(max * 0.4));
    const nearlyFull = { ...round, players: round.players.map((p, i) => (i === 0 ? { ...p, skillGauge: max - 1 } : p)) as RoundState["players"] };
    expect(applyAction(nearlyFull, { type: "useCard", player: 0 }).players[0]!.skillGauge).toBe(max);
  });

  it("peek-once reveals the next draw and can only be used once", () => {
    const round = makeRound({ players: blank(), cardIds: ["peek-once", null, null, null], currentTurn: 0, phase: "awaiting-discard" });
    const next = applyAction(round, { type: "useCard", player: 0 });
    expect(next.players[0]!.revealedFutureDraws).toHaveLength(1);
    expect(next.cardUsesRemaining[0]).toBe(0);
  });

  it("last-place-small and catch-up-small add their small bonuses", () => {
    const round = makeRound({ players: blank() });
    const lastSmall = { ...round, cardIds: ["last-place-small", null, null, null] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(lastSmall, [10000, 20000, 15000, 30000])).toEqual([12000, 20000, 15000, 30000]);
    expect(applyCardMatchEndBonuses(lastSmall, [30000, 20000, 15000, 10000])).toEqual([30000, 20000, 15000, 10000]);
    const catchSmall = { ...round, cardIds: [null, "catch-up-small", null, null] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(catchSmall, [30000, 20000, 15000, 10000])).toEqual([30000, 21000, 15000, 10000]);
    expect(applyCardMatchEndBonuses(catchSmall, [10000, 40000, 15000, 10000])).toEqual([10000, 40000, 15000, 10000]);
  });

  it("gauge-boost-small raises gauge gain by 1.2x", () => {
    const hand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];
    let round = makeRound({
      players: [emptyPlayer(hand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "", "", ""],
      cardIds: ["gauge-boost-small", null, null, null],
      format: "tonpuusen",
      roundWind: 1,
      roundNumber: 1,
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9m", "9p", "9p", "9p"]),
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
    expect(round.players[0]!.skillGauge).toBe(12); // 通常10のところ1.2倍
  });

  it("the three deal-time cards keep 13 tiles and do what they say", () => {
    const pairsOf = (hand: Hand) => {
      const counts = new Map<string, number>();
      for (const t of hand.concealed) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
      return [...counts.values()].filter((c) => c >= 2).length;
    };
    const yaochu = (hand: Hand) => hand.concealed.filter((t) => !isNumbered(t.code) || numberOf(t.code) === 1 || numberOf(t.code) === 9).length;
    const yakuhai = ["1z", "5z", "6z", "7z"];
    for (let seed = 1; seed <= 30; seed++) {
      const deal = (card: string) =>
        dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""], undefined, undefined, false, [card, null, null, null]).players[0]!.hand;
      const base = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""]).players[0]!.hand;
      expect(deal("pair-guarantee-lite").concealed).toHaveLength(13);
      if (pairsOf(base) < 2) expect(pairsOf(deal("pair-guarantee-lite"))).toBeGreaterThanOrEqual(2);
      expect(yaochu(deal("tanyao-step"))).toBe(Math.max(0, yaochu(base) - 1));
      expect(deal("yakuhai-seed").concealed).toHaveLength(13);
      if (!base.concealed.some((t) => yakuhai.includes(t.code))) expect(deal("yakuhai-seed").concealed.some((t) => yakuhai.includes(t.code))).toBe(true);
    }
  });
});

describe("more weak ★1 cards", () => {
  const blank = () => [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] as RoundState["players"];

  it("dealer-tithe takes 1000 from the dealer, and does nothing when the holder is the dealer", () => {
    const base = { players: blank(), cardIds: [null, "dealer-tithe", null, null] as RoundState["cardIds"], currentTurn: 1 as const, phase: "awaiting-discard" as const };
    const fromDealer = applyAction(makeRound({ ...base, dealerSeat: 3 }), { type: "useCard", player: 1 });
    expect(fromDealer.pendingScoreAdjustment).toEqual([0, 1000, 0, -1000]);
    const asDealer = applyAction(makeRound({ ...base, dealerSeat: 1 }), { type: "useCard", player: 1 });
    expect(asDealer.pendingScoreAdjustment).toEqual(makeRound(base).pendingScoreAdjustment);
  });

  it("second-place-small and third-place-small only pay out at their own rank", () => {
    const round = makeRound({ players: blank() });
    const second = { ...round, cardIds: [null, null, null, "second-place-small"] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(second, [40000, 20000, 15000, 25000])).toEqual([40000, 20000, 15000, 26000]);
    expect(applyCardMatchEndBonuses(second, [40000, 30000, 15000, 10000])).toEqual([40000, 30000, 15000, 10000]);
    const third = { ...round, cardIds: ["third-place-small", null, null, null] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(third, [20000, 40000, 30000, 10000])).toEqual([21500, 40000, 30000, 10000]);
    expect(applyCardMatchEndBonuses(third, [10000, 40000, 30000, 20000])).toEqual([10000, 40000, 30000, 20000]);
  });

  it("gauge-savings adds a little gauge at every deal, capped at the maximum", () => {
    const deal = (gauge: number) => {
      const round = makeRound({ players: blank(), characterIds: ["hiiragi", "", "", ""], cardIds: ["gauge-savings", null, null, null] });
      const withGauge = { ...round, players: round.players.map((p, i) => (i === 0 ? { ...p, skillGauge: gauge } : p)) as RoundState["players"] };
      return CARDS["gauge-savings"]!.hooks.onDealHand!({ round: withGauge, owner: 0 }).players[0]!.skillGauge;
    };
    expect(deal(0)).toBe(3);
    expect(deal(CHARACTERS["hiiragi"]!.gaugeMax)).toBe(CHARACTERS["hiiragi"]!.gaugeMax);
  });

  it("the deal-time cards keep 13 tiles and do what they say", () => {
    const codeCount = (hand: Hand, codes: string[]) => hand.concealed.filter((t) => codes.includes(t.code)).length;
    const hasPair = (hand: Hand, codes: string[]) => codes.some((c) => hand.concealed.filter((t) => t.code === c).length >= 2);
    const honors = (hand: Hand) => hand.concealed.filter((t) => !isNumbered(t.code)).length;
    const suitCount = (hand: Hand) => {
      const counts = new Map<string, number>();
      for (const t of hand.concealed) if (isNumbered(t.code)) counts.set(suitOf(t.code), (counts.get(suitOf(t.code)) ?? 0) + 1);
      return Math.max(0, ...counts.values());
    };
    let sawWind = 0;
    let sawDragon = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const deal = (card: string) =>
        dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""], undefined, undefined, false, [card, null, null, null]).players[0]!.hand;
      const base = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""]).players[0]!.hand;
      for (const card of ["suit-lean", "seat-wind-pair", "dragon-pair", "honor-sweep"]) expect(deal(card).concealed).toHaveLength(13);
      expect(honors(deal("honor-sweep"))).toBe(Math.max(0, honors(base) - 2));
      expect(suitCount(deal("suit-lean"))).toBeGreaterThanOrEqual(suitCount(base));
      if (!hasPair(base, ["1z"])) {
        if (hasPair(deal("seat-wind-pair"), ["1z"])) sawWind++;
      }
      if (!hasPair(base, ["5z", "6z", "7z"]) && hasPair(deal("dragon-pair"), ["5z", "6z", "7z"])) sawDragon++;
      expect(codeCount(deal("seat-wind-pair"), ["1z"])).toBeGreaterThanOrEqual(codeCount(base, ["1z"]));
    }
    expect(sawWind).toBeGreaterThan(0);
    expect(sawDragon).toBeGreaterThan(0);
  });
});

describe("even more weak ★1 cards", () => {
  const blank = () => [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] as RoundState["players"];
  const dealHook = (card: string, round: RoundState, owner: 0 | 1 | 2 | 3 = 0) => CARDS[card]!.hooks.onDealHand!({ round, owner });
  const gaugeOf = (r: RoundState) => r.players[0]!.skillGauge;

  it("participation-prize adds 500 to the holder regardless of rank", () => {
    const round = { ...makeRound({ players: blank() }), cardIds: [null, "participation-prize", null, null] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(round, [40000, 20000, 15000, 25000])).toEqual([40000, 20500, 15000, 25000]);
    expect(applyCardMatchEndBonuses(round, [10000, 40000, 15000, 25000])).toEqual([10000, 40500, 15000, 25000]);
  });

  it("opening-gauge only works on the first hand of the match", () => {
    const first = makeRound({ players: blank(), characterIds: ["hiiragi", "", "", ""], roundWind: 1, roundNumber: 1, honba: 0 });
    expect(gaugeOf(dealHook("opening-gauge", first))).toBe(15);
    expect(gaugeOf(dealHook("opening-gauge", { ...first, roundNumber: 2 }))).toBe(0);
    expect(gaugeOf(dealHook("opening-gauge", { ...first, honba: 1 }))).toBe(0);
  });

  it("dealer-gauge only works while the holder is the dealer", () => {
    const round = makeRound({ players: blank(), characterIds: ["hiiragi", "", "", ""], dealerSeat: 0 });
    expect(gaugeOf(dealHook("dealer-gauge", round))).toBe(5);
    expect(gaugeOf(dealHook("dealer-gauge", { ...round, dealerSeat: 2 }))).toBe(0);
  });

  it("dora-neighbor puts a dora-adjacent tile in the opening hand and keeps 13 tiles", () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const deal = (cards?: [string | null, null, null, null]) =>
        dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""], undefined, undefined, false, cards);
      const base = deal();
      const doraCodes = doraIndicators(base.wall).map(nextTileForDora);
      const near = new Set<string>(doraCodes);
      for (const d of doraCodes) if (isNumbered(d)) for (const n of [numberOf(d) - 1, numberOf(d) + 1]) if (n >= 1 && n <= 9) near.add(`${n}${suitOf(d)}`);
      if (base.players[0]!.hand.concealed.some((t) => near.has(t.code))) continue;
      const withCard = deal(["dora-neighbor", null, null, null]);
      expect(withCard.players[0]!.hand.concealed.some((t) => near.has(t.code))).toBe(true);
      expect(withCard.players[0]!.hand.concealed).toHaveLength(13);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("last-stand-small raises gauge gain by 1.5x only on the final hand", () => {
    const hand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];
    const gain = (roundNumber: number) => {
      let round = makeRound({
        players: [emptyPlayer(hand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
        characterIds: ["hiiragi", "", "", ""],
        cardIds: ["last-stand-small", null, null, null],
        format: "tonpuusen",
        roundWind: 1,
        roundNumber,
        currentTurn: 0,
        phase: "awaiting-draw",
        wall: makeWall(["9m", "9p", "9p", "9p"]),
      });
      round = applyAction(round, { type: "draw", player: 0 });
      round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });
      return round.players[0]!.skillGauge;
    };
    expect(gain(4)).toBe(15);
    expect(gain(1)).toBe(10);
  });
});

describe("a sixth batch of weak ★1 cards", () => {
  const blank = () => [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] as RoundState["players"];

  it("gauge-fill-tiny adds 20% of the gauge maximum without exceeding it", () => {
    const max = CHARACTERS["hiiragi"]!.gaugeMax;
    const round = makeRound({ players: blank(), characterIds: ["hiiragi", "", "", ""], cardIds: ["gauge-fill-tiny", null, null, null], currentTurn: 0, phase: "awaiting-discard" });
    expect(applyAction(round, { type: "useCard", player: 0 }).players[0]!.skillGauge).toBe(Math.ceil(max * 0.2));
    const nearlyFull = { ...round, players: round.players.map((p, i) => (i === 0 ? { ...p, skillGauge: max - 1 } : p)) as RoundState["players"] };
    expect(applyAction(nearlyFull, { type: "useCard", player: 0 }).players[0]!.skillGauge).toBe(max);
  });

  it("top-place-trim pays only the winner (ties for first included)", () => {
    const round = { ...makeRound({ players: blank() }), cardIds: [null, "top-place-trim", null, null] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(round, [20000, 40000, 15000, 25000])).toEqual([20000, 40500, 15000, 25000]);
    expect(applyCardMatchEndBonuses(round, [40000, 40000, 10000, 10000])).toEqual([40000, 40500, 10000, 10000]);
    expect(applyCardMatchEndBonuses(round, [40000, 30000, 15000, 15000])).toEqual([40000, 30000, 15000, 15000]);
  });

  it("round-up-bonus rounds the holder's final score up to the next 1000", () => {
    const round = { ...makeRound({ players: blank() }), cardIds: [null, null, "round-up-bonus", null] as RoundState["cardIds"] };
    expect(applyCardMatchEndBonuses(round, [25100, 24800, 25300, 24800])).toEqual([25100, 24800, 26000, 24800]);
    expect(applyCardMatchEndBonuses(round, [25000, 25000, 25000, 25000])).toEqual([25000, 25000, 25000, 25000]);
    expect(applyCardMatchEndBonuses(round, [30000, 30000, -400, 40400])).toEqual([30000, 30000, 0, 40400]);
  });

  it("the deal-time cards keep 13 tiles and do what they say", () => {
    const pairsOf = (hand: Hand) => {
      const counts = new Map<string, number>();
      for (const t of hand.concealed) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
      return [...counts.values()].filter((c) => c >= 2).length;
    };
    const terminals = (hand: Hand) => hand.concealed.filter((t) => isNumbered(t.code) && (numberOf(t.code) === 1 || numberOf(t.code) === 9)).length;
    const east = (hand: Hand) => hand.concealed.filter((t) => t.code === "1z").length;
    let sawPair = 0;
    let sawEast = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const deal = (card: string) =>
        dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""], undefined, undefined, false, [card, null, null, null]).players[0]!.hand;
      const base = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(seed), ["", "", "", ""]).players[0]!.hand;
      for (const card of ["terminal-sweep", "pair-step", "round-wind-pair"]) expect(deal(card).concealed).toHaveLength(13);
      expect(terminals(deal("terminal-sweep"))).toBe(Math.max(0, terminals(base) - 2));
      if (pairsOf(deal("pair-step")) === pairsOf(base) + 1) sawPair++;
      expect(pairsOf(deal("pair-step"))).toBeGreaterThanOrEqual(pairsOf(base));
      if (east(base) < 2 && east(deal("round-wind-pair")) >= 2) sawEast++;
    }
    expect(sawPair).toBeGreaterThan(0);
    expect(sawEast).toBeGreaterThan(0);
  });
});

describe("a seventh batch of weak ★1 cards", () => {
  const blank = () => [emptyPlayer([]), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])] as RoundState["players"];
  const holding = (card: string, seat: 0 | 1 | 2 | 3 = 0) => {
    const cardIds: RoundState["cardIds"] = [null, null, null, null];
    cardIds[seat] = card;
    return { ...makeRound({ players: blank() }), cardIds };
  };

  it("close-race pays only when someone above is within 1000 points", () => {
    expect(applyCardMatchEndBonuses(holding("close-race"), [24500, 30000, 25500, 20000])).toEqual([25000, 30000, 25500, 20000]);
    expect(applyCardMatchEndBonuses(holding("close-race"), [24400, 30000, 25500, 20000])).toEqual([24400, 30000, 25500, 20000]);
    expect(applyCardMatchEndBonuses(holding("close-race"), [30000, 29500, 20000, 20500])).toEqual([30000, 29500, 20000, 20500]);
  });

  it("soften-defeat, big-win-afterglow and origin-blessing pay at their own thresholds", () => {
    expect(applyCardMatchEndBonuses(holding("soften-defeat"), [9900, 40000, 30000, 20100])).toEqual([10900, 40000, 30000, 20100]);
    expect(applyCardMatchEndBonuses(holding("soften-defeat"), [10000, 40000, 30000, 20000])).toEqual([10000, 40000, 30000, 20000]);
    expect(applyCardMatchEndBonuses(holding("big-win-afterglow", 1), [20000, 40000, 20000, 20000])).toEqual([20000, 40500, 20000, 20000]);
    expect(applyCardMatchEndBonuses(holding("big-win-afterglow", 1), [20000, 39900, 20000, 20100])).toEqual([20000, 39900, 20000, 20100]);
    expect(applyCardMatchEndBonuses(holding("origin-blessing", 2), [25000, 25000, 24000, 26000])).toEqual([25000, 25000, 24300, 26000]);
    expect(applyCardMatchEndBonuses(holding("origin-blessing", 2), [25000, 25000, 26100, 23900])).toEqual([25000, 25000, 26100, 23900]);
  });

  it("dealer-collection takes 400 from each seat only while the holder is the dealer", () => {
    const base = { players: blank(), cardIds: [null, "dealer-collection", null, null] as RoundState["cardIds"], currentTurn: 1 as const, phase: "awaiting-discard" as const };
    const asDealer = applyAction(makeRound({ ...base, dealerSeat: 1 }), { type: "useCard", player: 1 });
    expect(asDealer.pendingScoreAdjustment).toEqual([-400, 1200, -400, -400]);
    const notDealer = applyAction(makeRound({ ...base, dealerSeat: 3 }), { type: "useCard", player: 1 });
    expect(notDealer.pendingScoreAdjustment).toEqual(makeRound(base).pendingScoreAdjustment);
  });
});
