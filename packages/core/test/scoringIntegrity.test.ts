/**
 * 点数計算の確認: 点数表（天鳳・雀魂と同じ、切り上げ満貫なし）と、実際に見つかった
 * 数え間違い（カンのドラ・赤ドラ、読み方の選び方、役満の複合など）。
 */
import { describe, expect, it } from "vitest";
import type { TileCode } from "../src/tiles.js";
import type { Hand, Meld } from "../src/hand.js";
import type { PlayerRoundState, RoundState } from "../src/gameState.js";
import { analyzeWin, type WinAnalysis, type WinContext } from "../src/yaku/index.js";
import { applyHonba, scoreWin } from "../src/scoring.js";
import { applyAction, canDeclareTsumo, canRiichi, computeRoundScoreOutcome } from "../src/gameEngine.js";
import { planNextRound } from "../src/matchFormat.js";
import type { WallState } from "../src/wall.js";

let idc = 0;
const tile = (code: TileCode, isRed = false) => ({ id: `s${idc++}`, code, ...(isRed ? { isRed: true } : {}) });
const handOf = (codes: TileCode[], melds: Meld[] = []): Hand => ({ concealed: codes.map((c) => tile(c)), melds });

const base: WinContext = {
  isTsumo: false,
  winTile: "1m",
  seatWind: 2,
  roundWind: 1,
  isDealer: false,
  riichi: false,
  doubleRiichi: false,
  ippatsu: false,
  openRiichi: false,
  haitei: false,
  houtei: false,
  rinshan: false,
  chankan: false,
  firstTurnWin: false,
  doraIndicators: [],
  uraDoraIndicators: [],
  bonusHan: 0,
};
const ctx = (o: Partial<WinContext>): WinContext => ({ ...base, ...o });
const names = (a: WinAnalysis | null) => a!.yaku.map((y) => y.name);
const hanOf = (a: WinAnalysis | null, name: string) => a!.yaku.find((y) => y.name === name)?.han ?? 0;
const plain = (han: number, fu: number): WinAnalysis => ({ yaku: [], han, fu, isYakuman: false, yakumanMultiplier: 0 });

describe("点数表", () => {
  const ron = (han: number, fu: number, dealer = false) => scoreWin(plain(han, fu), dealer, false).payments.fromDiscarder;
  const tsumo = (han: number, fu: number, dealer = false) => {
    const p = scoreWin(plain(han, fu), dealer, true).payments;
    return dealer ? [p.fromEachNonDealer] : [p.fromEachNonDealer, p.fromDealer];
  };

  it("matches the standard table below mangan", () => {
    expect(ron(1, 30)).toBe(1000);
    expect(ron(1, 30, true)).toBe(1500);
    expect(tsumo(1, 30)).toEqual([300, 500]);
    expect(tsumo(1, 30, true)).toEqual([500]);
    expect(tsumo(2, 20)).toEqual([400, 700]);
    expect(tsumo(2, 20, true)).toEqual([700]);
    expect(ron(2, 25)).toBe(1600);
    expect(ron(2, 25, true)).toBe(2400);
    expect(ron(3, 30)).toBe(3900);
    expect(ron(3, 30, true)).toBe(5800);
    expect(tsumo(3, 30)).toEqual([1000, 2000]);
    expect(ron(4, 30)).toBe(7700);
    expect(ron(4, 30, true)).toBe(11600);
    expect(tsumo(4, 30)).toEqual([2000, 3900]);
    expect(tsumo(4, 30, true)).toEqual([3900]);
    expect(ron(3, 60)).toBe(7700);
    expect(ron(2, 40)).toBe(2600);
    expect(ron(1, 110)).toBe(3600);
  });

  it("caps at mangan and above", () => {
    expect(ron(3, 70)).toBe(8000);
    expect(ron(4, 40)).toBe(8000);
    expect(ron(5, 30)).toBe(8000);
    expect(ron(5, 30, true)).toBe(12000);
    expect(tsumo(5, 30)).toEqual([2000, 4000]);
    expect(ron(6, 30)).toBe(12000);
    expect(ron(7, 30, true)).toBe(18000);
    expect(ron(8, 30)).toBe(16000);
    expect(ron(10, 30, true)).toBe(24000);
    expect(ron(11, 30)).toBe(24000);
    expect(ron(12, 30, true)).toBe(36000);
    expect(ron(13, 30)).toBe(32000);
    expect(scoreWin(plain(13, 30), false, false).limitName).toBe("役満");
  });

  it("scores multiple yakuman and names them in Japanese", () => {
    const double: WinAnalysis = { yaku: [], han: 26, fu: 0, isYakuman: true, yakumanMultiplier: 2 };
    const s = scoreWin(double, false, false);
    expect(s.payments.fromDiscarder).toBe(64000);
    expect(s.limitName).toBe("ダブル役満");
    expect(scoreWin(double, true, true).payments.fromEachNonDealer).toBe(32000);
  });

  it("adds honba: 300 per stick on ron, 100 from each on tsumo", () => {
    expect(applyHonba(scoreWin(plain(1, 30), false, false).payments, 2, false).fromDiscarder).toBe(1600);
    const t = applyHonba(scoreWin(plain(1, 30), false, true).payments, 2, true);
    expect([t.fromEachNonDealer, t.fromDealer, t.total]).toEqual([500, 700, 1700]);
  });
});

