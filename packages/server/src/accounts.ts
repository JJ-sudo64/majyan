/**
 * アカウント。ゲストアカウント（名前を入れるだけで作れ、ブラウザに保存した
 * ログイン用の鍵(token)で本人確認する）に、引き継ぎコード＋パスワードで別の端末から
 * 戻る手段を足してある。Google等でのログインも、同じusersに別のログイン手段を
 * 足す形で後から追加する。
 *
 * 鍵そのものはDBに保存せず、ハッシュ値だけを保存する（DBが漏れても鍵として
 * 使えないように）。引き継ぎのパスワードは人が決める短い文字列なので、
 * 総当たりしにくいscrypt（塩付き）で保存する。
 */
import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import {
  PLAYER_NAME_MAX_LENGTH,
  TRANSFER_CODE_ALPHABET,
  TRANSFER_CODE_LENGTH,
  TRANSFER_PASSWORD_MAX_LENGTH,
  TRANSFER_PASSWORD_MIN_LENGTH,
  normalizeTransferCode,
  type AccountProfile,
} from "@majyan/core";
import { transaction, type Database } from "./db.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const hashPassword = (password: string, salt: string) => scryptSync(password.normalize("NFC"), salt, 32).toString("hex");

function newTransferCode(): string {
  let code = "";
  for (let i = 0; i < TRANSFER_CODE_LENGTH; i++) code += TRANSFER_CODE_ALPHABET[randomInt(TRANSFER_CODE_ALPHABET.length)];
  return code;
}

/** 引き継ぎのパスワードとして使えるか。使えなければ理由を返す。 */
export function transferPasswordProblem(value: unknown): string | null {
  if (typeof value !== "string") return "パスワードを入力してください";
  const length = [...value].length;
  if (length < TRANSFER_PASSWORD_MIN_LENGTH) return `パスワードは${TRANSFER_PASSWORD_MIN_LENGTH}文字以上にしてください`;
  if (length > TRANSFER_PASSWORD_MAX_LENGTH) return `パスワードは${TRANSFER_PASSWORD_MAX_LENGTH}文字以内にしてください`;
  return null;
}

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

/** 退会したアカウントの表示名。 */
export const DELETED_USER_NAME = "退会したユーザー";

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
        `SELECT u.id, u.display_name, u.created_at FROM auth_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND u.deleted_at IS NULL`,
      )
      .get(hashToken(token)) as UserRow | undefined;
    if (!row) return null;
    const now = this.now();
    this.db.prepare("UPDATE auth_tokens SET last_used_at = ? WHERE token_hash = ?").run(now, hashToken(token));
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, row.id);
    return toProfile(row);
  }

  /** ログイン用の鍵を新しく発行する（引き継ぎで別の端末から入った時など）。 */
  private issueToken(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    this.db
      .prepare("INSERT INTO auth_tokens (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), userId, now, now);
    return token;
  }

  /** 引き継ぎコード（まだ作っていなければnull）。 */
  transferCode(userId: string): string | null {
    const row = this.db.prepare("SELECT code FROM transfer_credentials WHERE user_id = ?").get(userId) as { code: string } | undefined;
    return row?.code ?? null;
  }

  /**
   * 引き継ぎのパスワードを決める（変える）。コードは最初に決めた時に作り、
   * パスワードを変えても同じコードのまま。
   */
  setTransferPassword(userId: string, password: string): string {
    const problem = transferPasswordProblem(password);
    if (problem) throw new Error(problem);
    const salt = randomBytes(16).toString("hex");
    const hash = hashPassword(password, salt);
    const now = this.now();
    return transaction(this.db, () => {
      const existing = this.transferCode(userId);
      if (existing) {
        this.db
          .prepare("UPDATE transfer_credentials SET password_hash = ?, salt = ?, updated_at = ? WHERE user_id = ?")
          .run(hash, salt, now, userId);
        return existing;
      }
      // 31種類×12桁なのでまず重ならないが、重なったら作り直す。
      let code = newTransferCode();
      while (this.db.prepare("SELECT 1 FROM transfer_credentials WHERE code = ?").get(code)) code = newTransferCode();
      this.db
        .prepare("INSERT INTO transfer_credentials (user_id, code, password_hash, salt, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(userId, code, hash, salt, now);
      return code;
    });
  }

  /**
   * 引き継ぎコードとパスワードでアカウントに入り、この端末用の鍵を発行する。
   * 違っていればnull（コードとパスワードのどちらが違うかは教えない）。
   * 元の端末の鍵はそのまま使える（両方の端末で遊べる）。
   */
  loginWithTransfer(code: unknown, password: unknown): { profile: AccountProfile; token: string } | null {
    if (typeof code !== "string" || typeof password !== "string" || transferPasswordProblem(password)) return null;
    const row = this.db
      .prepare("SELECT user_id, password_hash, salt FROM transfer_credentials WHERE code = ?")
      .get(normalizeTransferCode(code)) as { user_id: string; password_hash: string; salt: string } | undefined;
    if (!row) return null;
    const expected = Buffer.from(row.password_hash, "hex");
    const actual = Buffer.from(hashPassword(password, row.salt), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const profile = this.getProfile(row.user_id);
    if (!profile) return null;
    const token = this.issueToken(row.user_id);
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(this.now(), row.user_id);
    return { profile, token };
  }

  getProfile(userId: string): AccountProfile | null {
    const row = this.db.prepare("SELECT id, display_name, created_at FROM users WHERE id = ? AND deleted_at IS NULL").get(userId) as
      | UserRow
      | undefined;
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

  /**
   * 退会。ログインの鍵と引き継ぎコードを消して二度と入れなくし、名前を消す（他の人の戦績に
   * 残っている名前も）。行そのものは消さない（雀玉の増減の記録などは法律上残す必要があり、
   * 問い合わせにも答えられるように）。
   */
  deleteAccount(userId: string): void {
    transaction(this.db, () => {
      this.db.prepare("UPDATE users SET display_name = ?, deleted_at = ? WHERE id = ?").run(DELETED_USER_NAME, this.now(), userId);
      this.db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM transfer_credentials WHERE user_id = ?").run(userId);
      this.db.prepare("UPDATE ranked_match_seats SET name = ? WHERE user_id = ?").run(DELETED_USER_NAME, userId);
      this.db.prepare("DELETE FROM friends WHERE user_id = ? OR friend_id = ?").run(userId, userId);
      this.db.prepare("DELETE FROM friend_requests WHERE from_user = ? OR to_user = ?").run(userId, userId);
    });
  }
}
