/**
 * 他の人に迷惑な行為への備え: 使えない名前の判定と、対戦相手の通報。
 *
 * 通報は記録するだけで、自動では何もしない（数だけで罰すると、気に入らない相手への
 * 嫌がらせに使えてしまうため）。運営が管理画面か `npm run admin -- report list` で見て、
 * 名前を変える等の対応をする。
 */
import { REPORT_REASONS, type AdminReport, type ReportReason } from "@majyan/core";
import { transaction, type Database } from "./db.js";

/** 1人が1日（24時間）に出せる通報の数。 */
const MAX_REPORTS_PER_DAY = 10;

/**
 * 名前に入っていたら断る言葉（判定用の形＝ひらがな・小文字・記号なしで書く）。
 * 運営のふりをする名前と、はっきりした暴言・差別語・性的な言葉だけに絞ってある
 * （広げすぎると普通の名前まで弾いてしまう）。足りない分は通報と名前の変更で対応する。
 */
const BLOCKED_NAME_PARTS: readonly string[] = [
  // 運営のふり
  "運営",
  "うんえい",
  "公式",
  "こうしき",
  "管理者",
  "管理人",
  "かんりしゃ",
  "かんりにん",
  "さぽーと",
  "すたっふ",
  "admin",
  "official",
  "staff",
  "support",
  "moderator",
  // 暴言・脅し
  "死ね",
  "氏ね",
  "たひね",
  "殺す",
  "ころすぞ",
  "くたばれ",
  // 差別語
  "がいじ",
  "きちがい",
  "基地外",
  "しなじん",
  "nigger",
  "nigga",
  "ひとらー",
  "hitler",
  "なちす",
  "nazi",
  // 性的な言葉
  "ちんこ",
  "ちんぽ",
  "まんこ",
  "せっくす",
  "れいぷ",
  "fuck",
  "bitch",
  "penis",
  "pussy",
];

/** 判定用に形をそろえる（全角半角・大文字小文字・カタカナひらがなの違いと、間に挟んだ記号を無視する）。 */
function normalizeForFilter(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}\p{Cf}ー]/gu, "");
}

const NORMALIZED_BLOCKED = BLOCKED_NAME_PARTS.map(normalizeForFilter);

/** その名前は使えないか（本人が付ける時だけ確かめる。運営が付ける名前には使わない）。 */
export function isNameBlocked(name: string): boolean {
  const normalized = normalizeForFilter(name);
  return NORMALIZED_BLOCKED.some((word) => normalized.includes(word));
}

/** 利用者に見せてよい理由で断る時のエラー。 */
export class ReportError extends Error {}

export class ModerationService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 段位戦で同じ卓だった人を通報する。seatはその対局の席（戦績の一覧が返す番号）。
   * 同じ対局の同じ相手は1回だけ。
   */
  report(reporterId: string, matchId: unknown, seat: unknown, reason: unknown): void {
    if (typeof matchId !== "string" || !Number.isInteger(seat) || typeof reason !== "string" || !(reason in REPORT_REASONS)) {
      throw new ReportError("通報の内容が正しくありません");
    }
    const seats = this.db.prepare("SELECT seat, user_id, name FROM ranked_match_seats WHERE match_id = ?").all(matchId) as {
      seat: number;
      user_id: string | null;
      name: string;
    }[];
    if (!seats.some((s) => s.user_id === reporterId)) throw new ReportError("自分が打った対局の相手だけ通報できます");
    const target = seats.find((s) => s.seat === seat);
    if (!target?.user_id || target.user_id === reporterId) throw new ReportError("その席の人は通報できません");

    const t = this.now();
    transaction(this.db, () => {
      const recent = this.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?").get(reporterId, t - 24 * 60 * 60_000) as {
        n: number;
      };
      if (recent.n >= MAX_REPORTS_PER_DAY) throw new ReportError("通報が多すぎます。時間をおいてからお試しください");
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO reports (reporter_id, target_id, match_id, reason, target_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(reporterId, target.user_id, matchId, reason, target.name, t);
      if (inserted.changes === 0) throw new ReportError("この対局のこの相手は、すでに通報してあります");
    });
  }

  /** 運営用: 通報の一覧（新しい順）。openOnlyなら、まだ対応していないものだけ。 */
  list(openOnly: boolean, limit = 100): AdminReport[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.reporter_id, r.target_id, r.match_id, r.reason, r.target_name, r.created_at, r.handled_at,
                u.display_name AS current_name,
                (SELECT COUNT(DISTINCT r2.reporter_id) FROM reports r2 WHERE r2.target_id = r.target_id) AS reporters
         FROM reports r JOIN users u ON u.id = r.target_id
         ${openOnly ? "WHERE r.handled_at IS NULL" : ""} ORDER BY r.id DESC LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      reporter_id: string;
      target_id: string;
      match_id: string;
      reason: ReportReason;
      target_name: string;
      created_at: number;
      handled_at: number | null;
      current_name: string;
      reporters: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      reporterId: r.reporter_id,
      targetId: r.target_id,
      matchId: r.match_id,
      reason: r.reason,
      targetNameThen: r.target_name,
      targetNameNow: r.current_name,
      targetReporters: r.reporters,
      createdAt: r.created_at,
      handled: r.handled_at !== null,
    }));
  }

  /** 運営用: 通報を対応済みにする。 */
  markHandled(id: number): boolean {
    return this.db.prepare("UPDATE reports SET handled_at = ? WHERE id = ? AND handled_at IS NULL").run(this.now(), id).changes > 0;
  }

  /** 運営用: まだ対応していない通報の数。 */
  openCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE handled_at IS NULL").get() as { n: number }).n;
  }
}
