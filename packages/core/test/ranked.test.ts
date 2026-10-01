import { describe, expect, it } from "vitest";
import {
  applyRankPoints,
  INITIAL_RANK,
  isValidRank,
  rankAfterMatch,
  rankLabel,
  rankMaxPoints,
  rankOrdinal,
  rankPointDelta,
  RANK_TIERS,
  type RankState,
} from "../src/ranked.js";

const r = (tier: number, level: number, points: number): RankState => ({ tier, level, points });

describe("rank labels", () => {
  it("names every rank from 下雀1 to 雀神", () => {
    expect(RANK_TIERS.map((t) => t.name)).toEqual(["下雀", "中雀", "上雀", "雀王", "雀帝", "雀神"]);
    expect(rankLabel(INITIAL_RANK)).toBe("下雀1");
    expect(rankLabel(r(3, 2, 2000))).toBe("雀王3");
    expect(rankLabel(r(5, 0, 123))).toBe("雀神");
    expect(rankMaxPoints(r(5, 0, 123))).toBeNull();
    expect(rankOrdinal(r(0, 0, 0))).toBe(0);
    expect(rankOrdinal(r(4, 2, 0))).toBe(14);
    expect(rankOrdinal(r(5, 0, 0))).toBe(15);
  });
});

describe("rankPointDelta", () => {
  it("adds placement points and the final score difference", () => {
    // 上雀1・半荘: 1位+45、持ち点42300 → +17
    expect(rankPointDelta(r(2, 0, 700), "hanchan", 1, 42300)).toBe(45 + 17);
    // 4位の減点は段が上がるほど重い
    expect(rankPointDelta(r(2, 0, 700), "hanchan", 4, 25000)).toBe(-40);
    expect(rankPointDelta(r(2, 2, 1100), "hanchan", 4, 25000)).toBe(-60);
    // 東風戦は順位の増減が半分
    expect(rankPointDelta(r(2, 0, 700), "tonpuusen", 1, 25000)).toBe(23);
    // 箱下(マイナス)の持ち点もそのまま反映
    expect(rankPointDelta(r(1, 0, 400), "hanchan", 4, -5400)).toBe(-20 - 30);
  });
});

describe("applyRankPoints", () => {
  it("promotes to the next level and starts from its start points", () => {
    expect(applyRankPoints(r(0, 0, 10), 15)).toEqual(r(0, 1, 0));
    expect(applyRankPoints(r(0, 2, 190), 30)).toEqual(r(1, 0, 300));
    expect(applyRankPoints(r(1, 2, 990), 20)).toEqual(r(2, 0, 600));
    expect(applyRankPoints(r(4, 2, 8990), 100)).toEqual(r(5, 0, 0));
  });

  it("never demotes 下雀 and 中雀, but floors their points at 0", () => {
    expect(applyRankPoints(r(0, 1, 5), -50)).toEqual(r(0, 1, 0));
    expect(applyRankPoints(r(1, 0, 10), -50)).toEqual(r(1, 0, 0));
  });

  it("demotes from 上雀 upward, including 雀神 back to 雀帝3", () => {
    expect(applyRankPoints(r(2, 1, 20), -50)).toEqual(r(2, 0, 600));
    expect(applyRankPoints(r(2, 0, 20), -50)).toEqual(r(1, 2, 500));
    expect(applyRankPoints(r(5, 0, 30), -150)).toEqual(r(4, 2, 4500));
  });

  it("lets 雀神 accumulate points without a cap", () => {
    expect(applyRankPoints(r(5, 0, 100000), 500)).toEqual(r(5, 0, 100500));
  });

  it("always produces a valid rank from any valid rank", () => {
    for (let tier = 0; tier < RANK_TIERS.length; tier++) {
      const levels = Math.max(1, RANK_TIERS[tier]!.levelMax.length);
      for (let level = 0; level < levels; level++) {
        const max = RANK_TIERS[tier]!.levelMax[level] ?? 10000;
        for (const points of [0, Math.floor(max / 2), max - 1]) {
          for (const delta of [-400, -60, -1, 0, 1, 60, 400]) {
            const next = applyRankPoints(r(tier, level, points), delta);
            expect(isValidRank(next), JSON.stringify({ tier, level, points, delta, next })).toBe(true);
          }
        }
      }
    }
  });
});

describe("rankAfterMatch", () => {
  it("reports the change for the result screen", () => {
    const change = rankAfterMatch(r(0, 0, 10), "hanchan", 1, 30000);
    expect(change).toEqual({ before: r(0, 0, 10), after: r(0, 1, 0), delta: 35, place: 1 });
  });
});
