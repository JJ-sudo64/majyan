/**
 * 段位戦の牌譜の保存。1局終わるたびに、その局の牌譜（coreのreplay.ts）をgzipで1行ずつ書く。
 * 見られるのは、対局が終わった後（ranked_matchesに載った後）にその対局に出ていた人だけ。
 */
import { gunzipSync, gzipSync } from "node:zlib";
import type { PlayerIndex, ReplayResponse, ReplayRound, ReplaySeat, MatchFormat } from "@majyan/core";
import type { Database } from "./db.js";

export class ReplayStore {
  constructor(private readonly db: Database) {}

  saveRound(matchId: string, roundIndex: number, round: ReplayRound): void {
    this.db
      .prepare(
        `INSERT INTO match_replays (match_id, round_index, data) VALUES (?, ?, ?)
         ON CONFLICT(match_id, round_index) DO UPDATE SET data = excluded.data`,
      )
      .run(matchId, roundIndex, gzipSync(JSON.stringify(round)));
  }

  /** その人が見られる牌譜。無い・見られない時はnull。 */
  load(matchId: string, userId: string): ReplayResponse | null {
    const mine = this.db
      .prepare(
        `SELECT r.seat, m.format, m.finished_at FROM ranked_results r JOIN ranked_matches m ON m.id = r.match_id
         WHERE r.match_id = ? AND r.user_id = ?`,
      )
      .get(matchId, userId) as { seat: PlayerIndex; format: MatchFormat; finished_at: number } | undefined;
    if (!mine) return null;
    const rows = this.db.prepare("SELECT data FROM match_replays WHERE match_id = ? ORDER BY round_index").all(matchId) as {
      data: Uint8Array;
    }[];
    if (rows.length === 0) return null;
    const seatRows = this.db.prepare("SELECT seat, user_id, name FROM ranked_match_seats WHERE match_id = ?").all(matchId) as {
      seat: number;
      user_id: string | null;
      name: string;
    }[];
    const seats = ([0, 1, 2, 3] as const).map((seat): ReplaySeat => {
      const row = seatRows.find((r) => r.seat === seat);
      return { name: row?.name ?? `席${seat + 1}`, isCpu: row ? row.user_id === null : false };
    }) as ReplayResponse["seats"];
    return {
      matchId,
      format: mine.format,
      finishedAt: mine.finished_at,
      seats,
      yourSeat: mine.seat,
      rounds: rows.map((r) => JSON.parse(gunzipSync(r.data).toString("utf8")) as ReplayRound),
    };
  }

  has(matchId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM match_replays WHERE match_id = ? LIMIT 1").get(matchId);
  }
}
