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
    // 上雀1・半荘: 1位+54、持ち点42300 → +17
    expect(rankPointDelta(r(2, 0, 700), "hanchan", 1, 42300)).toBe(54 + 17);
    // 東風戦は東風戦の値(1位+27)
    expect(rankPointDelta(r(2, 0, 700), "tonpuusen", 1, 25000)).toBe(27);
    // 4位の減点は段が上がるほど重い
    expect(rankPointDelta(r(2, 0, 700), "tonpuusen", 4, 25000)).toBe(-33);
    expect(rankPointDelta(r(2, 2, 1100), "tonpuusen", 4, 25000)).toBe(-53);
    expect(rankPointDelta(r(2, 0, 700), "hanchan", 4, 25000)).toBe(-65);
    expect(rankPointDelta(r(2, 2, 1100), "hanchan", 4, 25000)).toBe(-105);
    // 箱下(マイナス)の持ち点もそのまま反映（中雀1の半荘4位 -15）
    expect(rankPointDelta(r(1, 0, 400), "hanchan", 4, -5400)).toBe(-15 - 30);
  });

  it("is top-heavy: 1st is the big reward, 2nd is a small plus, 3rd and 4th lose (from 中雀 up)", () => {
    for (const format of ["tonpuusen", "hanchan"] as const) {
      for (let tier = 1; tier < RANK_TIERS.length; tier++) {
        const rank = r(tier, 0, RANK_TIERS[tier]!.levelStart[0]!);
        const [p1, p2, p3, p4] = ([1, 2, 3, 4] as const).map((place) => rankPointDelta(rank, format, place, 25000));
        expect(p1).toBeGreaterThan(0);
        expect(p2).toBeGreaterThan(0);
        expect(p2!).toBeLessThanOrEqual(p1! * 0.15);
        expect(p3).toBeLessThan(0);
        expect(p4).toBeLessThan(p3!);
        expect(p1).toBeGreaterThan(Math.abs(p4!) * 0.7); // 1位の得は4位の損に近い大きさ
      }
      // どの段でも順位が下がるほどポイントが減る（4位が3位より軽いような逆転が無い）
      RANK_TIERS.forEach((tier, t) => {
        for (let level = 0; level < Math.max(1, tier.levelMax.length); level++) {
          const rank = r(t, level, tier.levelStart[level]!);
          const deltas = ([1, 2, 3, 4] as const).map((place) => rankPointDelta(rank, format, place, 25000));
          expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);
        }
      });
    }
  });

  it("keeps the pace: an average player drifts about as fast as before (東風戦, uniform placements)", () => {
    // 平均的な人（各順位25%）の1試合あたりの期待増減。配点を変えてもペースが変わらないための目印（持ち点補正は除く）。
    const drift = (tier: number, level: number) => {
      const rank = r(tier, level, RANK_TIERS[tier]!.levelStart[level]!);
      return ([1, 2, 3, 4] as const).reduce((sum, place) => sum + rankPointDelta(rank, "tonpuusen", place, 25000), 0) / 4;
    };
    expect(drift(1, 0)).toBeCloseTo(0.3, 0); // 中雀1
    expect(drift(2, 0)).toBeCloseTo(-3.3, 0); // 上雀1
    expect(drift(3, 0)).toBeCloseTo(-6.3, 0); // 雀王1
    expect(drift(4, 0)).toBeCloseTo(-7.5, 0); // 雀帝1
  });
});

describe("applyRankPoints", () => {
  it("promotes to the next level and starts from its start points", () => {
    expect(applyRankPoints(r(0, 0, 10), 15)).toEqual(r(0, 1, 0));
    expect(applyRankPoints(r(0, 2, 190), 30)).toEqual(r(1, 0, 300));
    expect(applyRankPoints(r(1, 2, 990), 20)).toEqual(r(2, 0, 600));
    expect(applyRankPoints(r(4, 2, 8990), 100)).toEqual(r(5, 0, 0));
  });

  it("never demotes 下雀 and 中雀1, but floors their points at 0", () => {
    expect(applyRankPoints(r(0, 1, 5), -50)).toEqual(r(0, 1, 0));
    expect(applyRankPoints(r(1, 0, 10), -50)).toEqual(r(1, 0, 0));
  });

  it("demotes 中雀2 and 中雀3 like the original", () => {
    expect(applyRankPoints(r(1, 1, 10), -50)).toEqual(r(1, 0, 300));
    expect(applyRankPoints(r(1, 2, 10), -50)).toEqual(r(1, 1, 400));
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
    expect(change).toEqual({ before: r(0, 0, 10), after: r(0, 1, 0), delta: 25, place: 1 });
  });
});