describe("符", () => {
  it("closed ron, tanki wait, concealed terminal triplet: 20+10+2+8 = 40", () => {
    const h = handOf(["9m", "9m", "9m", "2p", "3p", "4p", "5s", "6s", "7s", "3m", "4m", "5m", "7p", "7p"]);
    const a = analyzeWin(h, ctx({ winTile: "7p", riichi: true }));
    expect(a!.fu).toBe(40);
  });

  it("an open hand with no fu is rounded up to 30", () => {
    const chi = { type: "chi", tiles: [tile("2p"), tile("3p"), tile("4p")], calledFromRelative: 3, calledTile: tile("2p") } as Meld;
    const h = handOf(["3m", "4m", "5m", "5s", "6s", "7s", "4s", "5s", "6s", "8p", "8p"], [chi]);
    const a = analyzeWin(h, ctx({ winTile: "3m" }));
    expect(names(a)).toContain("断幺九");
    expect(a!.fu).toBe(30);
  });

  it("a concealed kan of a non-value honor with a closed tsumo: 20+2+32 = 54 → 60", () => {
    const kan = { type: "ankan", tiles: [tile("3z"), tile("3z"), tile("3z"), tile("3z")] } as Meld;
    const h = handOf(["2m", "3m", "4m", "5p", "6p", "7p", "3s", "4s", "5s", "9p", "9p"], [kan]);
    const a = analyzeWin(h, ctx({ winTile: "4m", isTsumo: true }));
    expect(a!.fu).toBe(60);
  });
});

describe("ドラ", () => {
  it("counts all four tiles of a kan, including a red five in any position", () => {
    // 4m表示で5mがドラ。5mを暗槓（赤は4枚目）。
    const kan = { type: "ankan", tiles: [tile("5m"), tile("5m"), tile("5m"), tile("5m", true)] } as Meld;
    const h = handOf(["2p", "3p", "4p", "6s", "7s", "8s", "2s", "3s", "4s", "7p", "7p"], [kan]);
    const a = analyzeWin(h, ctx({ winTile: "4s", isTsumo: true, riichi: true, doraIndicators: ["4m"] }));
    expect(hanOf(a, "ドラ")).toBe(4);
    expect(hanOf(a, "赤ドラ")).toBe(1);
  });

  it("counts the fourth tile of an added kan too", () => {
    const kakan = {
      type: "kakan",
      tiles: [tile("9p"), tile("9p"), tile("9p"), tile("9p")],
      calledFromRelative: 2,
      calledTile: tile("9p"),
    } as Meld;
    const h = handOf(["2m", "3m", "4m", "6s", "7s", "8s", "5z", "5z", "5z", "2s", "2s"], [kakan]);
    const a = analyzeWin(h, ctx({ winTile: "4m", isTsumo: true, doraIndicators: ["8p"] }));
    expect(hanOf(a, "ドラ")).toBe(4);
  });
});

