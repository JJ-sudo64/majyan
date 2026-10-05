/**
 * 「本来は和了できない・役が付かないはずの和了」が起きないことの確認。
 * 見逃しフリテン、リーチ後の暗槓、必殺技で引き直した後の嶺上開花、
 * 打牌せずに手番を渡した後の天和/地和、鳴き面子を和了牌の面子と取り違える
 * 三暗刻など、実際に見つかった抜け道ごとに1つずつ確かめる。
 */
import { describe, expect, it } from "vitest";
import type { TileCode } from "../src/tiles.js";
import type { Hand, Meld } from "../src/hand.js";
import type { PlayerRoundState, RoundState } from "../src/gameState.js";
import type { PlayerIndex } from "../src/actions.js";
import { analyzeWin, type WinContext } from "../src/yaku/index.js";
import { ankanOptions, applyAction, canDeclareRon, canDeclareTsumo } from "../src/gameEngine.js";
import type { WallState } from "../src/wall.js";

let idc = 0;
const tile = (code: TileCode) => ({ id: `w${idc++}`, code });
const handOf = (codes: TileCode[], melds: Meld[] = []): Hand => ({ concealed: codes.map(tile), melds });

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
  };
}

function wall(liveCodes: TileCode[]): WallState {
  const dead = Array.from({ length: 14 }, (_, i) => (["1z", "2z", "3z", "4z"] as TileCode[])[i % 4]!);
  return { liveTiles: liveCodes.map(tile), deadWall: dead.map(tile), revealedDoraCount: 1, rinshanDrawn: 0 };
}

