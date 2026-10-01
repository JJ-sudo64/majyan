/**
 * 段位の保存と、段位戦の結果の反映。計算そのものはcoreのranked.ts。
 */
import {
  INITIAL_RANK,
  isValidRank,
  rankAfterMatch,
  toRankView,
  type MatchFormat,
  type PlayerIndex,
  type RankResult,
  type RankState,
  type RankView,
} from "@majyan/core";
import { transaction, type Database } from "./db.js";

interface RankRow {
  tier: number;
  level: number;
  points: number;
  games_played: number;
}

export interface RankedPlayerResult {
  userId: string;
  seat: PlayerIndex;
  place: 1 | 2 | 3 | 4;
  finalScore: number;
}

export class RankService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  private row(userId: string): { rank: RankState; games: number } {
    const row = this.db.prepare("SELECT tier, level, points, games_played FROM user_ranks WHERE user_id = ?").get(userId) as
      | RankRow
      | undefined;
    if (!row) return { rank: INITIAL_RANK, games: 0 };
    const rank = { tier: row.tier, level: row.level, points: row.points };
    // 段位の表(RANK_TIERS)を調整して今の値が範囲外になった場合も、壊れた値を返さない。
    return { rank: isValidRank(rank) ? rank : INITIAL_RANK, games: row.games_played };
  }

  get(userId: string): RankView {
    const { rank, games } = this.row(userId);
    return toRankView(rank, games);
  }

  /**
   * 段位戦1試合の結果を反映する（人間の席だけ渡す）。同じmatchIdを2回渡しても
   * 2回目は何もしない（二重に段位が動かないように）。
   */
  recordMatch(matchId: string, format: MatchFormat, results: RankedPlayerResult[]): Map<string, RankResult> {
    const changes = new Map<string, RankResult>();
    transaction(this.db, () => {
      const exists = this.db.prepare("SELECT 1 FROM ranked_matches WHERE id = ?").get(matchId);
      if (exists) return;
      const now = this.now();
      this.db.prepare("INSERT INTO ranked_matches (id, format, finished_at) VALUES (?, ?, ?)").run(matchId, format, now);
      for (const r of results) {
        const { rank, games } = this.row(r.userId);
        const change = rankAfterMatch(rank, format, r.place, r.finalScore);
        const after = change.after;
        this.db
          .prepare(
            `INSERT INTO user_ranks (user_id, tier, level, points, games_played, updated_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, level = excluded.level, points = excluded.points,
               games_played = excluded.games_played, updated_at = excluded.updated_at`,
          )
          .run(r.userId, after.tier, after.level, after.points, games + 1, now);
        this.db
          .prepare(
            `INSERT INTO ranked_results (match_id, user_id, seat, place, final_score, delta,
               tier_before, level_before, points_before, tier_after, level_after, points_after)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(matchId, r.userId, r.seat, r.place, r.finalScore, change.delta, rank.tier, rank.level, rank.points, after.tier, after.level, after.points);
        changes.set(r.userId, {
          place: r.place,
          delta: change.delta,
          jadeReward: 0, // 雀玉の報酬は呼び出し側（rooms.ts）が渡して書き込む
          before: toRankView(rank, games),
          after: toRankView(after, games + 1),
        });
      }
    });
    return changes;
  }
}
