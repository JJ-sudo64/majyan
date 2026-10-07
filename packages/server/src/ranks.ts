/**
 * 段位の保存と、段位戦の結果の反映。計算そのものはcoreのranked.ts。
 */
import {
  INITIAL_RANK,
  isValidRank,
  rankAfterMatch,
  rankLabel,
  toRankView,
  type MatchFormat,
  type PlayerIndex,
  type RankedHistoryEntry,
  type RankedHistoryResponse,
  type RankedPlaceStats,
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

/** 段位戦の卓の1席（CPUも含めて4席とも渡す）。戦績の画面に出す。 */
export interface RankedSeatRecord {
  seat: PlayerIndex;
  /** CPUはnull。 */
  userId: string | null;
  name: string;
  characterId: string;
  cardId: string | null;
  place: 1 | 2 | 3 | 4;
  finalScore: number;
}

/** 戦績で返す最近の対局の数。 */
export const RANKED_HISTORY_LIMIT = 20;

const emptyStats = (): RankedPlaceStats => ({ games: 0, places: [0, 0, 0, 0] });

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
  recordMatch(
    matchId: string,
    format: MatchFormat,
    results: RankedPlayerResult[],
    seats: RankedSeatRecord[] = [],
  ): Map<string, RankResult> {
    const changes = new Map<string, RankResult>();
    transaction(this.db, () => {
      const exists = this.db.prepare("SELECT 1 FROM ranked_matches WHERE id = ?").get(matchId);
      if (exists) return;
      const now = this.now();
      this.db.prepare("INSERT INTO ranked_matches (id, format, finished_at) VALUES (?, ?, ?)").run(matchId, format, now);
      for (const seat of seats) {
        this.db
          .prepare(
            `INSERT INTO ranked_match_seats (match_id, seat, user_id, name, character_id, card_id, place, final_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(matchId, seat.seat, seat.userId, seat.name, seat.characterId, seat.cardId, seat.place, seat.finalScore);
      }
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

  /** 段位戦の戦績（通算・形式ごとの順位の回数と、最近の対局）。 */
  history(userId: string, limit = RANKED_HISTORY_LIMIT): RankedHistoryResponse {
    const total = emptyStats();
    const byFormat: Record<MatchFormat, RankedPlaceStats> = { tonpuusen: emptyStats(), hanchan: emptyStats() };
    const counts = this.db
      .prepare(
        `SELECT m.format AS format, r.place AS place, COUNT(*) AS n FROM ranked_results r
         JOIN ranked_matches m ON m.id = r.match_id WHERE r.user_id = ? GROUP BY m.format, r.place`,
      )
      .all(userId) as { format: MatchFormat; place: number; n: number }[];
    for (const c of counts) {
      for (const stats of [total, byFormat[c.format]]) {
        if (!stats || c.place < 1 || c.place > 4) continue;
        stats.games += c.n;
        stats.places[c.place - 1]! += c.n;
      }
    }

    const rows = this.db
      .prepare(
        `SELECT r.match_id, m.format, m.finished_at, r.place, r.final_score, r.delta, r.tier_after, r.level_after, r.points_after
         FROM ranked_results r JOIN ranked_matches m ON m.id = r.match_id
         WHERE r.user_id = ? ORDER BY m.finished_at DESC, m.rowid DESC LIMIT ?`,
      )
      .all(userId, limit) as {
      match_id: string;
      format: MatchFormat;
      finished_at: number;
      place: 1 | 2 | 3 | 4;
      final_score: number;
      delta: number;
      tier_after: number;
      level_after: number;
      points_after: number;
    }[];
    const seatQuery = this.db.prepare(
      `SELECT user_id, name, character_id, card_id, place, final_score FROM ranked_match_seats
       WHERE match_id = ? ORDER BY place, seat`,
    );
    const recent: RankedHistoryEntry[] = rows.map((row) => {
      const after = { tier: row.tier_after, level: row.level_after, points: row.points_after };
      const seats = seatQuery.all(row.match_id) as {
        user_id: string | null;
        name: string;
        character_id: string;
        card_id: string | null;
        place: 1 | 2 | 3 | 4;
        final_score: number;
      }[];
      return {
        matchId: row.match_id,
        format: row.format,
        finishedAt: row.finished_at,
        place: row.place,
        finalScore: row.final_score,
        delta: row.delta,
        // 段位の表を後から調整して範囲外になった記録は、ラベルだけ出せないので空にする。
        rankAfter: isValidRank(after) ? rankLabel(after) : "",
        seats: seats.map((s) => ({
          name: s.name,
          isYou: s.user_id === userId,
          isCpu: s.user_id === null,
          characterId: s.character_id,
          cardId: s.card_id,
          place: s.place,
          finalScore: s.final_score,
        })),
      };
    });
    return { total, byFormat, recent };
  }
}