function makeRound(overrides: Partial<RoundState> & { players: RoundState["players"] }): RoundState {
  return {
    format: "hanchan",
    roundWind: 1,
    roundNumber: 1,
    honba: 0,
    kyotaku: 0,
    dealerSeat: 0,
    wall: wall(["9s", "9s", "9s", "9s"]),
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

/** 手番の人がツモって、指定した牌（無ければツモ牌）を切る。 */
function drawAndDiscard(round: RoundState, seat: PlayerIndex, code?: TileCode): RoundState {
  round = applyAction(round, { type: "draw", player: seat });
  const t = code ? round.players[seat].hand.concealed.find((x) => x.code === code)! : round.lastDrawnTile!;
  return applyAction(round, { type: "discard", player: seat, tileId: t.id, tsumogiri: t.id === round.lastDrawnTile?.id });
}

/** 応答待ちの全員が見送る。 */
function allSkip(round: RoundState): RoundState {
  for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
    if (round.phase !== "awaiting-calls") break;
    const w = round.pendingCallWindow!;
    if (w.awaitingPlayers.includes(seat) && !w.respondedBy.includes(seat)) round = applyAction(round, { type: "skip", player: seat });
  }
  return round;
}

const ronOn = (round: RoundState, seat: PlayerIndex) => {
  const w = round.pendingCallWindow!;
  return canDeclareRon(round, seat, w.discardTile.code, w.discarderIndex, w.isChankan);
};

// 対面(2)はタンヤオの4m/7m待ち。他の人は無関係な手。
const TANYAO_WAIT: TileCode[] = ["5m", "6m", "2p", "3p", "4p", "4s", "5s", "6s", "6p", "7p", "8p", "3s", "3s"];
const FILLER: TileCode[] = ["1m", "9m", "1p", "9p", "1s", "9s", "1z", "2z", "3z", "4z", "5z", "6z", "7z"];

describe("furiten after passing on a winning tile", () => {
  function passedOnce(riichi: boolean): RoundState {
    let round = makeRound({
      // 親(0)・下家(1)・対面(2)・上家(3)のツモの順
      wall: wall(["1z", "4m", "9m", "7m", "9s", "9s"]),
      players: [
        player(["4m", ...FILLER.slice(1)]),
        player(FILLER),
        player(TANYAO_WAIT, riichi ? { riichi: true } : {}),
        player(FILLER),
      ],
    });
    round = drawAndDiscard(round, 0, "4m");
    expect(ronOn(round, 2)).not.toBeNull(); // ここでは和了できるが、見送る
    return allSkip(round);
  }

  it("cannot ron on the same go-around after passing (同巡内フリテン), and can again after drawing", () => {
    let round = passedOnce(false);
    round = drawAndDiscard(round, 1); // 下家が4mをツモ切り
    expect(round.pendingCallWindow?.discardTile.code).toBe("4m");
    expect(ronOn(round, 2)).toBeNull();
    expect(() => applyAction(round, { type: "ron", player: 2 })).toThrow();
    round = allSkip(round);
    round = drawAndDiscard(round, 2, "9m"); // 自分のツモで解ける
    round = allSkip(round);
    round = drawAndDiscard(round, 3); // 7m
    expect(round.pendingCallWindow?.discardTile.code).toBe("7m");
    expect(ronOn(round, 2)).not.toBeNull();
  });

  it("cannot ron for the rest of the hand after passing while in riichi", () => {
    let round = passedOnce(true);
    round = drawAndDiscard(round, 1);
    round = allSkip(round);
    round = drawAndDiscard(round, 2); // リーチ中なのでツモ切り
    round = allSkip(round);
    round = drawAndDiscard(round, 3); // 7m
    expect(round.pendingCallWindow?.discardTile.code).toBe("7m");
    expect(ronOn(round, 2)).toBeNull();
  });
});

describe("kan during riichi", () => {
  it("only allows a concealed kan of the drawn tile that keeps the same waits", () => {
    // 1m1m1m 2m3m + 9p9p: 1m/4m/9p待ち。1mで暗槓すると9p待ちが消えるので不可。
    let round = makeRound({
      wall: wall(["1m"]),
      players: [
        player(["1m", "1m", "1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "9p", "9p"], { riichi: true }),
        player(FILLER),
        player(FILLER),
        player(FILLER),
      ],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(ankanOptions(round, 0)).toEqual([]);
    expect(() => applyAction(round, { type: "ankan", player: 0, tileCode: "1m" })).toThrow();

    // 1m1m1m + 9p単騎（他は完成面子）: 1mを暗槓しても9p単騎のままなので可。
    let ok = makeRound({
      wall: wall(["1m"]),
      players: [
        player(["1m", "1m", "1m", "2s", "3s", "4s", "4p", "5p", "6p", "7s", "8s", "9s", "9p"], { riichi: true }),
        player(FILLER),
        player(FILLER),
        player(FILLER),
      ],
    });
    ok = applyAction(ok, { type: "draw", player: 0 });
    expect(ankanOptions(ok, 0)).toEqual(["1m"]);
    ok = applyAction(ok, { type: "ankan", player: 0, tileCode: "1m" });
    expect(ok.players[0].hand.melds.at(-1)?.type).toBe("ankan");
  });

  it("does not allow a concealed kan of a tile other than the drawn one during riichi", () => {
    let round = makeRound({
      wall: wall(["9p"]),
      players: [
        player(["1m", "1m", "1m", "1m", "2s", "3s", "4s", "4p", "5p", "6p", "7s", "8s", "9s"], { riichi: true }),
        player(FILLER),
        player(FILLER),
        player(FILLER),
      ],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    expect(ankanOptions(round, 0)).toEqual([]);
  });
});

describe("skills that replace the drawn tile", () => {
  it("a tile redrawn from the live wall after a kan is not a rinshan draw", () => {
    let round = makeRound({
      characterIds: ["nagi", "", "", ""],
      wall: wall(["1m", "9s", "9s", "9s", "9s"]),
      players: [
        player(["1m", "1m", "1m", "2s", "3s", "4s", "4p", "5p", "6p", "7s", "8s", "9s", "9p"], { skillGauge: 100 }),
        player(FILLER),
        player(FILLER),
        player(FILLER),
      ],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "ankan", player: 0, tileCode: "1m" });
    expect(round.isRinshanTurn).toBe(true);
    round = applyAction(round, { type: "useSkill", player: 0 });
    expect(round.isRinshanTurn).toBe(false);
  });

  it("passing the turn without discarding on the first go-around rules out 天和/地和 and double riichi", () => {
    // 親(0)はセナ。1巡目に「様子見」で打牌せずに手番を渡し、2巡目のツモで和了形になる。
    let round = makeRound({
      characterIds: ["sena", "", "", ""],
      wall: wall(["1z", "9m", "9m", "9m", "9p", "9s", "9s", "9s", "9s"]),
      players: [
        player(["1m", "1m", "1m", "2s", "3s", "4s", "4p", "5p", "6p", "7s", "8s", "9s", "9p"], { skillGauge: 100 }),
        player(FILLER),
        player(FILLER),
        player(FILLER),
      ],
    });
    round = applyAction(round, { type: "draw", player: 0 });
    round = applyAction(round, { type: "useSkill", player: 0 });
    expect(round.currentTurn).toBe(1);
    for (const seat of [1, 2, 3] as PlayerIndex[]) round = allSkip(drawAndDiscard(round, seat));
    round = applyAction(round, { type: "draw", player: 0 });
    expect(round.lastDrawnTile?.code).toBe("9p");
    const tsumo = canDeclareTsumo(round, 0);
    expect(tsumo).not.toBeNull();
    expect(tsumo!.yaku.map((y) => y.name)).not.toContain("天和");
  });
});

describe("which block the winning tile completed", () => {
  const base: WinContext = {
    isTsumo: false,
    winTile: "5m",
    seatWind: 2,
    roundWind: 1,
    isDealer: false,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    firstTurnWin: false,
    doraIndicators: [],
    uraDoraIndicators: [],
    bonusHan: 0,
  };

  it("never treats a called meld as the block the winning tile completed", () => {
    // 4m5m6mをチー済み。5m/西のシャンポン待ちに5mでロン: 5mの刻子はロンで完成した明刻なので
    // 暗刻は2つ（三暗刻ではない）。他に役が無いので和了できない。
    const chi = { type: "chi", tiles: [tile("4m"), tile("5m"), tile("6m")], calledFromRelative: 3, calledTile: tile("4m") } as Meld;
    const h = handOf(["5m", "5m", "5m", "7p", "7p", "7p", "9s", "9s", "9s", "3z", "3z"], [chi]);
    expect(analyzeWin(h, base)).toBeNull();
  });

  it("still counts 三暗刻 when the winning tile can be read as completing a sequence instead", () => {
    // 1m1m1m 2m3m 待ち1m/4m。1mのロンは「1m2m3mの順子を完成させた」と読めるので1mの暗刻は残る。
    const h = handOf(["1m", "1m", "1m", "1m", "2m", "3m", "7p", "7p", "7p", "9s", "9s", "9s", "5p", "5p"]);
    const r = analyzeWin(h, { ...base, winTile: "1m" });
    expect(r?.yaku.map((y) => y.name)).toContain("三暗刻");
  });
});
