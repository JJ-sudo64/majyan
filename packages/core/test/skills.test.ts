import { describe, expect, it } from "vitest";
import type { TileCode } from "../src/tiles.js";
import type { Hand, Meld } from "../src/hand.js";
import type { PlayerRoundState, RoundState } from "../src/gameState.js";
import type { PlayerIndex } from "../src/actions.js";
import { applyAction, canDeclareRon, canDeclareTsumo, canRiichi, canSwapStartingTile, canUseSkill } from "../src/gameEngine.js";
import { CHARACTERS } from "../src/characters.js";
import { dealNewRound } from "../src/matchFormat.js";
import { calcShanten } from "../src/shanten.js";
import { uraDoraIndicators, doraIndicators, type WallState } from "../src/wall.js";
import { nextTileForDora, isNumbered, numberOf, suitOf } from "../src/tiles.js";

function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// characters.tsのfindCompleteMeldTilesとは独立に、メビウスの「陰陽配牌」の
// 結果検証用に手牌が完成した面子(刻子/順子)を持つかどうかだけを判定する。
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

let idc = 0;
function tile(code: TileCode) {
  return { id: `s${idc++}`, code };
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
    openRiichi: false,
    guaranteedUraDora: false,
    revealedFutureDraws: [],
    futopparaPending: false,
    guaranteedUsefulDraw: false,
    bettaoriActive: false,
    bettaoriShield: false,
    atomicRiichi: false,
    timeStopTurnsRemaining: 0,
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
    characterIds: ["hiiragi", "nagi", "", ""],
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

describe("skill gauge", () => {
  it("increases by gaugePerTurn on a discard", () => {
    const round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]),
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
    });
    const withDraw = applyAction(round, { type: "draw", player: 0 });
    const next = applyAction(withDraw, { type: "discard", player: 0, tileId: withDraw.lastDrawnTile!.id, tsumogiri: true });
    expect(next.players[0]!.skillGauge).toBe(CHARACTERS.hiiragi!.gaugePerTurn);
  });

  it("caps at gaugeMax instead of overflowing", () => {
    const gaugeMax = CHARACTERS.hiiragi!.gaugeMax;
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), skillGauge: gaugeMax - 3 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
    });
    const withDraw = applyAction(round, { type: "draw", player: 0 });
    const next = applyAction(withDraw, { type: "discard", player: 0, tileId: withDraw.lastDrawnTile!.id, tsumogiri: true });
    expect(next.players[0]!.skillGauge).toBe(gaugeMax); // gaugePerTurn(10)分足すと超えるが上限で頭打ち
  });

  it("canUseSkill is true only on own turn, in awaiting-discard, with a full gauge", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: { id: "drawn1", code: "3z" },
    });
    expect(canUseSkill(round, 0)).toBe(true);
    expect(canUseSkill(round, 1)).toBe(false); // 自分の手番ではない
    expect(canUseSkill({ ...round, phase: "awaiting-draw" }, 0)).toBe(false); // 打牌前フェーズではない
  });

  it("hiiragi's onActivate reveals one more dora indicator and resets gauge to 0", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: { id: "drawn1", code: "3z" },
    });
    expect(round.wall.revealedDoraCount).toBe(1);

    const next = applyAction(round, { type: "useSkill", player: 0 });
    expect(next.wall.revealedDoraCount).toBe(2);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("nagi cannot activate right after calling pon/chi, when lastDrawnTile is stale and not in her own hand (regression: caused a silent throw that froze the CPU auto-use loop)", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["nagi", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      // 直前まで打牌していた誰か（例えば player3）の自摸牌が、poh/chiで手番が
      // 移った後も上書きされずそのまま残っている状態を再現する。この牌は
      // player0(nagi)の手牌には存在しない。
      lastDrawnTile: { id: "stale-draw", code: "9m" },
      wall: makeWall(["5z", "9s", "9s", "9s"]),
    });

    expect(canUseSkill(round, 0)).toBe(false);
    expect(() => applyAction(round, { type: "useSkill", player: 0 })).toThrow();
  });

  it("nagi's onActivate returns the drawn tile to the wall and redraws a new one", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["nagi", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: makeWall(["5z", "9s", "9s", "9s"]),
    });
    const drawn = { id: "drawnX", code: "3z" as TileCode };
    const roundWithDraw: RoundState = {
      ...round,
      lastDrawnTile: drawn,
      players: [{ ...round.players[0]!, hand: { ...round.players[0]!.hand, concealed: [...round.players[0]!.hand.concealed, drawn] } }, round.players[1]!, round.players[2]!, round.players[3]!],
    };
    const handSizeBefore = roundWithDraw.players[0]!.hand.concealed.length;
    const liveBefore = roundWithDraw.wall.liveTiles.length;

    const next = applyAction(roundWithDraw, { type: "useSkill", player: 0 });

    expect(next.players[0]!.hand.concealed.length).toBe(handSizeBefore); // 1枚戻して1枚引き直すので枚数は変わらない
    expect(next.players[0]!.hand.concealed.some((t) => t.id === drawn.id)).toBe(false); // 元のツモ牌は手牌から消える
    expect(next.wall.liveTiles.length).toBe(liveBefore); // 山に1枚戻して先頭を1枚引く＝正味±0
    expect(next.lastDrawnTile!.code).toBe("5z"); // 山の先頭牌を引き直した
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("dealing into a ron grants a bonus gauge gain (comeback element)", () => {
    let round = makeRound({
      players: [
        emptyPlayer(["2m", "3m", "4p", "5p", "6p", "3s", "4s", "5s", "6s", "7s", "8s", "9p", "9p"]),
        emptyPlayer(["4m", "1p", "2p", "3p", "5p", "6p", "7p", "2s", "3s", "4s", "6z", "6z", "6z"]),
        emptyPlayer(["6m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["hiiragi", "hiiragi", "", ""],
      currentTurn: 1,
      wall: makeWall(["1s", "9s", "9s", "9s"]),
    });

    round = applyAction(round, { type: "draw", player: 1 });
    round = applyAction(round, {
      type: "discard",
      player: 1,
      tileId: round.players[1]!.hand.concealed.find((t) => t.code === "4m")!.id,
      tsumogiri: false,
    });
    const gaugeAfterOwnTurn = round.players[1]!.skillGauge;
    expect(gaugeAfterOwnTurn).toBe(CHARACTERS.hiiragi!.gaugePerTurn);

    round = applyAction(round, { type: "ron", player: 0 });
    for (const p of [2, 3] as const) round = applyAction(round, { type: "skip", player: p });
    expect(round.result?.type).toBe("ron");

    const expectedGauge = Math.min(CHARACTERS.hiiragi!.gaugeMax, gaugeAfterOwnTurn + CHARACTERS.hiiragi!.gaugePerDealIn);
    expect(round.players[1]!.skillGauge).toBe(expectedGauge);
    expect(round.players[1]!.skillGauge).toBeGreaterThan(gaugeAfterOwnTurn);
  });

  it("raiko can only use her skill while ippatsu is active", () => {
    // canActivateはippatsuActiveに加えてhasOwnPendingDraw（lastDrawnTileが本人の
    // 手牌に実在すること）も見るため、lastDrawnTileは手牌中の実物の牌を指す必要がある。
    const player0Hand = emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z", "3z"]);
    const drawnTile = player0Hand.hand.concealed[player0Hand.hand.concealed.length - 1]!;
    const round = makeRound({
      players: [
        { ...player0Hand, skillGauge: 100, ippatsuActive: false },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["raiko", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
    });
    expect(canUseSkill(round, 0)).toBe(false); // 一発中でないので発動不可

    const ippatsuRound: RoundState = {
      ...round,
      players: [{ ...round.players[0]!, ippatsuActive: true }, round.players[1]!, round.players[2]!, round.players[3]!],
    };
    expect(canUseSkill(ippatsuRound, 0)).toBe(true);
  });

  it("raiko's onActivate pulls a waiting tile out of the live wall in place of the current draw", () => {
    // 手牌: 1m2m3m 4p5p6p 7s8s9s 1z1z1z 2z + 自摸2z → 2z待ちのシャンポン/単騎ではなく
    // 2zをもう1枚引けば1z1z1z+2z2zで七対子ではなく通常形が完成する組み合わせにする。
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), skillGauge: 100, ippatsuActive: true },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["raiko", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: makeWall(["5z", "2z", "9s", "9s"]), // 2z (待ち牌) が山の2枚目に埋まっている
    });
    const drawn = { id: "drawnX", code: "9p" as TileCode }; // 待ちに絡まないハズレ牌を自摸した状況
    const roundWithDraw: RoundState = {
      ...round,
      lastDrawnTile: drawn,
      players: [
        { ...round.players[0]!, hand: { ...round.players[0]!.hand, concealed: [...round.players[0]!.hand.concealed, drawn] } },
        round.players[1]!,
        round.players[2]!,
        round.players[3]!,
      ],
    };
    const liveBefore = roundWithDraw.wall.liveTiles.length;

    const next = applyAction(roundWithDraw, { type: "useSkill", player: 0 });

    expect(next.lastDrawnTile!.code).toBe("2z"); // 山に埋まっていた待ち牌を強制的に引いた
    expect(next.players[0]!.hand.concealed.some((t) => t.id === drawn.id)).toBe(false); // ハズレ牌は手牌から消える
    expect(next.wall.liveTiles.length).toBe(liveBefore); // 1枚抜いて1枚戻すので枚数は変わらない
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("raiko's onActivate whiffs (round unchanged besides gauge reset) if no waiting tile remains in the live wall", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), skillGauge: 100, ippatsuActive: true },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["raiko", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: makeWall(["5z", "5z", "9s", "9s"]), // 待ち牌(2z)が山に残っていない
    });
    const drawn = { id: "drawnX", code: "9p" as TileCode };
    const roundWithDraw: RoundState = {
      ...round,
      lastDrawnTile: drawn,
      players: [
        { ...round.players[0]!, hand: { ...round.players[0]!.hand, concealed: [...round.players[0]!.hand.concealed, drawn] } },
        round.players[1]!,
        round.players[2]!,
        round.players[3]!,
      ],
    };

    const next = applyAction(roundWithDraw, { type: "useSkill", player: 0 });

    expect(next.lastDrawnTile!.id).toBe(drawn.id); // 不発なので自摸牌は変わらない
    expect(next.players[0]!.skillGauge).toBe(0); // 不発でもゲージは消費される
  });

  it("toki's onActivate reserves a guaranteed rinshan kaihou and resets gauge", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["toki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: { id: "drawn1", code: "3z" },
    });
    expect(round.players[0]!.guaranteedRinshan).toBe(false);

    const next = applyAction(round, { type: "useSkill", player: 0 });

    expect(next.players[0]!.guaranteedRinshan).toBe(true);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("ankan while tenpai with the guarantee active forces the rinshan draw into a waiting tile (rinshan kaihou) and consumes the guarantee", () => {
    const round = makeRound({
      players: [
        // 1z1z1z1zを暗槓すると 2m3m4m 5p6p7p 7s8s9s 5s(単騎待ち) で聴牌になる形。
        { ...emptyPlayer(["1z", "1z", "1z", "1z", "2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "9s", "5s"]), guaranteedRinshan: true },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["toki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: makeWall(["9p", "5s", "9p", "9p"]), // 待ち牌の5sが山の2枚目に埋まっている
    });

    const next = applyAction(round, { type: "ankan", player: 0, tileCode: "1z" });

    expect(next.lastDrawnTile!.code).toBe("5s"); // 山に埋まっていた待ち牌を強制的に嶺上ツモにした
    expect(next.isRinshanTurn).toBe(true);
    expect(next.players[0]!.guaranteedRinshan).toBe(false); // 権利は消費される
  });

  it("ankan while NOT tenpai leaves the guarantee untouched for a future kan", () => {
    const round = makeRound({
      players: [
        // 1z1z1z1zを暗槓しても残り(2m3m4m 5p6p7p 7s8s 5s 9m)は聴牌にならない形。
        { ...emptyPlayer(["1z", "1z", "1z", "1z", "2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "5s", "9m"]), guaranteedRinshan: true },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["toki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: makeWall(["5s", "9p", "9p", "9p"]),
    });

    const next = applyAction(round, { type: "ankan", player: 0, tileCode: "1z" });

    expect(next.players[0]!.guaranteedRinshan).toBe(true); // 聴牌でのカンではないので権利は温存される
  });

  it("ankan while tenpai whiffs (natural rinshan tile kept) if no waiting tile remains in the live wall, and still consumes the guarantee", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1z", "1z", "1z", "1z", "2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "9s", "5s"]), guaranteedRinshan: true },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["toki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: makeWall(["9p", "9p", "9p", "9p"]), // 待ち牌(5s)が山に残っていない
    });

    const next = applyAction(round, { type: "ankan", player: 0, tileCode: "1z" });

    expect(next.lastDrawnTile!.code).toBe("1z"); // makeWallのdeadWall[0]は"1z"なので不発時はそのまま
    expect(next.players[0]!.guaranteedRinshan).toBe(false); // 不発でも聴牌でのカンなので権利は消費される
  });

  it("kagerou's onActivate reveals hands to the owner and resets gauge", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["kagerou", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: { id: "drawn1", code: "3z" },
    });
    expect(round.handsRevealedTo).toBeNull();

    const next = applyAction(round, { type: "useSkill", player: 0 });

    expect(next.handsRevealedTo).toBe(0);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("kagerou's reveal survives the other three players' turns but clears on the owner's next draw (1巡)", () => {
    const round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]),
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["kagerou", "", "", ""],
      currentTurn: 1,
      phase: "awaiting-draw",
      handsRevealedTo: 0,
      wall: makeWall(["9s", "9s", "9s", "9s"]),
    });

    // 他家(player1)がツモっても、発動者(player0)本人の1巡がまだ終わっていないので消えない。
    const afterOther = applyAction(round, { type: "draw", player: 1 });
    expect(afterOther.handsRevealedTo).toBe(0);

    // 発動者本人がツモった瞬間＝1巡した瞬間に消える。
    const roundAtOwnerTurn = { ...afterOther, currentTurn: 0 as const, phase: "awaiting-draw" as const };
    const afterOwner = applyAction(roundAtOwnerTurn, { type: "draw", player: 0 });
    expect(afterOwner.handsRevealedTo).toBeNull();
  });

  it("runa's onActivate reserves a tile-swap right for next round and resets gauge", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["runa", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: { id: "drawn1", code: "3z" },
    });
    expect(round.players[0]!.pendingTileSwapNextRound).toBe(false);

    const next = applyAction(round, { type: "useSkill", player: 0 });

    expect(next.players[0]!.pendingTileSwapNextRound).toBe(true);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("canSwapStartingTile is true only while swaps remain and the player hasn't discarded/called yet", () => {
    const base = emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]);
    const round = makeRound({
      players: [
        { ...base, tileSwapsRemaining: 3 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      currentTurn: 1, // 自分の手番がまだ回ってきていない状態でも使えることを確認する
      phase: "awaiting-draw",
    });
    expect(canSwapStartingTile(round, 0)).toBe(true);

    const noSwapsLeft: RoundState = { ...round, players: [{ ...base, tileSwapsRemaining: 0 }, round.players[1]!, round.players[2]!, round.players[3]!] };
    expect(canSwapStartingTile(noSwapsLeft, 0)).toBe(false);

    const alreadyDiscarded: RoundState = {
      ...round,
      players: [
        { ...base, tileSwapsRemaining: 3, discards: [{ tile: { id: "d1", code: "9m" }, calledAway: false, isRiichiDeclaration: false, isTsumogiri: false }] },
        round.players[1]!,
        round.players[2]!,
        round.players[3]!,
      ],
    };
    expect(canSwapStartingTile(alreadyDiscarded, 0)).toBe(false);
  });

  it("swapTiles exchanges all chosen tiles at once, draws replacements, and zeroes out the counter", () => {
    const player0 = emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]);
    const targetTileIds = player0.hand.concealed.slice(0, 3).map((t) => t.id); // "1m","2m","3m"
    const round = makeRound({
      players: [
        { ...player0, tileSwapsRemaining: 3 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9p", "8p", "7p", "6p"]),
    });
    const liveBefore = round.wall.liveTiles.length;

    const next = applyAction(round, { type: "swapTiles", player: 0, tileIds: targetTileIds });

    for (const id of targetTileIds) {
      expect(next.players[0]!.hand.concealed.some((t) => t.id === id)).toBe(false); // 交換した牌は手牌から消える
    }
    for (const code of ["9p", "8p", "7p"]) {
      expect(next.players[0]!.hand.concealed.some((t) => t.code === code)).toBe(true); // 山の先頭3枚を引き直した
    }
    expect(next.players[0]!.hand.concealed.length).toBe(13); // 3枚戻して3枚引くので枚数は変わらない
    expect(next.wall.liveTiles.length).toBe(liveBefore); // 山の合計枚数も変わらない
    expect(next.players[0]!.tileSwapsRemaining).toBe(0);
  });

  it("swapTiles rejects a count that doesn't match the remaining swap right exactly", () => {
    const player0 = emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]);
    const round = makeRound({
      players: [
        { ...player0, tileSwapsRemaining: 3 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      currentTurn: 0,
      phase: "awaiting-draw",
    });
    const oneTileId = round.players[0]!.hand.concealed[0]!.id;
    expect(() => applyAction(round, { type: "swapTiles", player: 0, tileIds: [oneTileId] })).toThrow();
  });

  it("gaining skill gauge is frozen while a tile-swap right is pending, and resumes once the new round grants it", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["2m", "3m", "4p", "5p", "6p", "3s", "4s", "5s", "6s", "7s", "8s", "9p", "9p"]), pendingTileSwapNextRound: true, skillGauge: 0 },
        emptyPlayer(["4m", "1p", "2p", "3p", "5p", "6p", "7p", "2s", "3s", "4s", "6z", "6z", "6z"]),
        emptyPlayer(["6m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["runa", "hiiragi", "", ""],
      currentTurn: 0,
      wall: makeWall(["1s", "9s", "9s", "9s"]),
    });

    let next = applyAction(round, { type: "draw", player: 0 });
    next = applyAction(next, { type: "discard", player: 0, tileId: next.lastDrawnTile!.id, tsumogiri: true });

    expect(next.players[0]!.skillGauge).toBe(0); // pendingTileSwapNextRoundの間はゲージが増えない
  });

  it("subaru's onActivate reveals accurate wall counts to the owner for the rest of the round, and resets gauge", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["subaru", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: { id: "drawn1", code: "3z" },
    });
    expect(round.wallReadRevealedTo).toBeNull();

    const next = applyAction(round, { type: "useSkill", player: 0 });

    expect(next.wallReadRevealedTo).toBe(0);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("kaede cannot activate while already tenpai", () => {
    const round = makeRound({
      players: [
        // 1m2m3m 4p5p6p 7s8s9s 1z1z1z + 2z(単騎) のテンパイ形。
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["kaede", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: { id: "drawn1", code: "9m" },
    });
    // lastDrawnTileが手牌に実在しないと別の理由(hasOwnPendingDraw)でfalseになって
    // しまうため、実際に手牌へ加えたうえでテンパイ判定そのものを検証する。
    const drawn = { id: "drawnX", code: "9m" as TileCode };
    const roundWithDraw: RoundState = {
      ...round,
      lastDrawnTile: drawn,
      players: [
        { ...round.players[0]!, hand: { ...round.players[0]!.hand, concealed: [...round.players[0]!.hand.concealed, drawn] } },
        round.players[1]!,
        round.players[2]!,
        round.players[3]!,
      ],
    };
    expect(canUseSkill(roundWithDraw, 0)).toBe(false);
  });

  it("kaede's onActivate swaps in a tile that reduces shanten when not yet tenpai, and does nothing when tenpai already", () => {
    // 1m3m5m(浮き牌混じり) 4p6p(嵌張) 2s3s4s 6s7s8s(完成×2) 9p9p(頭) の1シャンテン。
    const player0Hand = emptyPlayer(["1m", "3m", "5m", "4p", "6p", "2s", "3s", "4s", "6s", "7s", "8s", "9p", "9p"]);
    const drawn = { id: "drawnX", code: "9s" as TileCode }; // 何の役にも立たない浮き牌をツモった想定
    const round = makeRound({
      players: [
        {
          ...player0Hand,
          skillGauge: 100,
          hand: { ...player0Hand.hand, concealed: [...player0Hand.hand.concealed, drawn] },
        },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["kaede", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawn,
      // 2m(1m3mの嵌張を埋めてテンパイに進める有効牌)を山に仕込んでおく。
      wall: makeWall(["9p", "2m", "5z", "5z"]),
    });
    expect(canUseSkill(round, 0)).toBe(true);

    const next = applyAction(round, { type: "useSkill", player: 0 });

    expect(next.lastDrawnTile!.code).toBe("2m"); // 山に仕込んだ有効牌に強制的にすり替わった
    expect(next.players[0]!.hand.concealed.some((t) => t.id === drawn.id)).toBe(false); // 元の浮き牌は消える
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("ren's guaranteedUraDora forces the first ura-dora indicator to match the winner's most common tile on a riichi tsumo", () => {
    // 5m5m5m(最多牌) + 1p2p3p + 4p5p6p + 7s8s9s + 2z2z の和了形。
    const player0Hand = emptyPlayer(["5m", "5m", "5m", "1p", "2p", "3p", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z"]);
    const drawnTile = player0Hand.hand.concealed[player0Hand.hand.concealed.length - 1]!; // 末尾の2z
    const round = makeRound({
      players: [
        { ...player0Hand, riichi: true, guaranteedUraDora: true },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "3z", "3z", "3z"]),
        emptyPlayer(["5m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "8m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["ren", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
      // 5mをドラにする表示牌は4m。5mが最多牌のはずなので、この4mが
      // 最初の裏ドラ表示牌に入れ替わるはず。
      wall: makeWall(["4m", "9p", "9p"]),
    });
    expect(canDeclareTsumo(round, 0)).toBeTruthy();

    const next = applyAction(round, { type: "tsumo", player: 0 });

    expect(next.result?.type).toBe("tsumo");
    expect(next.players[0]!.guaranteedUraDora).toBe(false); // 消費される
    expect(uraDoraIndicators(next.wall)).toEqual(["4m"]);
  });

  it("ren's guaranteedUraDora whiffs silently (but still consumes the flag) if the target indicator tile isn't left in the live wall", () => {
    const player0Hand = emptyPlayer(["5m", "5m", "5m", "1p", "2p", "3p", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z"]);
    const drawnTile = player0Hand.hand.concealed[player0Hand.hand.concealed.length - 1]!;
    const round = makeRound({
      players: [
        { ...player0Hand, riichi: true, guaranteedUraDora: true },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "3z", "3z", "3z"]),
        emptyPlayer(["5m", "6m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "8m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["ren", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      lastDrawnTile: drawnTile,
      // 4m(狙いの表示牌)が山に残っていない状況。
      wall: makeWall(["9p", "9p", "9p"]),
    });

    const next = applyAction(round, { type: "tsumo", player: 0 });

    expect(next.players[0]!.guaranteedUraDora).toBe(false); // 不発でもフラグは消費される
    expect(uraDoraIndicators(next.wall)).toEqual(uraDoraIndicators(round.wall)); // 表示牌は変わらない
  });

  it("mirai's onActivate reveals the tile codes at wall positions 3, 7, and 11 (her next three own draws under normal rotation)", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["mirai", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      // index: 0=1m 1=2m 2=3m 3=4m 4=5m 5=6m 6=7m 7=8m 8=9m 9=1p 10=2p 11=3p
      wall: makeWall(["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p"]),
    });
    expect(canUseSkill(round, 0)).toBe(true);

    const next = applyAction(round, { type: "useSkill", player: 0 });

    expect(next.players[0]!.revealedFutureDraws).toEqual(["4m", "8m", "3p"]);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("mirai's revealedFutureDraws survives the other three players' turns but clears on the owner's next draw (1巡)", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), revealedFutureDraws: ["4m", "8m", "3p"] },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["mirai", "", "", ""],
      currentTurn: 1,
      phase: "awaiting-draw",
      wall: makeWall(["9s", "9s", "9s", "9s"]),
    });

    // 他家(player1)がツモっても、発動者(player0)本人の1巡がまだ終わっていないので消えない。
    const afterOther = applyAction(round, { type: "draw", player: 1 });
    expect(afterOther.players[0]!.revealedFutureDraws).toEqual(["4m", "8m", "3p"]);

    // 発動者本人がツモった瞬間＝1巡した瞬間に消える。
    const roundAtOwnerTurn = { ...afterOther, currentTurn: 0 as const, phase: "awaiting-draw" as const };
    const afterOwner = applyAction(roundAtOwnerTurn, { type: "draw", player: 0 });
    expect(afterOwner.players[0]!.revealedFutureDraws).toEqual([]);
  });

  it("saki's onBeforeDraw pre-swaps the about-to-be-drawn tile for one matching the current dora indicator", () => {
    // makeWallの固定deadWallパターン(1z,2z,3z,4z...)では、最初の(revealedDoraCount=1
    // ぶんの)表ドラ表示牌はdeadWall[4]="1z"、つまり実際のドラは"2z"(東→南)になる。
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["saki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9p", "2z", "9s"]), // 9pはドラ対象外、2zが実際のドラ
    });

    const next = applyAction(round, { type: "draw", player: 0 });

    expect(next.lastDrawnTile!.code).toBe("2z"); // 引く前に山の先頭がドラ牌にすり替わっている
    expect(next.players[0]!.hand.concealed.some((t) => t.code === "9p")).toBe(false); // 元々先頭にあった無関係牌は引いていない
    expect(next.wall.liveTiles.map((t) => t.code)).toEqual(["9p", "9s"]); // すり替えられた牌は山に残る
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("saki's onBeforeDraw also accepts a red-five even when its own code doesn't match the current dora indicator", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["saki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: {
        // deadWall[4]="1z" → 表ドラは"2z"。ここには無関係な赤5mだけを置く。
        liveTiles: [{ id: "9p1", code: "9p" }, { id: "red5m", code: "5m", isRed: true }, { id: "9s1", code: "9s" }],
        deadWall: makeWall([]).deadWall,
        revealedDoraCount: 1,
        rinshanDrawn: 0,
      },
    });

    const next = applyAction(round, { type: "draw", player: 0 });

    expect(next.lastDrawnTile!.code).toBe("5m");
    expect(next.lastDrawnTile!.isRed).toBe(true); // 赤ドラを引いた
  });

  it("saki's onBeforeDraw whiffs (draws the original tile unchanged) but still resets the gauge if no dora/aka-dora tile remains in the live wall", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "3z"]), skillGauge: 100 },
        emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]),
        emptyPlayer(["5m", "5m", "5m", "4p", "5p", "6p", "7s", "8s", "9s", "4z", "4z", "5z", "5z"]),
        emptyPlayer(["7m", "7m", "7m", "4p", "5p", "6p", "7s", "8s", "9s", "6z", "6z", "7z", "7z"]),
      ],
      characterIds: ["saki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9p", "9s", "6m"]), // ドラ(2z)も赤ドラも山に残っていない
    });
    const expectedId = round.wall.liveTiles[0]!.id;

    const next = applyAction(round, { type: "draw", player: 0 });

    expect(next.lastDrawnTile!.id).toBe(expectedId); // 不発なので元々の先頭牌をそのまま引く
    expect(next.players[0]!.skillGauge).toBe(0); // 不発でもゲージは消費される
  });

  it("does not trigger on gauge alone when it isn't saki's own draw", () => {
    const round = makeRound({
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]),
        { ...emptyPlayer(["3m", "3m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "2z", "2z", "3z", "3z"]), skillGauge: 100 },
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["hiiragi", "saki", "", ""],
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9p", "2z", "9s"]),
    });
    const expectedId = round.wall.liveTiles[0]!.id;

    const next = applyAction(round, { type: "draw", player: 0 });

    expect(next.lastDrawnTile!.id).toBe(expectedId); // player0の自摸なのでサキ(player1)の効果は無関係
    expect(next.players[1]!.skillGauge).toBe(100); // サキ自身のゲージも消費されない
  });
});

