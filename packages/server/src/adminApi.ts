/**
 * 運営用のHTTP API（/api/admin/...）。画面は ?admin のページ（web/src/components/AdminPage.tsx）。
 * サーバーを ADMIN_TOKEN 付きで起動した時だけ有効で、リクエストのヘッダー X-Admin-Token が
 * それと一致した時だけ受け付ける。間違いが続く接続元はしばらく締め出す（総当たり対策）。
 * やれることは admin.ts（コマンド）と同じで、どちらも同じDBを書く。
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ADMIN_TOKEN_HEADER,
  jstDate,
  type AdminStats,
  type AdminUser,
  type GachaItem,
} from "@majyan/core";
import type { Database } from "./db.js";
import { GiftError, type InboxService } from "./inbox.js";
import type { RankService } from "./ranks.js";
import type { WalletService } from "./wallet.js";
import { ACCOUNT_ID_PREFIX_LENGTH, endOfJstDay } from "./admin.js";

const DAY_MS = 24 * 60 * 60_000;
/** 間違えてよい回数（接続元ごと、1時間あたり）。 */
const MAX_FAILURES_PER_HOUR = 10;
/** 管理画面からのプレゼントの受け取り期限の既定（日）。 */
const DEFAULT_GIFT_DAYS = 30;

export interface AdminApiOptions {
  db: Database;
  inbox: InboxService;
  ranks: RankService;
  wallet: WalletService;
  /** サーバーのADMIN_TOKEN。空なら管理APIは無効（常に404）。 */
  token: string | undefined;
  liveStats?: () => { liveRooms: number; liveMatches: number };
  clientIp: (req: IncomingMessage) => string;
  readJson: (req: IncomingMessage) => Promise<unknown>;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
  now?: () => number;
}

class AdminInputError extends Error {}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAdminHandler(options: AdminApiOptions) {
  const { db, inbox, ranks, wallet, sendJson } = options;
  const now = options.now ?? Date.now;
  const failures = new Map<string, number[]>();
  const fail = (res: ServerResponse, status: number, error: string) => sendJson(res, status, { error });

  function recentFailures(ip: string): number[] {
    const t = now();
    const list = (failures.get(ip) ?? []).filter((x) => t - x < 60 * 60_000);
    if (list.length) failures.set(ip, list);
    else failures.delete(ip);
    return list;
  }

