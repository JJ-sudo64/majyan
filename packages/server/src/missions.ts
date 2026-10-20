/**
 * デイリー・ウィークリーミッションの進み具合と報酬の受け取り。定義はcoreのmissions.ts。
 * 進み具合は段位戦の記録（ranked_results）を、今日（日本時間）またはこの週（月曜0時から）の分だけ数える。
 * 受け取った記録は daily_claims に kind="mission:<id>" で残す（デイリーは日付、ウィークリーはその週の月曜の日付を
 * dateにして、1期間1回まで）。
 */
import { ALL_MISSIONS, jstDate, type MissionDef, type MissionView } from "@majyan/core";
import { transaction, type Database } from "./db.js";
import type { WalletService } from "./wallet.js";

const DAY_MS = 24 * 60 * 60_000;
const CLAIM_KIND_PREFIX = "mission:";

const WEEK_MS = 7 * DAY_MS;

export class MissionError extends Error {}

/** その時刻を含む日本時間の1日の始まり（ミリ秒）。 */
export function jstDayStart(ms: number): number {
  return Date.parse(`${jstDate(ms)}T00:00:00+09:00`);
}

/** その時刻を含む日本時間の週（月曜0時始まり）の始まり（ミリ秒）。 */
export function jstWeekStart(ms: number): number {
  const day = jstDayStart(ms);
  // 日本時間の0時はUTCでは前日15時。+9時間ずらしてUTCの曜日を読む。
  const weekday = new Date(day + 9 * 60 * 60_000).getUTCDay(); // 0=日
  return day - ((weekday + 6) % 7) * DAY_MS;
}

export class MissionService {
  constructor(
    private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly now: () => number = Date.now,
    private readonly missions: readonly MissionDef[] = ALL_MISSIONS,
  ) {}

  /** 次にデイリーがリセットされる時刻。 */
  resetsAt(): number {
    return jstDayStart(this.now()) + DAY_MS;
  }

  /** 次にウィークリーがリセットされる時刻（月曜0時）。 */
  weeklyResetsAt(): number {
    return jstWeekStart(this.now()) + WEEK_MS;
  }

  /** そのミッションの今の期間の始まりと長さ、受け取り記録に使う日付。 */
  private periodOf(mission: MissionDef): { start: number; length: number; key: string } {
    const t = this.now();
    if (mission.period === "weekly") {
      const start = jstWeekStart(t);
      return { start, length: WEEK_MS, key: jstDate(start) };
    }
    return { start: jstDayStart(t), length: DAY_MS, key: jstDate(t) };
  }

  private progressOf(userId: string, mission: MissionDef): number {
    const placeLimit = mission.kind === "ranked-first" ? 1 : mission.kind === "ranked-top2" ? 2 : 4;
    const { start, length } = this.periodOf(mission);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ranked_results r JOIN ranked_matches m ON m.id = r.match_id
         WHERE r.user_id = ? AND m.finished_at >= ? AND m.finished_at < ? AND r.place <= ?`,
      )
      .get(userId, start, start + length, placeLimit) as { n: number };
    return Math.min(row.n, mission.target);
  }

  /** 今のミッション（デイリーとウィークリー）。 */
  list(userId: string): MissionView[] {
    const rows = this.db
      .prepare("SELECT kind, date FROM daily_claims WHERE user_id = ? AND kind LIKE ?")
      .all(userId, `${CLAIM_KIND_PREFIX}%`) as { kind: string; date: string }[];
    const claimed = new Set(rows.map((r) => `${r.kind.slice(CLAIM_KIND_PREFIX.length)}@${r.date}`));
    return this.missions.map((m) => ({
      id: m.id,
      label: m.label,
      period: m.period,
      progress: this.progressOf(userId, m),
      target: m.target,
      jade: m.jade,
      claimed: claimed.has(`${m.id}@${this.periodOf(m).key}`),
    }));
  }

  claimableCount(userId: string): number {
    return this.list(userId).filter((m) => !m.claimed && m.progress >= m.target).length;
  }

  /** 達成したミッションの報酬を受け取る（missionIdがnullなら受け取れるもの全部）。受け取った雀玉を返す。 */
  claim(userId: string, missionId: string | null): number {
    return transaction(this.db, () => {
      const ready = this.list(userId).filter((m) => !m.claimed && m.progress >= m.target && (missionId === null || m.id === missionId));
      if (missionId !== null && ready.length === 0) throw new MissionError("このミッションはまだ受け取れません");
      let total = 0;
      for (const m of ready) {
        const date = this.periodOf(this.missions.find((d) => d.id === m.id)!).key;
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
