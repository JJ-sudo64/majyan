/**
 * サーバーのデータベース（アカウント・所持品・段位など、再起動しても消えては
 * いけないもの）。今はNode組み込みのSQLite（ファイル1つ）を使う。利用者が
 * 増えて1台に収まらなくなったらPostgreSQL等へ移す想定なので、SQLを書くのは
 * このファイルと各サービス（accounts.ts等）の中だけに留める。
 *
 * スキーマの変更はMIGRATIONSの末尾に追加していく（既存の要素は書き換えない）。
 * 起動時に未適用のものだけを順に適用する。
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// node:sqliteは新しい組み込みモジュールで、テストで使うVite(vitest)がまだ
// 組み込みとして認識できず読み込みに失敗するため、requireで直接読み込む。
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const MIGRATIONS: string[] = [
  // 1: アカウント（ゲスト）とログイン用の鍵
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  );
  CREATE TABLE auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );
  CREATE INDEX auth_tokens_user ON auth_tokens(user_id);
  `,
  // 2: 段位と段位戦の記録
  `
  CREATE TABLE user_ranks (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tier INTEGER NOT NULL,
    level INTEGER NOT NULL,
    points INTEGER NOT NULL,
    games_played INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE ranked_matches (
    id TEXT PRIMARY KEY,
    format TEXT NOT NULL,
    finished_at INTEGER NOT NULL
  );
  CREATE TABLE ranked_results (
    match_id TEXT NOT NULL REFERENCES ranked_matches(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seat INTEGER NOT NULL,
    place INTEGER NOT NULL,
    final_score INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    tier_before INTEGER NOT NULL,
    level_before INTEGER NOT NULL,
    points_before INTEGER NOT NULL,
    tier_after INTEGER NOT NULL,
    level_after INTEGER NOT NULL,
    points_after INTEGER NOT NULL,
    PRIMARY KEY (match_id, user_id)
  );
  CREATE INDEX ranked_results_user ON ranked_results(user_id);
  `,
  // 3: 所持キャラと最初の10連、ガチャの記録
  `
  CREATE TABLE user_characters (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    -- 同じキャラが重なった数（重なった分の使い道は今後決める）
    copies INTEGER NOT NULL,
    source TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, character_id)
  );
  CREATE TABLE first_gacha (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pending_json TEXT,
    rolls INTEGER NOT NULL,
    confirmed_at INTEGER
  );
  CREATE TABLE gacha_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    results_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX gacha_log_user ON gacha_log(user_id);
  `,
];

export type Database = DatabaseSyncType;

/** pathに":memory:"を渡すとメモリ上だけのDB（テスト用）。 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]!);
      db.prepare("UPDATE schema_version SET version = ?").run(version + 1);
    });
    version++;
  }
}

/** fnの中の書き込みをまとめて確定する（途中で例外が出たら全部取り消す）。 */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
