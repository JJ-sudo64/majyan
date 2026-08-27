import { describe, expect, it } from "vitest";
import { calcShanten, calcStandardShanten } from "../src/shanten.js";
import { countsFromCodes } from "../src/decompose.js";
import type { Hand } from "../src/hand.js";
import type { TileCode } from "../src/tiles.js";

let idCounter = 0;
function h(codes: TileCode[]): Hand {
  return {
    concealed: codes.map((code) => ({ id: `x${idCounter++}`, code })),
    melds: [],
  };
}

describe("calcShanten", () => {
  it("winning hand is -1", () => {
    // 123456789m 発發發 東東 (14枚, 和了形)
    const hand = h(["1m","2m","3m","4m","5m","6m","7m","8m","9m","6z","6z","6z","1z","1z"]);
    expect(calcShanten(hand)).toBe(-1);
  });

  it("tenpai standard hand is 0", () => {
    // 123456789m 發發 東東 (13枚, 東待ちのシャンポン or 發待ち)
    const hand = h(["1m","2m","3m","4m","5m","6m","7m","8m","9m","6z","6z","1z","1z"]);
    expect(calcShanten(hand)).toBe(0);
  });

  it("chiitoitsu tenpai is 0", () => {
    const hand = h(["1m","1m","2m","2m","3m","3m","4m","4m","5m","5m","6m","6m","7m"]);
    expect(calcShanten(hand)).toBe(0);
  });

  it("chiitoitsu winning hand is -1", () => {
    const hand = h(["1m","1m","2m","2m","3m","3m","4m","4m","5m","5m","6m","6m","7m","7m"]);
    expect(calcShanten(hand)).toBe(-1);
  });

  it("kokushi tenpai (13 wait) is 0", () => {
    const hand = h(["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z"]);
    expect(calcShanten(hand)).toBe(0);
  });

  it("kokushi winning hand is -1", () => {
    const hand = h(["1m","9m","1p","9p","1s","9s","1z","1z","2z","3z","4z","5z","6z","7z"]);
    expect(calcShanten(hand)).toBe(-1);
  });

  it("standard-form-only worst case (all isolated, no taatsu) is 8", () => {
    // 標準形単体では8シャンテンだが、この牌姿は七対子/国士としても有効なので
    // 実際の総合シャンテンは6になる（下のテストで確認）。ここは標準形の関数を直接検証。
    const codes: TileCode[] = ["1m","4m","7m","1p","4p","7p","1s","4s","7s","1z","3z","5z","7z"];
    expect(calcStandardShanten(countsFromCodes(codes), 0)).toBe(8);
  });

  it("all-distinct 13 tiles: combined shanten rescued to 6 by chiitoitsu/kokushi potential", () => {
    const hand = h(["1m","4m","7m","1p","4p","7p","1s","4s","7s","1z","3z","5z","7z"]);
    expect(calcShanten(hand)).toBe(6);
  });

  it("six ryanmen taatsu with no pair is 4-shanten", () => {
    const hand = h(["1m","2m","4m","5m","7m","8m","1p","2p","4p","5p","7p","8p","9s"]);
    expect(calcShanten(hand)).toBe(4);
  });
});