  function stats(): AdminStats {
    const t = now();
    const dayStart = Date.parse(`${jstDate(t)}T00:00:00+09:00`);
    const count = (sql: string, ...args: (number | string)[]) => (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
    return {
      users: count("SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL"),
      newUsersToday: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", dayStart),
      activeToday: count("SELECT COUNT(*) AS n FROM users WHERE last_login_at >= ? AND deleted_at IS NULL", dayStart),
      activeWeek: count("SELECT COUNT(*) AS n FROM users WHERE last_login_at >= ? AND deleted_at IS NULL", t - 7 * DAY_MS),
      rankedMatchesToday: count("SELECT COUNT(*) AS n FROM ranked_matches WHERE finished_at >= ?", dayStart),
      gachaRollsToday: count("SELECT COUNT(*) AS n FROM gacha_log WHERE created_at >= ? AND kind LIKE 'gacha-%'", dayStart),
      jadeGrantedToday: count("SELECT SUM(free_delta) AS n FROM jade_ledger WHERE created_at >= ? AND free_delta > 0", dayStart),
      jadeSpentToday: -count("SELECT SUM(free_delta + paid_delta) AS n FROM jade_ledger WHERE created_at >= ? AND free_delta + paid_delta < 0", dayStart),
      ...(options.liveStats?.() ?? { liveRooms: 0, liveMatches: 0 }),
    };
  }

  function findUsers(q: string): AdminUser[] {
    const key = q.trim();
    if (!key) return [];
    const rows = db
      .prepare(
        `SELECT id, display_name, created_at, last_login_at, deleted_at FROM users
         WHERE display_name LIKE '%' || ? || '%' OR (length(?) >= ? AND id LIKE lower(?) || '%') OR friend_code = ?
         ORDER BY last_login_at DESC LIMIT 50`,
      )
      .all(key, key, ACCOUNT_ID_PREFIX_LENGTH, key, key.replace(/\D/g, "")) as {
      id: string;
      display_name: string;
      created_at: number;
      last_login_at: number;
      deleted_at: number | null;
    }[];
    return rows.map((r) => {
      const rank = ranks.get(r.id);
      return {
        id: r.id,
        displayName: r.display_name,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        deleted: r.deleted_at !== null,
        rankLabel: rank.label,
        gamesPlayed: rank.gamesPlayed,
        jade: wallet.balance(r.id),
      };
    });
  }

  function resolveUser(idOrPrefix: string): string {
    const key = idOrPrefix.trim().toLowerCase();
    if (key.length < ACCOUNT_ID_PREFIX_LENGTH) throw new AdminInputError(`宛先のアカウントIDは先頭${ACCOUNT_ID_PREFIX_LENGTH}文字以上を入れてください`);
    const rows = db.prepare("SELECT id FROM users WHERE id LIKE ? || '%' AND deleted_at IS NULL LIMIT 2").all(key) as { id: string }[];
    if (rows.length !== 1) throw new AdminInputError(rows.length ? "複数のアカウントに当てはまります。もっと長く入れてください" : "宛先のアカウントが見つかりません");
    return rows[0]!.id;
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const nonNegInt = (v: unknown, label: string): number => {
    if (v === undefined || v === null || v === "") return 0;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new AdminInputError(`${label}は0以上の整数にしてください`);
    return n;
  };

  /** /api/admin 配下なら処理してtrue。subPathは "/admin/..." を除いた残り。 */
  return async (req: IncomingMessage, res: ServerResponse, subPath: string): Promise<boolean> => {
    if (!options.token) return fail(res, 404, "見つかりません"), true;
    const ip = options.clientIp(req);
    if (recentFailures(ip).length >= MAX_FAILURES_PER_HOUR) {
      return fail(res, 429, "失敗が多すぎます。1時間ほどしてからお試しください"), true;
    }
    const given = req.headers[ADMIN_TOKEN_HEADER];
    if (typeof given !== "string" || !sameToken(given, options.token)) {
      failures.set(ip, [...recentFailures(ip), now()]);
      return fail(res, 401, "管理用の合言葉が違います"), true;
    }
    const route = `${req.method} ${subPath}`;
    try {
      switch (route) {
        case "GET /stats":
          sendJson(res, 200, stats());
          return true;
        case "GET /news":
          sendJson(res, 200, inbox.allAnnouncements());
          return true;
        case "POST /news": {
          const body = (await options.readJson(req)) as { title?: unknown; body?: unknown; endsOn?: unknown };
          const endsOn = str(body.endsOn);
          inbox.postAnnouncement({ title: str(body.title), body: str(body.body), endsAt: endsOn ? endOfJstDay(endsOn) : null });
          sendJson(res, 200, inbox.allAnnouncements());
          return true;
        }
        case "POST /news/end": {
          const body = (await options.readJson(req)) as { id?: unknown };
          inbox.endAnnouncement(nonNegInt(body.id, "番号"));
          sendJson(res, 200, inbox.allAnnouncements());
          return true;
        }
        case "GET /gifts":
          sendJson(res, 200, inbox.allGifts());
          return true;
        case "POST /gifts": {
          const body = (await options.readJson(req)) as {
            title?: unknown;
            message?: unknown;
            jade?: unknown;
            characters?: unknown;
            cards?: unknown;
            to?: unknown;
            includeNewAccounts?: unknown;
            days?: unknown;
          };
          const ids = (v: unknown) =>
            str(v)
              .split(/[\s,、]+/)
              .map((x) => x.trim())
              .filter(Boolean);
          const items: GachaItem[] = [
            ...ids(body.characters).map((id) => ({ kind: "character" as const, id })),
            ...ids(body.cards).map((id) => ({ kind: "card" as const, id })),
          ];
          const to = str(body.to).trim();
          const days = body.days === 0 || body.days === "0" ? 0 : nonNegInt(body.days, "日数") || DEFAULT_GIFT_DAYS;
          inbox.sendGift({
            title: str(body.title),
            message: str(body.message),
            jade: nonNegInt(body.jade, "雀玉"),
            items,
            targetUserId: to ? resolveUser(to) : null,
            includeNewAccounts: !to && body.includeNewAccounts === true,
            // 日数0は無期限。
            expiresAt: days === 0 ? null : now() + days * DAY_MS,
          });
          sendJson(res, 200, inbox.allGifts());
          return true;
        }
        case "POST /gifts/cancel": {
          const body = (await options.readJson(req)) as { id?: unknown };
          inbox.cancelGift(nonNegInt(body.id, "番号"));
          sendJson(res, 200, inbox.allGifts());
          return true;
        }
        default:
          if (req.method === "GET" && subPath === "/users") {
            const q = new URL(req.url ?? "/", "http://localhost").searchParams.get("q") ?? "";
            sendJson(res, 200, findUsers(q));
            return true;
          }
          return fail(res, 404, "見つかりません"), true;
      }
    } catch (err) {
      if (err instanceof GiftError || err instanceof AdminInputError) return fail(res, 400, err.message), true;
      if ((err as Error).message?.startsWith("日付")) return fail(res, 400, (err as Error).message), true;
      throw err;
    }
  };
}
