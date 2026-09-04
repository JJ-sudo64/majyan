import { describe, expect, it } from "vitest";
import { analyzeWin, type WinContext } from "../src/yaku/index.js";
import type { Hand, Meld } from "../src/hand.js";
import type { TileCode } from "../src/tiles.js";
import type { Wind } from "../src/tiles.js";

let idc = 0;
function tile(code: TileCode) {
  return { id: `s${idc++}`, code };
}
function hand(codes: TileCode[], melds: Meld[] = []): Hand {
  return { concealed: codes.map(tile), melds };
}

const baseContext: WinContext = {
  isTsumo: true,
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
};

function makeMeld(type: Meld["type"], code: TileCode): Meld {
  if (type === "chi") {
    const n = Number(code[0]);
    const suit = code[1];
    return { type, tiles: [tile(`${n}${suit}` as TileCode), tile(`${n + 1}${suit}` as TileCode), tile(`${n + 2}${suit}` as TileCode)] };
  }
  const count = type === "minkan" || type === "ankan" || type === "kakan" ? 4 : 3;
  return { type, tiles: Array.from({ length: count }, () => tile(code)) };
}

// 回帰テスト: allHandTiles()がankan/minkanを4枚のまま数えていたため、
// これらのカンを含む手は合計15枚になり、analyzeWinの「ちょうど14枚か」
// チェックに引っかかって和了自体が常に不成立（役の有無を問わず）になって
// いた（kakanだけ3枚扱いに正規化されていて無事だった）。
// 「役牌バックでツモっても和了ボタンが出ない」という報告から発覚。
describe("kan melds must not break win detection (regression)", () => {
  it("a concealed hand containing an ankan is still recognized as a valid tsumo win (tanyao + menzen tsumo)", () => {
    const ankan: Meld = { type: "ankan", tiles: (["3s", "3s", "3s", "3s"] as TileCode[]).map(tile) };
    const h = hand(["2m", "3m", "4m", "4p", "5p", "6p", "5s", "6s", "7s", "8p", "8p"], [ankan]);
    const result = analyzeWin(h, { ...baseContext, isTsumo: true, winTile: "7s" });
    expect(result).not.toBeNull();
    expect(result!.yaku.map((y) => y.name)).toContain("断幺九");
  });

  it("an open hand containing a minkan is still recognized as a valid tsumo win (tanyao)", () => {
    const minkan: Meld = { type: "minkan", tiles: (["3s", "3s", "3s", "3s"] as TileCode[]).map(tile) };
    const h = hand(["2m", "3m", "4m", "4p", "5p", "6p", "5s", "6s", "7s", "8p", "8p"], [minkan]);
    const result = analyzeWin(h, { ...baseContext, isTsumo: true, winTile: "7s" });
    expect(result).not.toBeNull();
    expect(result!.yaku.map((y) => y.name)).toContain("断幺九");
  });
});

describe("sweep: yakuhai shanpon tsumo across call types and yakuhai kinds", () => {
  const yakuhaiCodes: { code: TileCode; seatWind: Wind; roundWind: Wind; label: string }[] = [
    { code: "5z", seatWind: 2, roundWind: 1, label: "haku" },
    { code: "6z", seatWind: 2, roundWind: 1, label: "hatsu" },
    { code: "7z", seatWind: 2, roundWind: 1, label: "chun" },
    { code: "2z", seatWind: 2, roundWind: 1, label: "seat wind (south, seatWind=2)" },
    { code: "1z", seatWind: 2, roundWind: 1, label: "round wind (east, roundWind=1)" },
  ];
  const callTypes: Meld["type"][] = ["pon", "chi", "minkan", "ankan", "kakan"];
  const otherPairCode: TileCode = "3p";

  for (const yh of yakuhaiCodes) {
    for (const callType of callTypes) {
      it(`yakuhai=${yh.label} call=${callType}: tsumo on yakuhai side of shanpon is a valid win`, () => {
        const meld = makeMeld(callType, "9s"); // 鳴きは無関係な牌(9s系)にしておく
        // 234m 456p (2 complete sets) + yakuhai shanpon + otherPair, 1メルド分を差し引く
        const concealed: TileCode[] = ["2m", "3m", "4m", "4p", "5p", "6p", yh.code, yh.code, yh.code, otherPairCode, otherPairCode];
        const h = hand(concealed, [meld]);
        const result = analyzeWin(h, { ...baseContext, winTile: yh.code, seatWind: yh.seatWind, roundWind: yh.roundWind });
        expect(result, `expected a win for yakuhai=${yh.label} call=${callType}`).not.toBeNull();
      });
    }
  }
});