describe("naoki's passive onDealHand (クマクマタイム)", () => {
  it("does nothing when dealerRenchanByWin is false, even if honba > 0 (e.g. a draw-based renchan)", () => {
    // 本場は付いている（荒牌流局の親テンパイ継続・九種九牌流局等を想定）が、
    // 自分の和了による連荘ではないケース。honba単体では発動しないことを
    // 確認する（dealerWonRenchanを渡さない＝デフォルトfalse）。
    const withNaoki = dealNewRound(1, 1, 1, 0, 0, makeSeededRng(42), ["naoki", "hiiragi", "raiko", "toki"]);
    const withoutNaoki = dealNewRound(1, 1, 1, 0, 0, makeSeededRng(42), ["", "hiiragi", "raiko", "toki"]);

    expect(withNaoki.players[0]!.hand.concealed.map((t) => t.code)).toEqual(
      withoutNaoki.players[0]!.hand.concealed.map((t) => t.code),
    );
    expect(withNaoki.wall.liveTiles.map((t) => t.code)).toEqual(withoutNaoki.wall.liveTiles.map((t) => t.code));
  });

  it("drafts an improved (lower-or-equal shanten) starting hand when dealerRenchanByWin is true", () => {
    const withNaoki = dealNewRound(1, 1, 1, 0, 0, makeSeededRng(42), ["naoki", "hiiragi", "raiko", "toki"], undefined, undefined, true);
    const withoutNaoki = dealNewRound(1, 1, 1, 0, 0, makeSeededRng(42), ["", "hiiragi", "raiko", "toki"]);

    const naokiShanten = calcShanten(withNaoki.players[0]!.hand);
    const baselineShanten = calcShanten(withoutNaoki.players[0]!.hand);

    // ヒルクライム式（改善する交換だけ採用）なので素の配牌より悪化することは無い。
    expect(naokiShanten).toBeLessThanOrEqual(baselineShanten);

    // 他家3人の配牌・山の総枚数は変わらない（牌の交換だけで増減していない）。
    for (const seat of [1, 2, 3] as const) {
      expect(withNaoki.players[seat]!.hand.concealed.map((t) => t.code)).toEqual(
        withoutNaoki.players[seat]!.hand.concealed.map((t) => t.code),
      );
    }
    expect(withNaoki.wall.liveTiles.length).toBe(withoutNaoki.wall.liveTiles.length);
  });

  it("stops applying once the renchan is broken (dealer changes)", () => {
    // ナオキが親のまま連荘中から、親が交代して(honba=0に戻り)次局を迎えた状況。
    const nextDealer = 1; // ナオキ(0)ではない別の親に交代
    const withNaoki = dealNewRound(1, 2, 0, 0, nextDealer, makeSeededRng(7), ["naoki", "hiiragi", "raiko", "toki"]);
    const withoutNaoki = dealNewRound(1, 2, 0, 0, nextDealer, makeSeededRng(7), ["", "hiiragi", "raiko", "toki"]);

    // ナオキはもう親ではないので、そもそも彼のonDealHandは呼ばれず配牌は素のまま。
    expect(withNaoki.players[0]!.hand.concealed.map((t) => t.code)).toEqual(
      withoutNaoki.players[0]!.hand.concealed.map((t) => t.code),
    );
  });
});