describe("役の判定", () => {
  it("combines 国士無双 with 天和", () => {
    const h = handOf(["1m", "9m", "1p", "9p", "1s", "9s", "1z", "2z", "3z", "4z", "5z", "6z", "7z", "7z"]);
    const a = analyzeWin(h, ctx({ winTile: "7z", isTsumo: true, isDealer: true, firstTurnWin: true }));
    // 和了牌を除いた13枚が13種そろっているので十三面待ち(ダブル)、天和と合わせてトリプル役満。
    expect(names(a)).toEqual(["国士無双十三面", "天和"]);
    expect(a!.yakumanMultiplier).toBe(3);
    expect(scoreWin(a!, true, true).limitName).toBe("トリプル役満");
  });

  it("gives 槍槓 to 七対子", () => {
    const h = handOf(["1m", "1m", "3p", "3p", "5s", "5s", "7m", "7m", "2z", "2z", "8p", "8p", "4s", "4s"]);
    expect(names(analyzeWin(h, ctx({ winTile: "4s", chankan: true })))).toContain("槍槓");
  });

  it("reads four identical sequences as 二盃口", () => {
    const h = handOf(["1m", "1m", "1m", "1m", "2m", "2m", "2m", "2m", "3m", "3m", "3m", "3m", "5p", "5p"]);
    expect(names(analyzeWin(h, ctx({ winTile: "3m" })))).toContain("二盃口");
  });

  it("picks the reading worth the most points", () => {
    // 111m222m333m(+123m)の読みより、二盃口の読みの方が高い。
    const h = handOf(["1m", "1m", "1m", "1m", "2m", "2m", "2m", "2m", "3m", "3m", "3m", "3m", "5p", "5p"]);
    const a = analyzeWin(h, ctx({ winTile: "3m" }));
    expect(names(a)).toContain("二盃口");
    expect(names(a)).not.toContain("三暗刻");
  });
});

// ---- 局の進行が絡むもの ----

function player(codes: TileCode[], overrides: Partial<PlayerRoundState> = {}): PlayerRoundState {
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
    ...overrides,
  } as PlayerRoundState;
}
function wall(liveCodes: TileCode[]): WallState {
  const dead = Array.from({ length: 14 }, (_, i) => (["1z", "2z", "3z", "4z"] as TileCode[])[i % 4]!);
  return { liveTiles: liveCodes.map((c) => tile(c)), deadWall: dead.map((c) => tile(c)), revealedDoraCount: 1, rinshanDrawn: 0 };
}
const FILLER: TileCode[] = ["1m", "9m", "1p", "9p", "1s", "9s", "1z", "2z", "3z", "4z", "5z", "6z", "7z"];
function makeRound(overrides: Partial<RoundState> & { players: RoundState["players"] }): RoundState {
  return {
    format: "hanchan", roundWind: 1, roundNumber: 1, honba: 0, kyotaku: 0, dealerSeat: 0, wall: wall([]),
    currentTurn: 0, phase: "awaiting-draw", lastDiscard: null, lastDrawnTile: null, isRinshanTurn: false,
    pendingCallWindow: null, kanCount: 0, result: null, characterIds: ["", "", "", ""], anyCallOrRiichiMade: false,
    handsRevealedTo: null, wallReadRevealedTo: null, dealerRenchanByWin: false, riichiLockedBy: null, tomohiroGuardCount: 0,
    cardIds: [null, null, null, null], cardUsesRemaining: [0, 0, 0, 0], cardNegateArmed: [false, false, false, false],
    cardBonusHan: [0, 0, 0, 0], cardExtraUraDora: [false, false, false, false], cardScoreDoubled: [false, false, false, false],
    pendingScoreAdjustment: null, lastActivatedSkill: null,
    ...overrides,
  };
}

describe("局の終わり際", () => {
  it("a rinshan draw after the live wall ran out is 嶺上開花, not also 海底摸月", () => {
    let round = makeRound({
      wall: wall(["1m"]),
      players: [
        player(["1m", "1m", "1m", "2s", "3s", "4s", "4p", "5p", "6p", "7s", "8s", "9s", "1z"]),
        player(FILLER), player(FILLER), player(FILLER),
      ],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "ankan", player: 0, tileCode: "1m" });
    expect(round.lastDrawnTile?.code).toBe("1z");
    const a = canDeclareTsumo(round, 0);
    expect(names(a)).toContain("嶺上開花");
    expect(names(a)).not.toContain("海底摸月");
  });

  it("a hand whose only wait is a fifth copy of a tile it already holds four of is not tenpai", () => {
    // 1111m + 完成面子3つ: 待ちは1mだけ（5枚目は無い）。
    const fifth: TileCode[] = ["1m", "1m", "1m", "1m", "2p", "3p", "4p", "5s", "6s", "7s", "9s", "9s", "9s"];
    let round = makeRound({ players: [player(fifth), player(FILLER), player(FILLER), player(FILLER)] });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.result?.type).toBe("exhaustive-draw");
    expect(round.result?.tenpaiPlayers).not.toContain(0);

    // 同じ形で、ツモった牌を切ればこの形になる時もリーチはできない。
    let r2 = makeRound({ wall: wall(["8m"]), players: [player(fifth), player(FILLER), player(FILLER), player(FILLER)] });
    r2 = applyAction(r2, { type: "draw", player: 0 });
    expect(canRiichi(r2, 0)).toBe(false);
  });
});

