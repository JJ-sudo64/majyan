import { describe, expect, it } from "vitest";
import { M_LEAGUE_RULE, matchPoints } from "../src/matchPoints.js";

describe("matchPoints (Mリーグ式)", () => {
  it("全員25000点なら、起家に近い順に順位点がつき、合計は0になる", () => {
    const p = matchPoints([25000, 25000, 25000, 25000], 0);
    expect(p).toEqual([50 - 5, 10 - 5, -10 - 5, -30 - 5]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("持ち点の差と順位点を足す。ゼロサムを保つ", () => {
    const scores: [number, number, number, number] = [42300, 31100, 18900, 7700];
    const p = matchPoints(scores, 0);
    expect(p).toEqual([12.3 + 50, 1.1 + 10, -11.1 - 10, -22.3 - 30]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 5);
  });

  it("トップと4位の差は、素点が同じでも80点ぶん開く", () => {
    const p = matchPoints([30000, 30000, 30000, 30000], 2);
    // 起家2 → 席2が1位、3が2位、0が3位、1が4位
    expect(p[2]! - p[1]!).toBe(M_LEAGUE_RULE.placement[0] - M_LEAGUE_RULE.placement[3]);
  });
});