describe("mebius's passive onDealHand (陰陽配牌)", () => {
  // 以下のシードは、素の配牌(dealNewRound)がたまたまその条件になる
  // ものをあらかじめ探して固定したもの（スクリプトで総当たりして確認済み）。
  const DEALER_WOULD_HAVE_MELD_SEED = 1; // 親でメビウス無しだと面子が出来ている
  const NONDEALER_WOULD_HAVE_NO_MELD_SEED = 1; // 親でない側でメビウス無しだと面子が0個
  const DEALER_ALREADY_NO_MELD_SEED = 2; // 親で素のままでも既に面子0個（不発/no-op確認用）
  const NONDEALER_ALREADY_HAS_MELD_SEED = 3; // 親でない側で素のままでも既に面子あり（no-op確認用）

  it("forces zero melds when the owner is this round's dealer", () => {
    const withoutMebius = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(DEALER_WOULD_HAVE_MELD_SEED), ["", "hiiragi", "raiko", "toki"]);
    expect(hasCompleteMeld(withoutMebius.players[0]!.hand)).toBe(true); // 前提: メビウス無しだと面子ができている

    const withMebius = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(DEALER_WOULD_HAVE_MELD_SEED), ["mebius", "hiiragi", "raiko", "toki"]);
    expect(hasCompleteMeld(withMebius.players[0]!.hand)).toBe(false);
    expect(withMebius.players[0]!.hand.concealed.length).toBe(13); // 枚数自体は変わらない

    // 他家の配牌・山の総牌数はメビウス無しの場合と変わらない（入れ替えのみで増減しない）。
    for (const seat of [1, 2, 3] as const) {
      expect(withMebius.players[seat]!.hand.concealed.map((t) => t.code)).toEqual(
        withoutMebius.players[seat]!.hand.concealed.map((t) => t.code),
      );
    }
    expect(withMebius.wall.liveTiles.length).toBe(withoutMebius.wall.liveTiles.length);
  });

  it("forces at least one meld when the owner is not this round's dealer", () => {
    const withoutMebius = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(NONDEALER_WOULD_HAVE_NO_MELD_SEED), ["hiiragi", "", "raiko", "toki"]);
    expect(hasCompleteMeld(withoutMebius.players[1]!.hand)).toBe(false); // 前提: メビウス無しだと面子が0個

    const withMebius = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(NONDEALER_WOULD_HAVE_NO_MELD_SEED), ["hiiragi", "mebius", "raiko", "toki"]);
    expect(hasCompleteMeld(withMebius.players[1]!.hand)).toBe(true);
    expect(withMebius.players[1]!.hand.concealed.length).toBe(13);
    expect(withMebius.wall.liveTiles.length).toBe(withoutMebius.wall.liveTiles.length);
  });

  it("does nothing (no-op) when the dealer's deal already has zero melds", () => {
    const withoutMebius = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(DEALER_ALREADY_NO_MELD_SEED), ["", "hiiragi", "raiko", "toki"]);
    expect(hasCompleteMeld(withoutMebius.players[0]!.hand)).toBe(false);

    const withMebius = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(DEALER_ALREADY_NO_MELD_SEED), ["mebius", "hiiragi", "raiko", "toki"]);
    expect(withMebius.players[0]!.hand.concealed.map((t) => t.code)).toEqual(
      withoutMebius.players[0]!.hand.concealed.map((t) => t.code),
    );
  });

  it("does nothing (no-op) when a non-dealer's deal already has a meld", () => {
    const withoutMebius = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(NONDEALER_ALREADY_HAS_MELD_SEED), ["hiiragi", "", "raiko", "toki"]);
    expect(hasCompleteMeld(withoutMebius.players[1]!.hand)).toBe(true);

    const withMebius = dealNewRound(1, 1, 0, 0, 0, makeSeededRng(NONDEALER_ALREADY_HAS_MELD_SEED), ["hiiragi", "mebius", "raiko", "toki"]);
    expect(withMebius.players[1]!.hand.concealed.map((t) => t.code)).toEqual(
      withoutMebius.players[1]!.hand.concealed.map((t) => t.code),
    );
  });
});

