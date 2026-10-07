/**
 * データベースの定期バックアップ。SQLiteの VACUUM INTO で、動かしたまま1ファイルの写しを作る
 * （書き込み中でも整合の取れた写しになる）。古いものは keep 個を超えたら消す。
 *
 * 戻す時はサーバーを止めて、写しを DATABASE_PATH の場所へコピーする（-wal / -shm は消す）。
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "./db.js";

const FILE_PREFIX = "majyan-";
const FILE_SUFFIX = ".db";

export interface BackupOptions {
  dir: string;
  /** 残す数（古いものから消す）。 */
  keep: number;
  now?: () => number;
}

/** 2026-10-07T11:22:33Z → "majyan-20261007-112233.db"（UTC。並べると古い順になる）。 */
export function backupFileName(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${FILE_PREFIX}${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}${FILE_SUFFIX}`;
}

/** 写しを1つ作り、古いものを消す。作ったファイルのパスを返す。 */
export function backupNow(db: Database, options: BackupOptions): string {
  mkdirSync(options.dir, { recursive: true });
  const path = join(options.dir, backupFileName((options.now ?? Date.now)()));
  rmSync(path, { force: true }); // 同じ秒に2回作った時（VACUUM INTOは既存のファイルがあると失敗する）
  db.prepare("VACUUM INTO ?").run(path);
  const files = readdirSync(options.dir)
    .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - options.keep))) rmSync(join(options.dir, old), { force: true });
  return path;
}

/** 一定間隔でバックアップを取る。止める関数を返す。失敗してもサーバーは止めない（ログに出す）。 */
export function scheduleBackups(db: Database, options: BackupOptions & { intervalMs: number }): () => void {
  const run = () => {
    try {
      const path = backupNow(db, options);
      console.log(`[majyan-server] バックアップを作りました: ${path}`);
    } catch (err) {
      console.error("[majyan-server] バックアップに失敗しました:", err);
    }
  };
  // 再起動が多いと間隔のタイマーが毎回やり直しになるので、最後の写しが古ければ起動時にも取る。
  if ((options.now ?? Date.now)() - latestBackupAt(options.dir) >= options.intervalMs) run();
  const timer = setInterval(run, options.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** 一番新しい写しを作った時刻（無ければ0）。 */
function latestBackupAt(dir: string): number {
  try {
    const files = readdirSync(dir).filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX));
    return Math.max(0, ...files.map((f) => statSync(join(dir, f)).mtimeMs));
  } catch {
    return 0;
  }
}
