/**
 * アカウント等のHTTP API（/api 配下）。パスと返す形はcoreのonlineProtocol.ts参照。
 * 対局中のやり取りはWebSocket(index.ts / rooms.ts)で、ここは対局の外の操作だけ。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ONLINE_API_PREFIX,
  type AccountProfile,
  type ApiErrorResponse,
  type GuestAccountResponse,
  type MeResponse,
} from "@majyan/core";
import { normalizeDisplayName, type AccountService } from "./accounts.js";
import type { RankService } from "./ranks.js";

const MAX_BODY_BYTES = 4 * 1024;

export interface HttpApiOptions {
  accounts: AccountService;
  ranks: RankService;
  /** ゲストアカウントを作れる回数（同じ接続元から、1時間あたり）。大量作成の嫌がらせ対策。 */
  guestsPerHourPerIp?: number;
  /** 接続元の見分け方（リバースプロキシの後ろではX-Forwarded-Forを見る等）。 */
  clientIp?: (req: IncomingMessage) => string;
  now?: () => number;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
  });
  res.end(json);
}

const fail = (res: ServerResponse, status: number, error: string) => sendJson(res, status, { error } satisfies ApiErrorResponse);

class BodyTooLargeError extends Error {}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    // 上限を超えても接続は切らずに読み捨てる（途中で切ると返事を返せないため）。
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError());
        return;
      }
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}

/** /api 配下なら処理してtrueを返す。それ以外のパスはfalse（呼び出し側が静的ファイル等を返す）。 */
export function createApiHandler(options: HttpApiOptions) {
  const { accounts, ranks } = options;
  const now = options.now ?? Date.now;
  const limit = options.guestsPerHourPerIp ?? 20;
  const guestCreations = new Map<string, number[]>();

  function allowGuestCreation(ip: string): boolean {
    const t = now();
    const recent = (guestCreations.get(ip) ?? []).filter((x) => t - x < 60 * 60_000);
    if (recent.length >= limit) {
      guestCreations.set(ip, recent);
      return false;
    }
    recent.push(t);
    guestCreations.set(ip, recent);
    return true;
  }

  function authed(req: IncomingMessage, res: ServerResponse): AccountProfile | null {
    const profile = accounts.authenticate(bearerToken(req));
    if (!profile) fail(res, 401, "ログインし直してください");
    return profile;
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== ONLINE_API_PREFIX && !path.startsWith(`${ONLINE_API_PREFIX}/`)) return false;
    const route = `${req.method} ${path.slice(ONLINE_API_PREFIX.length)}`;
    try {
      switch (route) {
        case "POST /guest": {
          const body = (await readJson(req)) as { displayName?: unknown };
          const name = normalizeDisplayName(body.displayName);
          if (!name) return fail(res, 400, "名前を入力してください"), true;
          const ip = options.clientIp ? options.clientIp(req) : (req.socket.remoteAddress ?? "unknown");
          if (!allowGuestCreation(ip)) {
            return fail(res, 429, "アカウントの作成が多すぎます。しばらくしてからお試しください"), true;
          }
          const { profile, token } = accounts.createGuest(name);
          sendJson(res, 200, { token, profile } satisfies GuestAccountResponse);
          return true;
        }
        case "GET /me": {
          const profile = authed(req, res);
          if (profile) sendJson(res, 200, { profile, rank: ranks.get(profile.id) } satisfies MeResponse);
          return true;
        }
        case "POST /me/name": {
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { displayName?: unknown };
          const name = normalizeDisplayName(body.displayName);
          if (!name) return fail(res, 400, "名前を入力してください"), true;
          sendJson(res, 200, { profile: accounts.rename(profile.id, name), rank: ranks.get(profile.id) } satisfies MeResponse);
          return true;
        }
        default:
          fail(res, 404, "見つかりません");
          return true;
      }
    } catch (err) {
      if (!res.headersSent) {
        if (err instanceof BodyTooLargeError) fail(res, 413, "リクエストが大きすぎます");
        else fail(res, 400, "リクエストが正しくありません");
      }
      if (!(err instanceof SyntaxError) && !(err instanceof BodyTooLargeError)) {
        console.error("[majyan-server] APIの処理に失敗しました:", err);
      }
      return true;
    }
  };
}
