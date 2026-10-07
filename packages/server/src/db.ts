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

/** テストで「途中のバージョンのDB」を作れるようにexportしている。 */
export const MIGRATIONS: readonly string[] = [
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
  // 4: 雀玉（無償・有償を分けて持つ）と、その増減の記録、1日ごとの受け取り記録
  `
  CREATE TABLE wallets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    free_jade INTEGER NOT NULL CHECK (free_jade >= 0),
    paid_jade INTEGER NOT NULL CHECK (paid_jade >= 0)
  );
  CREATE TABLE jade_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    free_delta INTEGER NOT NULL,
    paid_delta INTEGER NOT NULL,
    free_after INTEGER NOT NULL,
    paid_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX jade_ledger_user ON jade_ledger(user_id);
  CREATE TABLE daily_claims (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, date)
  );
  `,
  // 5: 天井の交換ポイント
  `
  CREATE TABLE gacha_points (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL CHECK (points >= 0)
  );
  `,
  // 6: キャラを1体ずつ別に持つ形へ（凸をやめる）。カードは手持ち枚数と、キャラに付けたもの。
  //    以前の「重なった数(copies)」はその数だけ別々のキャラに展開する。
  `
  CREATE TABLE character_units (
    unit_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    card_id TEXT,
    source TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    card_equipped_at INTEGER
  );
  CREATE INDEX character_units_user ON character_units(user_id);
  CREATE TABLE user_cards (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    count INTEGER NOT NULL CHECK (count >= 0),
    PRIMARY KEY (user_id, card_id)
  );
  WITH RECURSIVE expanded(user_id, character_id, source, acquired_at, n, copies) AS (
    SELECT user_id, character_id, source, acquired_at, 1, copies FROM user_characters
    UNION ALL
    SELECT user_id, character_id, source, acquired_at, n + 1, copies FROM expanded WHERE n < copies
  )
  INSERT INTO character_units (unit_id, user_id, character_id, card_id, source, acquired_at, card_equipped_at)
    SELECT lower(hex(randomblob(12))), user_id, character_id, NULL, source, acquired_at, NULL FROM expanded;
  DROP TABLE user_characters;
  `,
  // 7: 引き継ぎコードとパスワード（別の端末から同じアカウントに戻るため）
  `
  CREATE TABLE transfer_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // 8: 進行中の対局（サーバーを再起動しても続きから打てるように、局面が進むたびに上書きする）
  `
  CREATE TABLE online_matches (
    room_code TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // 9: 段位戦の卓の4席（CPUも含む。戦績で「誰と・どのキャラで打ったか」を見せるため）
  `
  CREATE TABLE ranked_match_seats (
    match_id TEXT NOT NULL REFERENCES ranked_matches(id) ON DELETE CASCADE,
    seat INTEGER NOT NULL,
    -- CPUの席はNULL
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    character_id TEXT NOT NULL,
    card_id TEXT,
    place INTEGER NOT NULL,
    final_score INTEGER NOT NULL,
    PRIMARY KEY (match_id, seat)
  );
  `,
  // 10: 運営からのお知らせと、プレゼントボックス（補填・配布）
  `
  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    -- 出すのをやめた時刻（NULLなら出し続ける）
    ends_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    jade INTEGER NOT NULL,
    -- GachaItem[]
    items_json TEXT NOT NULL,
    -- 特定の1人宛て。NULLなら全員宛て
    target_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    -- 全員宛ての時、この時刻までに作られたアカウントだけが受け取れる（NULLなら後から作った人も）
    eligible_created_before INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    cancelled_at INTEGER
  );
  CREATE TABLE gift_claims (
    gift_id INTEGER NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claimed_at INTEGER NOT NULL,
    PRIMARY KEY (gift_id, user_id)
  );
  `,
  // 11: 退会（行は消さずに印を付ける。雀玉の記録などは残す必要があるため）
  `
  ALTER TABLE users ADD COLUMN deleted_at INTEGER;
  `,
  // 12: フレンド（コードは初めて使う時に作る。フレンドは両方向に1行ずつ持つ）
  `
  ALTER TABLE users ADD COLUMN friend_code TEXT;
  CREATE UNIQUE INDEX users_friend_code ON users(friend_code);
  CREATE TABLE friend_requests (
    from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (from_user, to_user)
  );
  CREATE INDEX friend_requests_to ON friend_requests(to_user);
  CREATE TABLE friends (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );
  `,
  // 13: 段位戦の牌譜（1局ずつgzipしたJSON。対局が終わる前から局ごとに書いていく）
  `
  CREATE TABLE match_replays (
    match_id TEXT NOT NULL,
    round_index INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (match_id, round_index)
  );
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

const transactionDepth = new WeakMap<Database, number>();

/**
 * fnの中の書き込みをまとめて確定する（途中で例外が出たら全部取り消す）。
 * transactionの中で呼ばれたtransactionは外側にまとめる（ガチャで「雀玉を減らす」と
 * 「キャラを渡す」を1つにまとめる等、サービスをまたいで使えるように）。
 */
export function transaction<T>(db: Database, fn: () => T): T {
  const depth = transactionDepth.get(db) ?? 0;
  if (depth > 0) return fn();
  db.exec("BEGIN");
  transactionDepth.set(db, 1);
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    transactionDepth.set(db, 0);
  }
}
