/**
 * 進行中の対局の保存（サーバーを再起動しても対局が消えないように）。
 *
 * rooms.tsが局面の進むたびに部屋ごと丸ごと上書きし、対局が終わるか部屋を
 * 片付けたら消す。起動時にloadAllで読み戻し、rooms.tsのrestoreで卓を作り直す。
 * 中身の形はrooms.ts（RoomSnapshot）とmatchSession.ts（SessionSnapshot）が決め、
 * ここはJSONとして出し入れするだけ。
 */
import type { Database } from "./db.js";

export class MatchStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  save(roomCode: string, snapshot: unknown): void {
    this.db
      .prepare(
        `INSERT INTO online_matches (room_code, snapshot_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(room_code) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
      )
      .run(roomCode, JSON.stringify(snapshot), this.now());
  }

  delete(roomCode: string): void {
    this.db.prepare("DELETE FROM online_matches WHERE room_code = ?").run(roomCode);
  }

  /** 保存されている対局すべて（壊れていて読めないものは消して飛ばす）。 */
  loadAll(): { roomCode: string; snapshot: unknown; updatedAt: number }[] {
    const rows = this.db.prepare("SELECT room_code, snapshot_json, updated_at FROM online_matches").all() as {
      room_code: string;
      snapshot_json: string;
      updated_at: number;
    }[];
    const result: { roomCode: string; snapshot: unknown; updatedAt: number }[] = [];
    for (const row of rows) {
      try {
        result.push({ roomCode: row.room_code, snapshot: JSON.parse(row.snapshot_json), updatedAt: row.updated_at });
      } catch {
        console.error(`[majyan-server] 保存された対局を読めなかったため消します: ${row.room_code}`);
        this.delete(row.room_code);
      }
    }
    return result;
  }
}