describe("リーチ棒と本場", () => {
  // 親(0)は4mを切ってリーチ（5s/8s待ち）。下家(1)はタンヤオの4m/7m待ち。
  function riichiDeclaredOn4m(points?: [number, number, number, number]) {
    const tanyaoWait: TileCode[] = ["5m", "6m", "2p", "3p", "4p", "4s", "5s", "6s", "6p", "7p", "8p", "3s", "3s"];
    let round = makeRound({
      wall: wall(["9m", "1z", "1z", "1z", "1z", "1z"]),
      ...(points ? { points } : {}),
      players: [
        player(["4m", "2p", "3p", "4p", "5p", "6p", "7p", "2s", "3s", "4s", "6s", "7s", "9m"]),
        player(tanyaoWait),
        player(FILLER),
        player(FILLER),
      ],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    return round;
  }

  it("gives the riichi stick back when the declaration tile is ronned", () => {
    let round = riichiDeclaredOn4m();
    const fourM = round.players[0].hand.concealed.find((t) => t.code === "4m")!;
    round = applyAction(round, { type: "riichi", player: 0, tileId: fourM.id });
    expect(round.kyotaku).toBe(1);
    round = applyAction(round, { type: "ron", player: 1 });
    for (const p of [2, 3] as const) round = applyAction(round, { type: "skip", player: p });
    expect(round.result?.type).toBe("ron");
    const { scoreDeltas } = computeRoundScoreOutcome(round);
    // 平和・断幺九の2翻30符で2000点。宣言時に引いた1000点は戻り、和了者は供託を受け取らない
    // （以前は和了者が3000点、放銃者が-2000点だった）。
    expect(scoreDeltas[1]).toBe(2000);
    expect(scoreDeltas[0]).toBe(-2000 + 1000);
  });

  it("keeps the stick on the table once the declaration tile has passed", () => {
    let round = riichiDeclaredOn4m();
    const fourM = round.players[0].hand.concealed.find((t) => t.code === "4m")!;
    round = applyAction(round, { type: "riichi", player: 0, tileId: fourM.id });
    for (const p of [1, 2, 3] as const) round = applyAction(round, { type: "skip", player: p });
    expect(round.pendingRiichiStick ?? null).toBeNull();
  });

  it("does not allow riichi with fewer than 1000 points, unless the stick is free", () => {
    expect(canRiichi(riichiDeclaredOn4m([900, 25000, 25000, 25000]), 0)).toBe(false);
    expect(canRiichi(riichiDeclaredOn4m([1000, 25000, 25000, 25000]), 0)).toBe(true);
    const free = { ...riichiDeclaredOn4m([900, 25000, 25000, 25000]) };
    free.cardIds = ["no-cost-riichi", null, null, null];
    free.cardUsesRemaining = [1, 0, 0, 0];
    expect(canRiichi(free, 0)).toBe(true);
  });

  it("adds a honba after a draw even when the dealer was noten and passes the deal", () => {
    const round = makeRound({
      honba: 1,
      players: [player(FILLER), player(FILLER), player(FILLER), player(FILLER)],
      result: { type: "exhaustive-draw", winners: [], tenpaiPlayers: [2], dealerContinues: false },
    });
    const plan = planNextRound(round, "hanchan", false, true);
    expect(plan.dealerSeat).toBe(1);
    expect(plan.honba).toBe(2);
    // 子の和了なら本場は0に戻る。
    const won = { ...round, result: { type: "ron" as const, winners: [2 as const], loser: 1 as const, dealerContinues: false } };
    expect(planNextRound(won, "hanchan", false, false).honba).toBe(0);
  });
});