describe("tomohiro's passive onBeforeDraw (手牌が一枚しかない人)", () => {
  function nakedTankiHand(tankiCode: TileCode): Hand {
    const meld = (code: TileCode): Meld => ({ type: "pon", tiles: [tile(code), tile(code), tile(code)] });
    return { concealed: [tile(tankiCode)], melds: [meld("1z"), meld("2z"), meld("3z"), meld("4z")] };
  }
  // 9m単騎待ちの他家(player1)の手。
  const tenpaiWaitingOn9m = ["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4z", "4z", "4z", "9m"] as TileCode[];

  it("swaps an opponent's next draw away from their winning tile while the owner is on a naked tanki wait", () => {
    const round = makeRound({
      wall: makeWall(["9m", "1p", "2p", "3p"]), // 先頭の9mが待ち牌、それ以外は無関係牌
      players: [
        { ...emptyPlayer([]), hand: nakedTankiHand("5z") },
        emptyPlayer(tenpaiWaitingOn9m),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["tomohiro", "hiiragi", "", ""],
      currentTurn: 1,
    });

    const next = applyAction(round, { type: "draw", player: 1 });

    expect(next.lastDrawnTile!.code).toBe("1p"); // 当たり牌(9m)ではなく安全牌にすり替わる
    expect(next.wall.liveTiles.map((t) => t.code)).toEqual(["9m", "2p", "3p"]); // 9mは山の元の位置に戻され、後ろに残る
    expect(next.tomohiroGuardCount).toBe(1); // 発動演出のトリガー用カウンタが増える
  });

  it("does not interfere with the owner's own draw", () => {
    const round = makeRound({
      wall: makeWall(["9m", "1p", "2p", "3p"]),
      players: [
        { ...emptyPlayer([]), hand: nakedTankiHand("5z") },
        emptyPlayer(tenpaiWaitingOn9m),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["tomohiro", "hiiragi", "", ""],
      currentTurn: 0,
    });

    const next = applyAction(round, { type: "draw", player: 0 });
    expect(next.lastDrawnTile!.code).toBe("9m"); // 自分自身のツモには影響しない
    expect(next.tomohiroGuardCount).toBe(0); // 不発なので演出トリガーも増えない
  });

  it("does nothing when the owner is not on a naked tanki wait", () => {
    const round = makeRound({
      wall: makeWall(["9m", "1p", "2p", "3p"]),
      players: [
        // 裸単騎ではない通常の(まだテンパイですらない)手。
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]),
        emptyPlayer(tenpaiWaitingOn9m),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["tomohiro", "hiiragi", "", ""],
      currentTurn: 1,
    });

    const next = applyAction(round, { type: "draw", player: 1 });
    expect(next.lastDrawnTile!.code).toBe("9m"); // 裸単騎でなければ通常通り当たり牌を引いてしまう
    expect(next.tomohiroGuardCount).toBe(0); // 不発なので演出トリガーも増えない
  });

  it("fails silently (opponent draws the winning tile anyway) when no other tile remains in the wall", () => {
    const round = makeRound({
      wall: makeWall(["9m"]), // 山に当たり牌しか残っていない
      players: [
        { ...emptyPlayer([]), hand: nakedTankiHand("5z") },
        emptyPlayer(tenpaiWaitingOn9m),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["tomohiro", "hiiragi", "", ""],
      currentTurn: 1,
    });

    const next = applyAction(round, { type: "draw", player: 1 });
    expect(next.lastDrawnTile!.code).toBe("9m"); // 避けようがないので不発
    expect(next.tomohiroGuardCount).toBe(0); // 不発なので演出トリガーも増えない
  });
});

describe("koki's passive skill (太っ腹)", () => {
  it("onActivate sets futopparaPending and resets the gauge", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), skillGauge: 100 },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });

    const next = applyAction(round, { type: "useSkill", player: 0 });
    expect(next.players[0]!.futopparaPending).toBe(true);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("cannot activate again while already active for the round", () => {
    const base = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"]), skillGauge: 100 },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const pending = { ...base, players: [{ ...base.players[0]!, futopparaPending: true }, base.players[1]!, base.players[2]!, base.players[3]!] as RoundState["players"] };

    expect(canUseSkill(pending, 0)).toBe(false);
  });

  it("discarding a non-dora tile after activation leaves futopparaPending untouched", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["9m", "9m", "9m", "1p", "1p", "1p", "2s", "2s", "2s", "4z", "4z", "4z", "5z"]), futopparaPending: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const doraCode = nextTileForDora(doraIndicators(round.wall)[0]!);
    expect(round.players[0]!.hand.concealed.some((t) => t.code === doraCode)).toBe(false); // 手牌にドラを含めていない前提

    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "9m")!.id;
    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.players[0]!.futopparaPending).toBe(true); // ドラ以外を切っても待機状態が続く
    expect(next.players[0]!.guaranteedUsefulDraw).toBe(false);
  });

  it("discarding the current dora tile keeps futopparaPending active and grants guaranteedUsefulDraw", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["9m", "9m", "1p", "1p", "1p", "2s", "2s", "2s", "4z", "4z", "4z", "5z", "5z"]), futopparaPending: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const doraCode = nextTileForDora(doraIndicators(round.wall)[0]!);
    // 手牌の1枚をドラ表示牌から求まる現在のドラに差し替える。
    const players: RoundState["players"] = [
      { ...round.players[0]!, hand: { ...round.players[0]!.hand, concealed: [...round.players[0]!.hand.concealed.slice(1), { id: "doraTile", code: doraCode }] } },
      round.players[1]!,
      round.players[2]!,
      round.players[3]!,
    ];
    const roundWithDora = { ...round, players };

    const next = applyAction(roundWithDora, { type: "discard", player: 0, tileId: "doraTile", tsumogiri: false });

    expect(next.players[0]!.futopparaPending).toBe(true);
    expect(next.players[0]!.guaranteedUsefulDraw).toBe(true);
  });

  it("discarding a red five grants guaranteedUsefulDraw even when it isn't the current dora indicator's tile", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["9m", "9m", "1p", "1p", "1p", "2s", "2s", "2s", "4z", "4z", "4z", "6z", "6z"]), futopparaPending: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const doraCode = nextTileForDora(doraIndicators(round.wall)[0]!);
    expect(doraCode).not.toBe("5s"); // 表ドラとは無関係の赤5であることを保証する
    const players: RoundState["players"] = [
      { ...round.players[0]!, hand: { ...round.players[0]!.hand, concealed: [...round.players[0]!.hand.concealed.slice(1), { id: "red5s", code: "5s", isRed: true }] } },
      round.players[1]!,
      round.players[2]!,
      round.players[3]!,
    ];
    const roundWithRed = { ...round, players };

    const next = applyAction(roundWithRed, { type: "discard", player: 0, tileId: "red5s", tsumogiri: false });

    expect(next.players[0]!.futopparaPending).toBe(true);
    expect(next.players[0]!.guaranteedUsefulDraw).toBe(true);
  });

  it("onBeforeDraw pulls forward a shanten-advancing tile while not yet tenpai", () => {
    // 3面子(4p5p6p/7s8s9s/1z1z1z)+両面搭子(2m4m)+孤立牌2枚(9m,9z)の1シャンテン。
    const oneShantenHand = ["4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2m", "4m", "9m", "7z"] as TileCode[];
    const round = makeRound({
      wall: makeWall(["6z", "5z", "3m", "1s"]), // 先頭2枚は無関係牌、3枚目の3mが有効牌
      players: [
        { ...emptyPlayer(oneShantenHand), guaranteedUsefulDraw: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "hiiragi", "", ""],
      currentTurn: 0,
    });
    expect(calcShanten(round.players[0]!.hand)).toBe(1);

    const next = applyAction(round, { type: "draw", player: 0 });

    expect(next.lastDrawnTile!.code).toBe("3m");
    expect(next.players[0]!.guaranteedUsefulDraw).toBe(false);
  });

  it("onBeforeDraw pulls forward the exact waiting tile while already tenpai", () => {
    const tenpaiWaitingOn9m = ["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4z", "4z", "4z", "9m"] as TileCode[];
    const round = makeRound({
      wall: makeWall(["1p", "2p", "9m", "3p"]),
      players: [
        { ...emptyPlayer(tenpaiWaitingOn9m), guaranteedUsefulDraw: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "hiiragi", "", ""],
      currentTurn: 0,
    });
    expect(calcShanten(round.players[0]!.hand)).toBe(0);

    const next = applyAction(round, { type: "draw", player: 0 });

    expect(next.lastDrawnTile!.code).toBe("9m");
    expect(next.players[0]!.guaranteedUsefulDraw).toBe(false);
  });

  it("fails silently (consuming the right anyway) when no useful tile remains in the wall", () => {
    const oneShantenHand = ["4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2m", "4m", "9m", "7z"] as TileCode[];
    const round = makeRound({
      wall: makeWall(["6z"]), // 有効牌ではない1枚しか残っていない
      players: [
        { ...emptyPlayer(oneShantenHand), guaranteedUsefulDraw: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "hiiragi", "", ""],
      currentTurn: 0,
    });

    const next = applyAction(round, { type: "draw", player: 0 });

    expect(next.lastDrawnTile!.code).toBe("6z");
    expect(next.players[0]!.guaranteedUsefulDraw).toBe(false); // 不発でも権利は消費される
  });

  it("does not affect another player's draw", () => {
    const tenpaiWaitingOn9m = ["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4z", "4z", "4z", "9m"] as TileCode[];
    const round = makeRound({
      wall: makeWall(["1p", "2p", "9m", "3p"]),
      players: [
        emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "5z", "5z", "5z", "6z"]),
        { ...emptyPlayer(tenpaiWaitingOn9m), guaranteedUsefulDraw: true }, // player1がコウキ、player0がツモる
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["hiiragi", "koki", "", ""],
      currentTurn: 0,
    });

    const next = applyAction(round, { type: "draw", player: 0 });

    expect(next.lastDrawnTile!.code).toBe("1p"); // player1の権利はplayer0のツモに影響しない
    expect(next.wall.liveTiles.map((t) => t.code)).toEqual(["2p", "9m", "3p"]);
    expect(next.players[1]!.guaranteedUsefulDraw).toBe(true); // 消費されずに残る
  });
});

