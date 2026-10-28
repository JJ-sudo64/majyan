/**
 * 対局の最終ポイント（段位戦の段位ポイントとは別の、順位点つきの成績）。
 * 「トップが偉い」型の試し用で、結果画面に参考として出すだけ。段位・雀玉には影響しない。
 *
 * Mリーグ型: 25000点持ち・30000点返し、順位点は 1位+50 / 2位+10 / 3位-10 / 4位-30
 * （オカ込みの値。全員が25000点なら0になる）。最終ポイント = (持ち点 − 30000) / 1000 + 順位点。
 * 順位点の数値はここに集めてあるので、調整はこのファイルだけで済む。
 */
import type { PlayerIndex } from "./actions.js";
import { rankSeats } from "./matchFormat.js";

export interface MatchPointRule {
  id: string;
  name: string;
  /** 返し点（これを超えた分がポイントになる）。 */
  returnScore: number;
  /** 1位〜4位の順位点。 */
  placement: readonly [number, number, number, number];
}

export const M_LEAGUE_RULE: MatchPointRule = {
  id: "m-league",
  name: "Mリーグ式",
  returnScore: 30000,
  placement: [50, 10, -10, -30],
};

/** 各席の最終ポイント（小数第1位まで）。同点は起家に近い席が上（rankSeatsと同じ）。 */
export function matchPoints(
  scores: readonly [number, number, number, number],
  startingDealer: PlayerIndex,
  rule: MatchPointRule = M_LEAGUE_RULE,
): [number, number, number, number] {
  const points: [number, number, number, number] = [0, 0, 0, 0];
  rankSeats(scores, startingDealer).forEach((seat, index) => {
    const raw = (scores[seat] - rule.returnScore) / 1000 + rule.placement[index]!;
    points[seat] = Math.round(raw * 10) / 10;
  });
  return points;
}
