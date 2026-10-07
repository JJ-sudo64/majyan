import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { AccountService } from "../src/accounts.js";
import { backupFileName, backupNow } from "../src/backup.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("backup", () => {
  it("writes a readable copy of the database and keeps only the newest ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "majyan-backup-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "live.db"));
    const { profile } = new AccountService(db).createGuest("バックアップ確認");
    const backups = join(dir, "backups");
    let t = Date.parse("2026-10-07T00:00:00Z");
    const now = () => t;

    const first = backupNow(db, { dir: backups, keep: 2, now });
    expect(first.endsWith(backupFileName(t))).toBe(true);
    const copy = openDatabase(first);
    expect(copy.prepare("SELECT display_name FROM users WHERE id = ?").get(profile.id)).toEqual({ display_name: "バックアップ確認" });
    copy.close();

    for (let i = 0; i < 3; i++) {
      t += 6 * 60 * 60_000;
      backupNow(db, { dir: backups, keep: 2, now });
    }
    expect(readdirSync(backups).sort()).toEqual([backupFileName(t - 6 * 60 * 60_000), backupFileName(t)]);
    db.close();
  });
});