describe("takaharu's passive skill (アトミックベタ降り)", () => {
  const tripletHand = ["5m", "5m", "5m", "1p", "2p", "3p", "7s", "8s", "9s", "3z", "3z", "4z", "7z"] as TileCode[];
  const tenpaiWaitingOn9m = ["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4z", "4z", "4z", "9m"] as TileCode[];

  it("onActivate sets bettaoriActive and resets the gauge", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(tripletHand), skillGauge: 100 },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });

    const next = applyAction(round, { type: "useSkill", player: 0 });
    expect(next.players[0]!.bettaoriActive).toBe(true);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("cannot reactivate while already active", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(tripletHand), skillGauge: 100, bettaoriActive: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });

    expect(canUseSkill(round, 0)).toBe(false);
  });

  it("discarding one tile out of a concealed triplet (3→2) arms the shield", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(tripletHand), bettaoriActive: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "5m")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.players[0]!.bettaoriShield).toBe(true);
  });

  it("discarding an isolated tile (not part of a triplet) does not arm the shield", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(tripletHand), bettaoriActive: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "7z")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.players[0]!.bettaoriShield).toBe(false);
  });

  it("discarding from a triplet without having activated the skill does nothing", () => {
    const round = makeRound({
      players: [
        emptyPlayer(tripletHand), // bettaoriActiveはfalseのまま
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "5m")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.players[0]!.bettaoriShield).toBe(false);
  });

  it("canDeclareRon is blocked for everyone while the discarder's shield is armed, even on their winning tile", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer([]), bettaoriShield: true },
        emptyPlayer(tenpaiWaitingOn9m),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
    });

    expect(canDeclareRon(round, 1, "9m", 0)).toBeNull();

    const withoutShield = { ...round, players: [{ ...round.players[0]!, bettaoriShield: false }, round.players[1]!, round.players[2]!, round.players[3]!] as RoundState["players"] };
    expect(canDeclareRon(withoutShield, 1, "9m", 0)).not.toBeNull(); // 盾が無ければ普通にロンできる状況であることの確認
  });

  it("the shield stays armed through the call window (blocking ron) and is only consumed once it resolves with no ron", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["9m", "1p", "1p", "1p", "2s", "2s", "2s", "4z", "4z", "4z", "6z", "6z", "3z"]), bettaoriShield: true },
        emptyPlayer(tenpaiWaitingOn9m), // 9m単騎待ち＝盾が無ければ9mを切った瞬間ロンされる
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "9m")!.id;

    const afterDiscard = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    // 応答ウィンドウがまだ解決していない間は、盾はまだ消費されず立ったまま
    // （＝canDeclareRonが常にnullを返し、実際にロンを防いでいる最中）。
    expect(afterDiscard.players[0]!.bettaoriShield).toBe(true);
    expect(canDeclareRon(afterDiscard, 1, "9m", 0)).toBeNull();

    // 全員が応答（ロンできないので全員skip）し、ウィンドウがロン無しで
    // 解決して初めて「実際に守った」ことが確定し、盾が消費される。
    const afterP1Skip = applyAction(afterDiscard, { type: "skip", player: 1 });
    const afterP2Skip = applyAction(afterP1Skip, { type: "skip", player: 2 });
    const next = applyAction(afterP2Skip, { type: "skip", player: 3 });

    expect(next.players[0]!.bettaoriShield).toBe(false); // 実際に守ったので消費される
  });

  it("the shield is preserved when the discard was not actually dangerous", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["6z", "1p", "1p", "1p", "2s", "2s", "2s", "4z", "4z", "4z", "6z", "6z", "3z"]), bettaoriShield: true },
        emptyPlayer(tenpaiWaitingOn9m), // 6zは誰の当たり牌でもない
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "6z" && t.id !== "")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.players[0]!.bettaoriShield).toBe(true); // 安全牌だったので温存される
  });

  it("breaking another triplet re-arms an already-consumed shield later in the same round", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(tripletHand), bettaoriActive: true, bettaoriShield: false },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "5m")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.players[0]!.bettaoriShield).toBe(true);
  });

  it("discarding the middle tile of a completed run (順子) also arms the shield", () => {
    // tripletHandには1p2p3pの順子が既に含まれている。
    const round = makeRound({
      players: [
        { ...emptyPlayer(tripletHand), bettaoriActive: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "2p")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.players[0]!.bettaoriShield).toBe(true);
  });

  it("discarding a run tile that still has a spare copy behind it does not arm the shield", () => {
    const spareCopyHand = ["1p", "1p", "2p", "3p", "5m", "6m", "7m", "7s", "8s", "9s", "3z", "3z", "4z"] as TileCode[];
    const round = makeRound({
      players: [
        { ...emptyPlayer(spareCopyHand), bettaoriActive: true },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["takaharu", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "1p")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.players[0]!.bettaoriShield).toBe(false); // もう1枚の1pでまだ順子を組めるので崩したとは言えない
  });
});

describe("nyanjiro's アトミックリーチ", () => {
  // 1z単騎待ちのテンパイ形。ツモった5zを切ってもそのままテンパイが維持される。
  const tenpaiHand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];
  const otherTenpaiHand = ["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4z", "4z", "4z", "9m"] as TileCode[];

  it("has no onActivate: useSkill is never available, regardless of gauge", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(tenpaiHand), skillGauge: 100 },
        emptyPlayer([]),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["nyanjiro", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseSkill(round, 0)).toBe(false);
  });

  it("declaring riichi while the gauge is already full becomes an atomic riichi, resets the gauge, and locks out the other three from riichi for the rest of the round", () => {
    let round = makeRound({
      players: [
        { ...emptyPlayer(tenpaiHand), skillGauge: CHARACTERS.nyanjiro!.gaugeMax },
        emptyPlayer(otherTenpaiHand),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["nyanjiro", "hiiragi", "", ""],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
    });

    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });

    expect(round.players[0]!.atomicRiichi).toBe(true);
    expect(round.players[0]!.skillGauge).toBe(0); // 発動により消費される
    expect(round.riichiLockedBy).toBe(0);

    // 応答ウィンドウを流して手番を戻し、他家がリーチできなくなっていることを確認する。
    for (const p of [1, 2, 3] as PlayerIndex[]) round = applyAction(round, { type: "skip", player: p });
    round = applyAction(round, { type: "draw", player: 1 });
    expect(canRiichi(round, 1)).toBe(false); // テンパイしていても、ロックにより不可
  });

  it("declaring riichi with a gauge below max stays a normal riichi (only the normal gaugePerTurn gain applies) and does not lock out other players", () => {
    let round = makeRound({
      players: [
        emptyPlayer(tenpaiHand), // skillGauge: 0 (デフォルト)
        emptyPlayer(otherTenpaiHand),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["nyanjiro", "hiiragi", "", ""],
      // 後続で player1 も1枚引くため、canRiichi の残り枚数チェック(>=4)を
      // 満たせるよう、上の「アトミック」テストより1枚多く残しておく。
      wall: makeWall(["5z", "9m", "8m", "6m", "9p", "1s"]),
    });

    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });

    expect(round.players[0]!.atomicRiichi).toBe(false);
    expect(round.players[0]!.skillGauge).toBe(CHARACTERS.nyanjiro!.gaugePerTurn); // 通常のリーチ宣言と同じくgaugePerTurnぶんだけ増える
    expect(round.riichiLockedBy).toBeNull();

    // 応答ウィンドウを流して手番を戻し、他家がリーチできることを確認する。
    for (const p of [1, 2, 3] as PlayerIndex[]) round = applyAction(round, { type: "skip", player: p });
    round = applyAction(round, { type: "draw", player: 1 });
    expect(canRiichi(round, 1)).toBe(true); // 他家のリーチは封じられない
  });

  it("gaining exactly to max via this riichi's own gaugePerTurn does not retroactively trigger it (fullness is checked before the discard)", () => {
    const startingGauge = CHARACTERS.nyanjiro!.gaugeMax - CHARACTERS.nyanjiro!.gaugePerTurn;
    let round = makeRound({
      players: [
        { ...emptyPlayer(tenpaiHand), skillGauge: startingGauge },
        emptyPlayer(otherTenpaiHand),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["nyanjiro", "hiiragi", "", ""],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
    });

    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });

    expect(round.players[0]!.skillGauge).toBe(CHARACTERS.nyanjiro!.gaugeMax); // ゲージ自体は満タンになる
    expect(round.players[0]!.atomicRiichi).toBe(false); // が、このリーチ自体はアトミックにはならない
    expect(round.riichiLockedBy).toBeNull();
  });
});

