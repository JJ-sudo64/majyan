/**
 * フレンド。10桁のフレンドコードで申請し、相手が承認したら成立する（勝手に登録されないように）。
 * フレンドが友人戦の待合室にいれば、一覧からその部屋に入れる（招待の代わり）。
 */
import { randomInt } from "node:crypto";
import {
  MAX_FRIENDS,
  MAX_PENDING_FRIEND_REQUESTS,
  normalizeFriendCode,
  type FriendRequestView,
  type FriendsResponse,
  type FriendView,
} from "@majyan/core";
import { transaction, type Database } from "./db.js";
import type { RankService } from "./ranks.js";

export class FriendError extends Error {}

export interface FriendServiceOptions {
  ranks: RankService;
  /** その人の今の様子（rooms.tsのpresenceOf）。無ければ常にnull。 */
  presenceOf?: (userId: string) => FriendView["presence"];
  now?: () => number;
}

interface PersonRow {
  id: string;
  display_name: string;
  friend_code: string | null;
  last_login_at: number;
}

export class FriendService {
  private readonly now: () => number;

  constructor(
    private readonly db: Database,
    private readonly options: FriendServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /** その人のフレンドコード（まだ無ければ作る）。 */
  codeOf(userId: string): string {
    const row = this.db.prepare("SELECT friend_code FROM users WHERE id = ?").get(userId) as { friend_code: string | null } | undefined;
    if (row?.friend_code) return row.friend_code;
    for (;;) {
      // 先頭を0にしない10桁（読み上げで桁が欠けないように）。
      const code = String(randomInt(1_000_000_000, 10_000_000_000));
      if (this.db.prepare("SELECT 1 FROM users WHERE friend_code = ?").get(code)) continue;
      this.db.prepare("UPDATE users SET friend_code = ? WHERE id = ?").run(code, userId);
      return code;
    }
  }

  private findByCode(input: unknown): PersonRow {
    const code = typeof input === "string" ? normalizeFriendCode(input) : "";
    const row =
      code.length === 10
        ? (this.db
            .prepare("SELECT id, display_name, friend_code, last_login_at FROM users WHERE friend_code = ? AND deleted_at IS NULL")
            .get(code) as PersonRow | undefined)
        : undefined;
    if (!row) throw new FriendError("そのフレンドコードの人は見つかりません");
    return row;
  }

  private areFriends(a: string, b: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?").get(a, b);
  }

  private friendCount(userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM friends WHERE user_id = ?").get(userId) as { n: number }).n;
  }

  private makeFriends(a: string, b: string): void {
    if (this.friendCount(a) >= MAX_FRIENDS || this.friendCount(b) >= MAX_FRIENDS) {
      throw new FriendError(`フレンドは${MAX_FRIENDS}人までです`);
    }
    const t = this.now();
    this.db.prepare("DELETE FROM friend_requests WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)").run(a, b, b, a);
    this.db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?), (?, ?, ?)").run(a, b, t, b, a, t);
  }

  /** フレンド申請。相手からも申請が来ていれば、その場でフレンドになる。 */
  request(userId: string, code: unknown): void {
    transaction(this.db, () => {
      const target = this.findByCode(code);
      if (target.id === userId) throw new FriendError("自分には申請できません");
      if (this.areFriends(userId, target.id)) throw new FriendError("すでにフレンドです");
      if (this.db.prepare("SELECT 1 FROM friend_requests WHERE from_user = ? AND to_user = ?").get(target.id, userId)) {
        this.makeFriends(userId, target.id);
        return;
      }
      if (this.db.prepare("SELECT 1 FROM friend_requests WHERE from_user = ? AND to_user = ?").get(userId, target.id)) {
        throw new FriendError("すでに申請しています");
      }
      const pending = (this.db.prepare("SELECT COUNT(*) AS n FROM friend_requests WHERE from_user = ?").get(userId) as { n: number }).n;
      if (pending >= MAX_PENDING_FRIEND_REQUESTS) throw new FriendError(`承認待ちの申請は${MAX_PENDING_FRIEND_REQUESTS}件までです`);
      if (this.friendCount(userId) >= MAX_FRIENDS) throw new FriendError(`フレンドは${MAX_FRIENDS}人までです`);
      this.db.prepare("INSERT INTO friend_requests (from_user, to_user, created_at) VALUES (?, ?, ?)").run(userId, target.id, this.now());
    });
  }

  /** 届いた申請を承認する（acceptがfalseならお断り。相手には知らせない）。 */
  respond(userId: string, code: unknown, accept: boolean): void {
    transaction(this.db, () => {
      const from = this.findByCode(code);
      const exists = this.db.prepare("SELECT 1 FROM friend_requests WHERE from_user = ? AND to_user = ?").get(from.id, userId);
      if (!exists) throw new FriendError("その人からの申請はありません");
      if (accept) this.makeFriends(userId, from.id);
      else this.db.prepare("DELETE FROM friend_requests WHERE from_user = ? AND to_user = ?").run(from.id, userId);
    });
  }

  /** フレンドをやめる（相手の一覧からも消える）。出した申請の取り下げもこれで行う。 */
  remove(userId: string, code: unknown): void {
    const other = this.findByCode(code);
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)").run(userId, other.id, other.id, userId);
      this.db.prepare("DELETE FROM friend_requests WHERE from_user = ? AND to_user = ?").run(userId, other.id);
    });
  }

  incomingCount(userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM friend_requests WHERE to_user = ?").get(userId) as { n: number }).n;
  }

  list(userId: string): FriendsResponse {
    const people = (sql: string) => this.db.prepare(sql).all(userId) as unknown as (PersonRow & { created_at: number })[];
    const toRequest = (r: PersonRow & { created_at: number }): FriendRequestView => ({
      code: r.friend_code ?? this.codeOf(r.id),
      displayName: r.display_name,
      rankLabel: this.options.ranks.get(r.id).label,
      createdAt: r.created_at,
    });
    const friends: FriendView[] = people(
      `SELECT u.id, u.display_name, u.friend_code, u.last_login_at, f.created_at FROM friends f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ? AND u.deleted_at IS NULL`,
    ).map((r) => ({
      code: r.friend_code ?? this.codeOf(r.id),
      displayName: r.display_name,
      rankLabel: this.options.ranks.get(r.id).label,
      lastLoginAt: r.last_login_at,
      presence: this.options.presenceOf?.(r.id) ?? null,
    }));
    // 部屋で待っている人→対局中→最近ログインした人の順。
    const order = (f: FriendView) => (f.presence === null ? 2 : f.presence === "playing" ? 1 : 0);
    friends.sort((a, b) => order(a) - order(b) || b.lastLoginAt - a.lastLoginAt);
    return {
      myCode: this.codeOf(userId),
      friends,
      incoming: people(
        `SELECT u.id, u.display_name, u.friend_code, u.last_login_at, r.created_at FROM friend_requests r JOIN users u ON u.id = r.from_user
         WHERE r.to_user = ? AND u.deleted_at IS NULL ORDER BY r.created_at DESC`,
      ).map(toRequest),
      outgoing: people(
        `SELECT u.id, u.display_name, u.friend_code, u.last_login_at, r.created_at FROM friend_requests r JOIN users u ON u.id = r.to_user
         WHERE r.from_user = ? AND u.deleted_at IS NULL ORDER BY r.created_at DESC`,
      ).map(toRequest),
    };
  }
}
