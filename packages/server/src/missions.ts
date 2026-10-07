/**
 * デイリーミッションの進み具合と報酬の受け取り。定義はcoreのmissions.ts。
 * 進み具合は段位戦の記録（ranked_results）を今日の分（日本時間）だけ数える。
 * 受け取った記録は daily_claims に kind="mission:<id>" で残す（1日1回まで）。
 */
import { DAILY_MISSIONS, jstDate, type MissionDef, type MissionView } from "@majyan/core";
import { transaction, type Database } from "./db.js";
import type { WalletService } from "./wallet.js";

const DAY_MS = 24 * 60 * 60_000;
const CLAIM_KIND_PREFIX = "mission:";

export class MissionError extends Error {}

/** その時刻を含む日本時間の1日の始まり（ミリ秒）。 */
export function jstDayStart(ms: number): number {
  return Date.parse(`${jstDate(ms)}T00:00:00+09:00`);
}

export class MissionService {
  constructor(
    private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly now: () => number = Date.now,
    private readonly missions: readonly MissionDef[] = DAILY_MISSIONS,
  ) {}

  /** 次にリセットされる時刻。 */
  resetsAt(): number {
    return jstDayStart(this.now()) + DAY_MS;
  }

  private progressOf(userId: string, mission: MissionDef, dayStart: number): number {
    const placeLimit = mission.kind === "ranked-top2" ? 2 : 4;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ranked_results r JOIN ranked_matches m ON m.id = r.match_id
         WHERE r.user_id = ? AND m.finished_at >= ? AND m.finished_at < ? AND r.place <= ?`,
      )
      .get(userId, dayStart, dayStart + DAY_MS, placeLimit) as { n: number };
    return Math.min(row.n, mission.target);
  }

  /** 今日のミッション。 */
  list(userId: string): MissionView[] {
    const t = this.now();
    const dayStart = jstDayStart(t);
    const date = jstDate(t);
    const rows = this.db
      .prepare("SELECT kind FROM daily_claims WHERE user_id = ? AND date = ? AND kind LIKE ?")
      .all(userId, date, `${CLAIM_KIND_PREFIX}%`) as { kind: string }[];
    const claimed = new Set(rows.map((r) => r.kind.slice(CLAIM_KIND_PREFIX.length)));
    return this.missions.map((m) => ({
      id: m.id,
      label: m.label,
      progress: this.progressOf(userId, m, dayStart),
      target: m.target,
      jade: m.jade,
      claimed: claimed.has(m.id),
    }));
  }

  claimableCount(userId: string): number {
    return this.list(userId).filter((m) => !m.claimed && m.progress >= m.target).length;
  }

  /** 達成したミッションの報酬を受け取る（missionIdがnullなら受け取れるもの全部）。受け取った雀玉を返す。 */
  claim(userId: string, missionId: string | null): number {
    return transaction(this.db, () => {
      const date = jstDate(this.now());
      const ready = this.list(userId).filter((m) => !m.claimed && m.progress >= m.target && (missionId === null || m.id === missionId));
      if (missionId !== null && ready.length === 0) throw new MissionError("このミッションはまだ受け取れません");
      let total = 0;
      for (const m of ready) {
        this.db
          .prepare("INSERT INTO daily_claims (user_id, kind, date, amount) VALUES (?, ?, ?, ?)")
          .run(userId, `${CLAIM_KIND_PREFIX}${m.id}`, date, m.jade);
        this.wallet.grantFree(userId, m.jade, "mission", `${date}:${m.id}`);
        total += m.jade;
      }
      return total;
    });
  }
}