describe("jin's 大明立直 (onRiichi auto-trigger)", () => {
  const tenpaiHand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];

  it("has no onActivate: useSkill is never available, regardless of gauge", () => {
    const round = makeRound({
      players: [{ ...emptyPlayer(tenpaiHand), skillGauge: 100 }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["jin", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseSkill(round, 0)).toBe(false);
  });

  it("declaring riichi while the gauge is already full becomes an open riichi and resets the gauge", () => {
    let round = makeRound({
      players: [{ ...emptyPlayer(tenpaiHand), skillGauge: CHARACTERS.jin!.gaugeMax }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["jin", "hiiragi", "", ""],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
    });

    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });

    expect(round.players[0]!.openRiichi).toBe(true);
    expect(round.players[0]!.skillGauge).toBe(0); // 発動により消費される
  });

  it("declaring riichi with a gauge below max stays a normal (non-open) riichi", () => {
    let round = makeRound({
      players: [emptyPlayer(tenpaiHand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])], // skillGauge: 0 (デフォルト)
      characterIds: ["jin", "hiiragi", "", ""],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
    });

    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });

    expect(round.players[0]!.openRiichi).toBe(false);
    expect(round.players[0]!.skillGauge).toBe(CHARACTERS.jin!.gaugePerTurn); // 通常のリーチ宣言と同じくgaugePerTurnぶんだけ増える
  });
});

