/**
 * アカウント。今はゲストアカウントだけ（名前を入れるだけで作れ、ブラウザに
 * 保存したログイン用の鍵(token)で本人確認する）。メール・Google等でのログインや
 * 端末の引き継ぎは、同じusersに別のログイン手段を足す形で後から追加する。
 *
 * 鍵そのものはDBに保存せず、ハッシュ値だけを保存する（DBが漏れても鍵として
 * 使えないように）。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PLAYER_NAME_MAX_LENGTH, type AccountProfile } from "@majyan/core";
import { transaction, type Database } from "./db.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** 表示名として受け付ける形に整える。使えなければnull。 */
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // 制御文字・改行は除く（名前は他の人の画面にも出るため）。
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length === 0 || [...cleaned].length > PLAYER_NAME_MAX_LENGTH) return null;
  // U+FFFDは文字コードの違う名前が壊れて届いた印（UTF-8以外で送られた等）。
  if (cleaned.includes("�")) return null;
  return cleaned;
}

interface UserRow {
  id: string;
  display_name: string;
  created_at: number;
}

const toProfile = (row: UserRow): AccountProfile => ({ id: row.id, displayName: row.display_name, createdAt: row.created_at });

export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  /** ゲストアカウントを作り、ログイン用の鍵を返す（鍵はこの時しか分からない）。 */
  createGuest(displayName: string): { profile: AccountProfile; token: string } {
    const name = normalizeDisplayName(displayName);
    if (!name) throw new Error("名前が正しくありません");
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    transaction(this.db, () => {
      this.db.prepare("INSERT INTO users (id, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?)").run(id, name, now, now);
      this.db
        .prepare("INSERT INTO auth_tokens (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)")
        .run(hashToken(token), id, now, now);
    });
    return { profile: { id, displayName: name, createdAt: now }, token };
  }

  /** 鍵からアカウントを引く。知らない鍵ならnull。 */
  authenticate(token: unknown): AccountProfile | null {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
    const row = this.db
      .prepare(
        `SELECT u.id, u.display_name, u.created_at FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
      )
      .get(hashToken(token)) as UserRow | undefined;
    if (!row) return null;
    const now = this.now();
    this.db.prepare("UPDATE auth_tokens SET last_used_at = ? WHERE token_hash = ?").run(now, hashToken(token));
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, row.id);
    return toProfile(row);
  }

  getProfile(userId: string): AccountProfile | null {
    const row = this.db.prepare("SELECT id, display_name, created_at FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    return row ? toProfile(row) : null;
  }

  rename(userId: string, displayName: string): AccountProfile {
    const name = normalizeDisplayName(displayName);
    if (!name) throw new Error("名前が正しくありません");
    this.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(name, userId);
    const profile = this.getProfile(userId);
    if (!profile) throw new Error("アカウントが見つかりません");
    return profile;
  }
}
