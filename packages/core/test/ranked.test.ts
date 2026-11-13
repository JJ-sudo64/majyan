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
  it("names every rank from 下雀1 to 雀廃", () => {
    expect(RANK_TIERS.map((t) => t.name)).toEqual(["下雀", "中雀", "上雀", "雀王", "雀帝", "雀廃"]);
    expect(rankLabel(INITIAL_RANK)).toBe("下雀1");
    expect(rankLabel(r(3, 2, 2000))).toBe("雀王3");
    expect(rankLabel(r(5, 0, 123))).toBe("雀廃");
    expect(rankMaxPoints(r(5, 0, 123))).toBeNull();
    expect(rankOrdinal(r(0, 0, 0))).toBe(0);
    expect(rankOrdinal(r(4, 2, 0))).toBe(14);
    expect(rankOrdinal(r(5, 0, 0))).toBe(15);
  });
});

describe("rankPointDelta", () => {
  it("下雀 keeps the old table: placement points plus (score - 25000) / 1000", () => {
    expect(rankPointDelta(r(0, 0, 10), "hanchan", 1, 30000)).toBe(20 + 5);
    expect(rankPointDelta(r(0, 0, 10), "tonpuusen", 2, 25000)).toBe(5);
    expect(rankPointDelta(r(0, 0, 10), "tonpuusen", 4, 18000)).toBe(-7);
  });

  it("中雀 and above use the M-League formula: multiplier x Mpt, minus an extra only for 4th", () => {
    // 上雀1・半荘(倍率0.98): 1位・42300点 → Mpt = 12.3 + 50 = 62.3 → 61
    expect(rankPointDelta(r(2, 0, 700), "hanchan", 1, 42300)).toBe(61);
    // 東風戦(倍率0.56): 1位・25000点 → Mpt 45 → 25
    expect(rankPointDelta(r(2, 0, 700), "tonpuusen", 1, 25000)).toBe(25);
    // 4位 = round(0.56 x -35) - 追加減点(段ごと 8/11/13)。上の段ほど重い
    expect(rankPointDelta(r(2, 0, 700), "tonpuusen", 4, 25000)).toBe(-28);
    expect(rankPointDelta(r(2, 2, 1100), "tonpuusen", 4, 25000)).toBe(-33);
    expect(rankPointDelta(r(2, 0, 700), "hanchan", 4, 25000)).toBe(-50);
    expect(rankPointDelta(r(2, 2, 1100), "hanchan", 4, 25000)).toBe(-60);
    // 箱下(マイナス)の持ち点もそのまま反映（中雀1の半荘4位・-5400点: round(0.7 x -65.4) - 4）
    expect(rankPointDelta(r(1, 0, 400), "hanchan", 4, -5400)).toBe(-50);
  });

  it("the Mpt part matches the result screen's M-League points (matchPoints.ts)", () => {
    // 倍率1に近い雀廃(東風1.35)で、持ち点が1000点違うごとに約1.35ポイント動く
    const d = (score: number) => rankPointDelta(r(5, 0, 0), "tonpuusen", 1, score);
    expect(d(35000) - d(25000)).toBe(13); // 61 → 74（1.35 x 10 = 13.5 の四捨五入込み）
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

  it("4th is lighter than the old table, yet an average player still drifts down from 上雀 (the wall stays)", () => {
    // 平均的な人（各順位25%・持ち点25000）の1試合あたりの期待増減。
    const drift = (tier: number, level: number) => {
      const rank = r(tier, level, RANK_TIERS[tier]!.levelStart[level]!);
      return ([1, 2, 3, 4] as const).reduce((sum, place) => sum + rankPointDelta(rank, "tonpuusen", place, 25000), 0) / 4;
    };
    expect(drift(2, 0)).toBeCloseTo(-2, 0); // 上雀1（旧 -3.3）
    expect(drift(3, 0)).toBeCloseTo(-4, 0); // 雀王1（旧 -6.3）
    expect(drift(4, 0)).toBeCloseTo(-5, 0); // 雀帝1（旧 -7.5）
    // 雀帝2・東風戦の4位（旧 -98 → 約 -67）
    expect(rankPointDelta(r(4, 1, 3000), "tonpuusen", 4, 25000)).toBe(-70);
  });
});

describe("applyRankPoints", () => {
  it("promotes to the next level and starts from its start points", () => {
    expect(applyRankPoints(r(0, 0, 10), 15)).toEqual(r(0, 1, 10));
    expect(applyRankPoints(r(0, 2, 190), 30)).toEqual(r(1, 0, 300));
    expect(applyRankPoints(r(1, 2, 990), 20)).toEqual(r(2, 0, 600));
    expect(applyRankPoints(r(4, 2, 8990), 100)).toEqual(r(5, 0, 0));
  });

  it("never demotes 下雀1, but floors its points at 0; 下雀2 and 中雀1 do demote", () => {
    expect(applyRankPoints(r(0, 0, 5), -50)).toEqual(r(0, 0, 0));
    expect(applyRankPoints(r(0, 1, 5), -50)).toEqual(r(0, 0, 0));
    expect(applyRankPoints(r(1, 0, 10), -50)).toEqual(r(0, 2, 40));
  });

  it("demotes 中雀2 and 中雀3 like the original", () => {
    expect(applyRankPoints(r(1, 1, 10), -50)).toEqual(r(1, 0, 300));
    expect(applyRankPoints(r(1, 2, 10), -50)).toEqual(r(1, 1, 400));
  });

  it("demotes from 上雀 upward, including 雀廃 back to 雀帝3", () => {
    expect(applyRankPoints(r(2, 1, 20), -50)).toEqual(r(2, 0, 600));
    expect(applyRankPoints(r(2, 0, 20), -50)).toEqual(r(1, 2, 500));
    expect(applyRankPoints(r(5, 0, 30), -150)).toEqual(r(4, 2, 4500));
  });

  it("lets 雀廃 accumulate points without a cap", () => {
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
    expect(change).toEqual({ before: r(0, 0, 10), after: r(0, 1, 10), delta: 25, place: 1 });
  });
});