describe("ren's 捲る運命 (onRiichi auto-trigger)", () => {
  const tenpaiHand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];

  it("has no onActivate: useSkill is never available, regardless of gauge", () => {
    const round = makeRound({
      players: [{ ...emptyPlayer(tenpaiHand), skillGauge: 100 }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["ren", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseSkill(round, 0)).toBe(false);
  });

  it("declaring riichi while the gauge is already full arms guaranteedUraDora and resets the gauge", () => {
    let round = makeRound({
      players: [{ ...emptyPlayer(tenpaiHand), skillGauge: CHARACTERS.ren!.gaugeMax }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["ren", "hiiragi", "", ""],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
    });

    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });

    expect(round.players[0]!.guaranteedUraDora).toBe(true);
    expect(round.players[0]!.skillGauge).toBe(0); // 発動により消費される
  });

  it("declaring riichi with a gauge below max leaves guaranteedUraDora unarmed", () => {
    let round = makeRound({
      players: [emptyPlayer(tenpaiHand), emptyPlayer([]), emptyPlayer([]), emptyPlayer([])], // skillGauge: 0 (デフォルト)
      characterIds: ["ren", "hiiragi", "", ""],
      wall: makeWall(["5z", "9m", "8m", "6m", "9p"]),
    });

    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "riichi", player: 0, tileId: round.lastDrawnTile!.id });

    expect(round.players[0]!.guaranteedUraDora).toBe(false);
    expect(round.players[0]!.skillGauge).toBe(CHARACTERS.ren!.gaugePerTurn); // 通常のリーチ宣言と同じくgaugePerTurnぶんだけ増える
  });
});

