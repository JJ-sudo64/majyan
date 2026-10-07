/**
 * 運営用のコマンド（お知らせ・プレゼント・アカウント検索）。サーバーと同じDBを直接読み書きする。
 * サーバーを動かしたままで使ってよい（画面は開くたびにDBを読むので、出した分はすぐ見える）。
 *
 *   npm run admin -- <コマンド>        （リポジトリ直下で。DATABASE_PATHはサーバーと同じ既定値）
 *
 *   news list                                         お知らせの一覧（下げたものも）
 *   news add --title 題 --body 本文 [--ends 2026-10-31]   お知らせを出す（本文の \n は改行。--endsの日の終わりで下げる）
 *   news end <番号>                                   お知らせを下げる
 *
 *   gift list                                         送ったプレゼントの一覧（受け取った人数つき）
 *   gift send --title 題 [--message 文] [--jade 数] [--character キャラID]... [--card カードID]...
 *             [--to アカウントID] [--include-new] [--days 日数 | --no-expiry]
 *        --to 無しなら全員宛て。全員宛ては送った時点で既にあるアカウントだけが受け取れる
 *        （--include-new を付けると後から作った人も）。期限は既定30日。
 *   gift cancel <番号>                                まだ受け取っていない人に出さなくする
 *
 *   user find <名前かIDの先頭8文字以上>               アカウントを探す（IDは画面の「引き継ぎ」に出ている）
 *   catalog                                           キャラ・カードのID一覧
 *   backup                                            今すぐDBのバックアップを取る（置き場所はサーバーと同じ BACKUP_DIR）
 */
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CARDS, CHARACTERS, characterRarity, type GachaItem } from "@majyan/core";
import { openDatabase, type Database } from "./db.js";
import { CollectionService } from "./collection.js";
import { WalletService } from "./wallet.js";
import { GiftError, InboxService } from "./inbox.js";
import { backupNow } from "./backup.js";

/** プレゼントの受け取り期限の既定（日）。 */
const DEFAULT_GIFT_DAYS = 30;
/** 問い合わせでアカウントIDを先頭だけ伝えてもらう時の最短の長さ。 */
export const ACCOUNT_ID_PREFIX_LENGTH = 8;

class UsageError extends Error {}

const fmt = (ms: number | null) =>
  ms === null ? "無期限" : new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" });

/** "2026-10-31" → その日（日本時間）が終わる時刻。 */
export function endOfJstDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UsageError(`日付は 2026-10-31 の形で書いてください: ${date}`);
  const start = Date.parse(`${date}T00:00:00+09:00`);
  if (Number.isNaN(start)) throw new UsageError(`日付が正しくありません: ${date}`);
  return start + 24 * 60 * 60_000;
}

/** IDそのもの、またはIDの先頭（8文字以上・1人に決まる）からアカウントIDを探す。 */
export function resolveUserId(db: Database, idOrPrefix: string): string {
  const key = idOrPrefix.trim().toLowerCase();
  if (key.length < ACCOUNT_ID_PREFIX_LENGTH) throw new UsageError(`アカウントIDは先頭${ACCOUNT_ID_PREFIX_LENGTH}文字以上を指定してください`);
  const rows = db.prepare("SELECT id FROM users WHERE id LIKE ? || '%' LIMIT 2").all(key) as { id: string }[];
  if (rows.length === 0) throw new UsageError(`アカウントが見つかりません: ${idOrPrefix}`);
  if (rows.length > 1) throw new UsageError(`複数のアカウントに当てはまります。もっと長く指定してください: ${idOrPrefix}`);
  return rows[0]!.id;
}

function positiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${label}は0以上の整数にしてください: ${value}`);
  return n;
}

/** コマンドを1つ実行して、表示する行を返す（テストから呼べるように出力はしない）。 */
export function runAdmin(db: Database, argv: string[], now: () => number = Date.now, backupDir?: string): string[] {
  const wallet = new WalletService(db, now);
  const inbox = new InboxService(db, new CollectionService(db, Math.random, now, wallet), wallet, now);
  const [group, command, ...rest] = argv;
  const out: string[] = [];

  switch (`${group ?? ""} ${command ?? ""}`.trim()) {
    case "news list": {
      for (const a of inbox.allAnnouncements()) {
        const state = a.endsAt !== null && a.endsAt <= now() ? "下げた" : a.publishedAt > now() ? "予約" : "掲載中";
        out.push(`#${a.id} [${state}] ${fmt(a.publishedAt)}〜${a.endsAt === null ? "" : fmt(a.endsAt)} ${a.title}`);
      }
      if (!out.length) out.push("お知らせはまだありません");
      return out;
    }
    case "news add": {
      const { values } = parseArgs({ args: rest, options: { title: { type: "string" }, body: { type: "string" }, ends: { type: "string" } } });
      if (!values.title || !values.body) throw new UsageError("--title と --body を指定してください");
      const id = inbox.postAnnouncement({
        title: values.title,
        body: values.body.replace(/\\n/g, "\n"),
        endsAt: values.ends ? endOfJstDay(values.ends) : null,
      });
      return [`お知らせ #${id} を出しました`];
    }
    case "news end": {
      const id = positiveInt(rest[0], "番号");
      if (id === undefined) throw new UsageError("下げるお知らせの番号を指定してください");
      return [inbox.endAnnouncement(id) ? `お知らせ #${id} を下げました` : `お知らせ #${id} は出ていません`];
    }
    case "gift list": {
      for (const g of inbox.allGifts()) {
        const to = g.targetUserId ? `宛先 ${g.targetUserId.slice(0, ACCOUNT_ID_PREFIX_LENGTH)}` : g.includeNewAccounts ? "全員（新規も）" : "全員";
        const contents = [g.jade ? `雀玉${g.jade}` : "", ...g.items.map(itemName)].filter(Boolean).join("・");
        const state = g.cancelled ? "取り消し" : g.expiresAt !== null && g.expiresAt <= now() ? "期限切れ" : "受付中";
        out.push(`#${g.id} [${state}] ${g.title}（${contents}）${to} 期限:${fmt(g.expiresAt)} 受け取り${g.claimedCount}人`);
      }
      if (!out.length) out.push("プレゼントはまだ送っていません");
      return out;
    }
    case "gift send": {
      const { values } = parseArgs({
        args: rest,
        options: {
          title: { type: "string" },
          message: { type: "string" },
          jade: { type: "string" },
          character: { type: "string", multiple: true },
          card: { type: "string", multiple: true },
          to: { type: "string" },
          "include-new": { type: "boolean" },
          days: { type: "string" },
          "no-expiry": { type: "boolean" },
        },
      });
      if (!values.title) throw new UsageError("--title を指定してください");
      if (values.days && values["no-expiry"]) throw new UsageError("--days と --no-expiry は同時に使えません");
      if (values.to && values["include-new"]) throw new UsageError("--include-new は全員宛ての時だけ使えます");
      const days = positiveInt(values.days, "日数") ?? DEFAULT_GIFT_DAYS;
      if (days === 0) throw new UsageError("日数は1以上にしてください");
      const items: GachaItem[] = [
        ...(values.character ?? []).map((id) => ({ kind: "character" as const, id })),
        ...(values.card ?? []).map((id) => ({ kind: "card" as const, id })),
      ];
      const targetUserId = values.to ? resolveUserId(db, values.to) : null;
      const id = inbox.sendGift({
        title: values.title,
        message: values.message?.replace(/\\n/g, "\n"),
        jade: positiveInt(values.jade, "雀玉") ?? 0,
        items,
        targetUserId,
        includeNewAccounts: !!values["include-new"],
        expiresAt: values["no-expiry"] ? null : now() + days * 24 * 60 * 60_000,
      });
      return [`プレゼント #${id} を${targetUserId ? `${targetUserId} さん宛てに` : "全員に"}送りました`];
    }
    case "gift cancel": {
      const id = positiveInt(rest[0], "番号");
      if (id === undefined) throw new UsageError("取り消すプレゼントの番号を指定してください");
      return [inbox.cancelGift(id) ? `プレゼント #${id} を取り消しました（受け取り済みの分はそのまま）` : `プレゼント #${id} は取り消せません`];
    }
    case "user find": {
      const key = rest.join(" ").trim();
      if (!key) throw new UsageError("探す名前かIDを指定してください");
      const rows = db
        .prepare(
          `SELECT id, display_name, created_at, last_login_at FROM users
           WHERE display_name LIKE '%' || ? || '%' OR (length(?) >= ? AND id LIKE lower(?) || '%')
           ORDER BY last_login_at DESC LIMIT 20`,
        )
        .all(key, key, ACCOUNT_ID_PREFIX_LENGTH, key) as { id: string; display_name: string; created_at: number; last_login_at: number }[];
      for (const r of rows) {
        const jade = wallet.balance(r.id);
        out.push(`${r.id}  ${r.display_name}  作成:${fmt(r.created_at)}  最終:${fmt(r.last_login_at)}  雀玉:無償${jade.free}/有償${jade.paid}`);
      }
      if (!out.length) out.push("見つかりませんでした");
      return out;
    }
    case "catalog": {
      out.push("キャラ（--character）:");
      for (const [id, c] of Object.entries(CHARACTERS)) out.push(`  ${id}  ${"★".repeat(characterRarity(id))} ${c.name}`);
      out.push("カード（--card）:");
      for (const [id, c] of Object.entries(CARDS)) out.push(`  ${id}  ${c.name}`);
      return out;
    }
    case "backup": {
      if (!backupDir) throw new UsageError("バックアップの置き場所が決まっていません");
      return [`バックアップを作りました: ${backupNow(db, { dir: backupDir, keep: Number(process.env.BACKUP_KEEP) || 28, now })}`];
    }
    default:
      throw new UsageError("使い方: news list|add|end / gift list|send|cancel / user find / catalog / backup（詳しくは src/admin.ts の先頭）");
  }
}

function itemName(item: GachaItem): string {
  return item.kind === "character" ? (CHARACTERS[item.id]?.name ?? item.id) : `カード「${CARDS[item.id]?.name ?? item.id}」`;
}

// `npm run admin` で直接実行された時だけ動かす（テストから読み込んだ時は動かさない）。
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const databasePath = process.env.DATABASE_PATH ?? resolve(import.meta.dirname, "../data/majyan.db");
  const db = openDatabase(databasePath);
  try {
    const backupDir = process.env.BACKUP_DIR ?? resolve(dirname(databasePath), "backups");
    for (const line of runAdmin(db, process.argv.slice(2), Date.now, backupDir)) console.log(line);
  } catch (err) {
    if (err instanceof UsageError || err instanceof GiftError || (err as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`エラー: ${(err as Error).message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    db.close();
  }
}
