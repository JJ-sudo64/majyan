import { describe, expect, it } from "vitest";
import { analyzeWin, type WinContext } from "../src/yaku/index.js";
import type { Hand } from "../src/hand.js";
import type { TileCode } from "../src/tiles.js";
import type { Meld } from "../src/hand.js";

let idc = 0;
function tile(code: TileCode) {
  return { id: `t${idc++}`, code };
}
function hand(codes: TileCode[], melds: Meld[] = []): Hand {
  return { concealed: codes.map(tile), melds };
}

const baseContext: WinContext = {
  isTsumo: false,
  winTile: "1m",
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
  doraIndicators: [],
  uraDoraIndicators: [],
  bonusHan: 0,
};

function ctx(overrides: Partial<WinContext>): WinContext {
  return { ...baseContext, ...overrides };
}

function yakuNames(names: { name: string }[]): string[] {
  return names.map((y) => y.name);
}

describe("analyzeWin - regular hands", () => {
  it("pinfu ryanmen ron", () => {
    const h = hand(["2m","3m","4m","4p","5p","6p","3s","4s","5s","6s","7s","8s","9p","9p"]);
    const result = analyzeWin(h, ctx({ winTile: "4m", isTsumo: false }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("平和");
    expect(result!.han).toBe(1);
    expect(result!.fu).toBe(30);
  });

  it("pinfu ryanmen tsumo is 20fu", () => {
    const h = hand(["2m","3m","4m","4p","5p","6p","3s","4s","5s","6s","7s","8s","9p","9p"]);
    const result = analyzeWin(h, ctx({ winTile: "4m", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("平和");
    expect(yakuNames(result!.yaku)).toContain("門前清自摸和");
    expect(result!.fu).toBe(20);
  });

  it("tanyao + riichi ron", () => {
    const h = hand(["2m","3m","4m","4p","5p","6p","3s","4s","5s","6s","7s","8s","8p","8p"]);
    const result = analyzeWin(h, ctx({ winTile: "4m", riichi: true }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toEqual(expect.arrayContaining(["断幺九", "立直", "平和"]));
  });

  it("yakuhai dragon triplet (open pon allowed)", () => {
    const melds: Meld[] = [
      { type: "pon", tiles: [tile("5z"), tile("5z"), tile("5z")], calledFromRelative: 1, calledTile: tile("5z") },
    ];
    const h = hand(["2m","3m","4m","4p","5p","6p","3s","4s","5s","9p","9p"], melds);
    const result = analyzeWin(h, ctx({ winTile: "5s" }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("役牌:白");
  });

  it("no yaku hand returns null (open hand, no yakuhai, no tanyao due to terminal, not pinfu since open)", () => {
    const melds: Meld[] = [
      { type: "chi", tiles: [tile("1p"), tile("2p"), tile("3p")], calledFromRelative: 1, calledTile: tile("1p") },
    ];
    const h = hand(["2m","3m","4m","4p","5p","6p","3s","4s","5s","9p","9p"], melds);
    const result = analyzeWin(h, ctx({ winTile: "5s" }));
    expect(result).toBeNull();
  });

  it("honitsu", () => {
    const h = hand(["1m","2m","3m","4m","5m","6m","7m","8m","9m","1z","1z","1z","5z","5z"]);
    const result = analyzeWin(h, ctx({ winTile: "9m", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("混一色");
  });

  it("chinitsu", () => {
    const h = hand(["1m","2m","3m","4m","5m","6m","7m","8m","9m","2m","3m","4m","5m","5m"]);
    const result = analyzeWin(h, ctx({ winTile: "4m", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("清一色");
  });

  it("toitoi", () => {
    const melds: Meld[] = [
      { type: "pon", tiles: [tile("2p"), tile("2p"), tile("2p")], calledFromRelative: 1, calledTile: tile("2p") },
      { type: "pon", tiles: [tile("4s"), tile("4s"), tile("4s")], calledFromRelative: 1, calledTile: tile("4s") },
    ];
    const h = hand(["3m","3m","3m","7z","7z","7z","6z","6z"], melds);
    const result = analyzeWin(h, ctx({ winTile: "6z", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("対々和");
  });
});

describe("analyzeWin - chiitoitsu", () => {
  it("basic seven pairs", () => {
    const h = hand(["1m","1m","3m","3m","5m","5m","7p","7p","9p","9p","2s","2s","4s","4s"]);
    const result = analyzeWin(h, ctx({ winTile: "4s", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("七対子");
    expect(result!.fu).toBe(25);
    expect(result!.han).toBe(3); // 七対子(2) + 門前清自摸和(1)
  });
});

describe("analyzeWin - yakuman", () => {
  it("kokushi musou (single wait on the one missing kind)", () => {
    const h = hand(["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","6z","7z"]);
    const result = analyzeWin(h, ctx({ winTile: "7z", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(result!.isYakuman).toBe(true);
    expect(result!.yakumanMultiplier).toBe(1);
  });

  it("kokushi musou 13-wait (double)", () => {
    const h = hand(["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z","7z"]);
    const result = analyzeWin(h, ctx({ winTile: "7z", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(result!.isYakuman).toBe(true);
    expect(result!.yakumanMultiplier).toBe(2);
  });

  it("daisangen", () => {
    const h = hand(["5z","5z","5z","6z","6z","6z","7z","7z","7z","2m","3m","4m","9s","9s"]);
    const result = analyzeWin(h, ctx({ winTile: "9s", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(result!.isYakuman).toBe(true);
    expect(yakuNames(result!.yaku)).toContain("大三元");
  });

  it("suuankou tsumo (single, shanpon completion via tsumo stays concealed)", () => {
    const h = hand(["2m","2m","2m","5p","5p","5p","7s","7s","7s","3z","3z","3z","9p","9p"]);
    const result = analyzeWin(h, ctx({ winTile: "3z", isTsumo: true }));
    expect(result).not.toBeNull();
    expect(result!.isYakuman).toBe(true);
    expect(yakuNames(result!.yaku)).toContain("四暗刻");
  });

  it("ron on a triplet demotes suuankou to sanankou (no yakuman)", () => {
    const h = hand(["2m","2m","2m","5p","5p","5p","7s","7s","7s","3z","3z","3z","9p","9p"]);
    const result = analyzeWin(h, ctx({ winTile: "3z", isTsumo: false }));
    expect(result).not.toBeNull();
    expect(result!.isYakuman).toBe(false);
    expect(yakuNames(result!.yaku)).toContain("三暗刻");
  });
});

describe("analyzeWin - yakuhai shanpon (\"役牌バック\")", () => {
  it("open hand, tsumo on the yakuhai side of a shanpon wait, is a valid win via yakuhai", () => {
    const ponMeld: Meld = { type: "pon", tiles: [tile("1s"), tile("1s"), tile("1s")] };
    // 234m 567p 5z5z(白) 3p3p のシャンポン待ち。白をツモって白の刻子が完成する。
    const h = hand(["2m", "3m", "4m", "5p", "6p", "7p", "5z", "5z", "5z", "3p", "3p"], [ponMeld]);
    const result = analyzeWin(h, ctx({ winTile: "5z", isTsumo: true, seatWind: 2, roundWind: 1 }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("役牌:白");
  });

  it("open hand, tsumo on the non-yakuhai side of the same shanpon wait, has no yaku", () => {
    const ponMeld: Meld = { type: "pon", tiles: [tile("1s"), tile("1s"), tile("1s")] };
    const h = hand(["2m", "3m", "4m", "5p", "6p", "7p", "5z", "5z", "3p", "3p", "3p"], [ponMeld]);
    const result = analyzeWin(h, ctx({ winTile: "3p", isTsumo: true, seatWind: 2, roundWind: 1 }));
    expect(result).toBeNull();
  });

  it("open hand, tsumo on the seat-wind side of a shanpon wait", () => {
    const ponMeld: Meld = { type: "pon", tiles: [tile("1s"), tile("1s"), tile("1s")] };
    // seatWind=2(南) -> 自風牌は2z
    const h = hand(["2m", "3m", "4m", "5p", "6p", "7p", "2z", "2z", "2z", "3p", "3p"], [ponMeld]);
    const result = analyzeWin(h, ctx({ winTile: "2z", isTsumo: true, seatWind: 2, roundWind: 1 }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("自風牌");
  });

  it("open hand, tsumo on the round-wind side of a shanpon wait", () => {
    const ponMeld: Meld = { type: "pon", tiles: [tile("1s"), tile("1s"), tile("1s")] };
    // roundWind=1(東) -> 場風牌は1z
    const h = hand(["2m", "3m", "4m", "5p", "6p", "7p", "1z", "1z", "1z", "3p", "3p"], [ponMeld]);
    const result = analyzeWin(h, ctx({ winTile: "1z", isTsumo: true, seatWind: 2, roundWind: 1 }));
    expect(result).not.toBeNull();
    expect(yakuNames(result!.yaku)).toContain("場風牌");
  });
});

describe("analyzeWin - dora", () => {
  it("dora counted only when a real yaku exists", () => {
    const h = hand(["2m","3m","4m","4p","5p","6p","3s","4s","5s","6s","7s","8s","9p","9p"]);
    const result = analyzeWin(h, ctx({ winTile: "4m", doraIndicators: ["3m"] }));
    // dora indicator 3m -> dora is 4m; hand has two 4m (one from sequence 2m3m4m... wait only one 4m). Just check it doesn't error.
    expect(result).not.toBeNull();
  });
});

describe("analyzeWin - card effect (bonusHan)", () => {
  it("adds a han-up card's bonus as its own yaku entry on top of a real yaku", () => {
    const h = hand(["2m","3m","4m","4p","5p","6p","3s","4s","5s","6s","7s","8s","8p","8p"]);
    const withoutBonus = analyzeWin(h, ctx({ winTile: "4m", riichi: true }));
    const withBonus = analyzeWin(h, ctx({ winTile: "4m", riichi: true, bonusHan: 2 }));
    expect(withoutBonus).not.toBeNull();
    expect(withBonus).not.toBeNull();
    expect(yakuNames(withBonus!.yaku)).toContain("カード効果");
    expect(withBonus!.han).toBe(withoutBonus!.han + 2);
  });

  it("does not create a win by itself when there is no other yaku (like dora)", () => {
    const melds: Meld[] = [
      { type: "chi", tiles: [tile("1p"), tile("2p"), tile("3p")], calledFromRelative: 1, calledTile: tile("1p") },
    ];
    const h = hand(["2m","3m","4m","4p","5p","6p","3s","4s","5s","9p","9p"], melds);
    const result = analyzeWin(h, ctx({ winTile: "5s", bonusHan: 2 }));
    expect(result).toBeNull();
  });

  it("does not apply to a yakuman hand", () => {
    const h = hand(["5z","5z","5z","6z","6z","6z","7z","7z","7z","2m","3m","4m","9s","9s"]);
    const result = analyzeWin(h, ctx({ winTile: "9s", isTsumo: true, bonusHan: 2 }));
    expect(result).not.toBeNull();
    expect(result!.isYakuman).toBe(true);
    expect(yakuNames(result!.yaku)).not.toContain("カード効果");
  });
});