describe("zeno's 時間停止 (time stop)", () => {
  const tenpaiHand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "2z"] as TileCode[];
  const otherTenpaiHand = ["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4z", "4z", "4z", "9m"] as TileCode[];

  it("onActivate sets timeStopTurnsRemaining to 2 and resets the gauge", () => {
    const round = makeRound({
      players: [{ ...emptyPlayer(tenpaiHand), skillGauge: 100 }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["zeno", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const next = applyAction(round, { type: "useSkill", player: 0 });
    expect(next.players[0]!.timeStopTurnsRemaining).toBe(2);
    expect(next.players[0]!.skillGauge).toBe(0);
  });

  it("cannot reactivate while already active", () => {
    const round = makeRound({
      players: [{ ...emptyPlayer(tenpaiHand), skillGauge: 100, timeStopTurnsRemaining: 1 }, emptyPlayer([]), emptyPlayer([]), emptyPlayer([])],
      characterIds: ["zeno", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    expect(canUseSkill(round, 0)).toBe(false);
  });

  it("the first protected discard skips the call window entirely and loops the turn back to the same player, decrementing the counter", () => {
    let round = makeRound({
      players: [
        { ...emptyPlayer(tenpaiHand), timeStopTurnsRemaining: 2 },
        emptyPlayer(otherTenpaiHand),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["zeno", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-draw",
      wall: makeWall(["9m", "8m", "7m", "6m"]),
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "discard", player: 0, tileId: round.lastDrawnTile!.id, tsumogiri: true });

    expect(round.pendingCallWindow).toBeNull(); // 応答ウィンドウが開かない
    expect(round.phase).toBe("awaiting-draw");
    expect(round.currentTurn).toBe(0); // 手番はplayer0のまま(2巡目)
    expect(round.players[0]!.timeStopTurnsRemaining).toBe(1);
  });

  it("no one can call or ron on a protected discard, even one that would otherwise deal into a winning hand", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "1z", "9m"]), timeStopTurnsRemaining: 2 },
        emptyPlayer(otherTenpaiHand), // 9m単騎待ち
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["zeno", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed.find((t) => t.code === "9m")!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.pendingCallWindow).toBeNull();
    expect(() => applyAction(next, { type: "ron", player: 1 })).toThrow(); // 応答ウィンドウが無いのでロン自体を宣言できない
  });

  it("the second (bonus) protected discard also skips the call window but advances to the next seat and clears the counter", () => {
    const round = makeRound({
      players: [
        { ...emptyPlayer(tenpaiHand), timeStopTurnsRemaining: 1 },
        emptyPlayer(otherTenpaiHand),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["zeno", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
    });
    const discardId = round.players[0]!.hand.concealed[0]!.id;

    const next = applyAction(round, { type: "discard", player: 0, tileId: discardId, tsumogiri: false });

    expect(next.pendingCallWindow).toBeNull();
    expect(next.phase).toBe("awaiting-draw");
    expect(next.currentTurn).toBe(1); // 通常通り次家へ
    expect(next.players[0]!.timeStopTurnsRemaining).toBe(0);
  });

  it("a kakan declared during a protected turn skips the chankan window and goes straight to the rinshan draw", () => {
    const ponMeld: Meld = { type: "pon", tiles: [tile("5z"), tile("5z"), tile("5z")] };
    const kakanHand: Hand = {
      concealed: ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "5z"].map(tile),
      melds: [ponMeld],
    };
    const round = makeRound({
      players: [
        { ...emptyPlayer([]), hand: kakanHand, timeStopTurnsRemaining: 2 },
        emptyPlayer(otherTenpaiHand),
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["zeno", "hiiragi", "", ""],
      currentTurn: 0,
      phase: "awaiting-discard",
      wall: makeWall(["6m", "7m", "8m"]),
    });
    const kakanTileId = round.players[0]!.hand.concealed.find((t) => t.code === "5z")!.id;

    const next = applyAction(round, { type: "kakan", player: 0, tileId: kakanTileId });

    expect(next.pendingCallWindow).toBeNull(); // 槍槓の応答ウィンドウ自体が開かない
    expect(next.phase).toBe("awaiting-discard");
    expect(next.isRinshanTurn).toBe(true);
    expect(next.currentTurn).toBe(0);
    expect(next.players[0]!.hand.melds[0]!.type).toBe("kakan");
  });
});

describe("kagami", () => {
  it("cannot activate when no one has activated a skill yet this round", () => {
    const round = makeRound({
      players: [emptyPlayer([]), { ...emptyPlayer([]), skillGauge: 100 }, emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "kagami", "", ""],
      currentTurn: 1,
      phase: "awaiting-discard",
      lastActivatedSkill: null,
    });
    expect(canUseSkill(round, 1)).toBe(false);
  });

  it("cannot activate when the last activation was by itself", () => {
    const round = makeRound({
      players: [emptyPlayer([]), { ...emptyPlayer([]), skillGauge: 100 }, emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "kagami", "", ""],
      currentTurn: 1,
      phase: "awaiting-discard",
      lastActivatedSkill: { owner: 1, characterId: "kagami" },
    });
    expect(canUseSkill(round, 1)).toBe(false);
  });

  it("reproduces the tablemate's last activated skill (hiiragi's dora reveal) and records the original characterId, not its own", () => {
    const round = makeRound({
      players: [emptyPlayer([]), { ...emptyPlayer([]), skillGauge: 100 }, emptyPlayer([]), emptyPlayer([])],
      characterIds: ["hiiragi", "kagami", "", ""],
      currentTurn: 1,
      phase: "awaiting-discard",
      lastActivatedSkill: { owner: 0, characterId: "hiiragi" },
    });
    expect(round.wall.revealedDoraCount).toBe(1);
    expect(canUseSkill(round, 1)).toBe(true);

    const next = applyAction(round, { type: "useSkill", player: 1 });
    expect(next.wall.revealedDoraCount).toBe(2); // ヒイラギの「開花」がそのまま再現される
    expect(next.players[1]!.skillGauge).toBe(0);
    // 「カガミ自身」ではなく、コピー元(hiiragi)のIDが引き続き記録される
    // (連鎖して次のカガミがまた本来の効果をコピーできるようにするため)。
    expect(next.lastActivatedSkill).toEqual({ owner: 1, characterId: "hiiragi" });
  });

  it("respects the copied skill's own canActivate condition, evaluated against the copier (koki's futoppara cannot be copied while already pending)", () => {
    const round = makeRound({
      players: [
        emptyPlayer([]),
        { ...emptyPlayer([]), skillGauge: 100, futopparaPending: true },
        emptyPlayer([]),
        emptyPlayer([]),
      ],
      characterIds: ["koki", "kagami", "", ""],
      currentTurn: 1,
      phase: "awaiting-discard",
      lastActivatedSkill: { owner: 0, characterId: "koki" },
    });
    expect(canUseSkill(round, 1)).toBe(false);
  });
});
