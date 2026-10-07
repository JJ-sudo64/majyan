/**
 * アカウント等のHTTP API（/api 配下）。パスと返す形はcoreのonlineProtocol.ts参照。
 * 対局中のやり取りはWebSocket(index.ts / rooms.ts)で、ここは対局の外の操作だけ。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ACCOUNT_DELETE_CONFIRM,
  ONLINE_API_PREFIX,
  type AccountProfile,
  type ApiErrorResponse,
  type GachaRollResponse,
  type GiftClaimResponse,
  type FriendsResponse,
  type MissionClaimResponse,
  type MissionsResponse,
  type InboxResponse,
  type GuestAccountResponse,
  type MeResponse,
  type RankedHistoryResponse,
  type RecordsResponse,
  type RankingResponse,
  type TransferCodeResponse,
} from "@majyan/core";
import { normalizeDisplayName, transferPasswordProblem, type AccountService } from "./accounts.js";
import type { RankService } from "./ranks.js";
import { GachaError, type CollectionService } from "./collection.js";
import { InsufficientJadeError, type WalletService } from "./wallet.js";
import { GiftError, type InboxService } from "./inbox.js";
import { MissionError, type MissionService } from "./missions.js";
import { FriendError, type FriendService } from "./friends.js";
import type { ReplayStore } from "./replays.js";
import { createAdminHandler, type AdminApiOptions } from "./adminApi.js";

const MAX_BODY_BYTES = 4 * 1024;

export interface HttpApiOptions {
  accounts: AccountService;
  ranks: RankService;
  collections: CollectionService;
  wallet: WalletService;
  /** お知らせ・プレゼントボックス。無ければその機能のAPIは404。 */
  inbox?: InboxService;
  /** デイリーミッション。無ければその機能のAPIは404。 */
  missions?: MissionService;
  /** フレンド。無ければその機能のAPIは404。 */
  friends?: FriendService;
  /** 段位戦の牌譜。無ければその機能のAPIは404。 */
  replays?: ReplayStore;
  /** 運営用API（/api/admin/...）。tokenが空なら無効。 */
  admin?: Omit<AdminApiOptions, "readJson" | "sendJson" | "clientIp">;
  /** ゲストアカウントを作れる回数（同じ接続元から、1時間あたり）。大量作成の嫌がらせ対策。 */
  guestsPerHourPerIp?: number;
  /** 引き継ぎコードでの入室に失敗できる回数（同じ接続元から、1時間あたり）。パスワードの総当たり対策。 */
  transferFailuresPerHourPerIp?: number;
  /** 開発用の操作（/api/dev/...）を受け付けるか。本番では必ずfalse。 */
  devTools?: boolean;
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
  const { accounts, ranks, collections, wallet, inbox, missions, friends, replays } = options;
  const me = (profile: AccountProfile, dailyBonus: number | null = null): MeResponse => ({
    profile,
    rank: ranks.get(profile.id),
    jade: wallet.balance(profile.id),
    dailyBonus,
    units: collections.units(profile.id),
    cards: collections.cards(profile.id),
    exchangePoints: collections.exchangePoints(profile.id),
    firstGacha: collections.firstGachaState(profile.id),
    unclaimedGifts: inbox?.unclaimedCount(profile.id) ?? 0,
    latestAnnouncementId: inbox?.latestAnnouncementId() ?? null,
    claimableMissions: missions?.claimableCount(profile.id) ?? 0,
    incomingFriendRequests: friends?.incomingCount(profile.id) ?? 0,
  });
  const now = options.now ?? Date.now;
  const limit = options.guestsPerHourPerIp ?? 20;
  const guestCreations = new Map<string, number[]>();

  const transferFailureLimit = options.transferFailuresPerHourPerIp ?? 10;
  const transferFailures = new Map<string, number[]>();

  /** 直近1時間のうちに記録した回数がlimit未満か。recordならこの回も数える。 */
  function underHourlyLimit(log: Map<string, number[]>, ip: string, max: number, record: boolean): boolean {
    const t = now();
    const recent = (log.get(ip) ?? []).filter((x) => t - x < 60 * 60_000);
    const allowed = recent.length < max;
    if (allowed && record) recent.push(t);
    if (recent.length) log.set(ip, recent);
    else log.delete(ip);
    return allowed;
  }

  const allowGuestCreation = (ip: string) => underHourlyLimit(guestCreations, ip, limit, true);
  const clientIp = (req: IncomingMessage) => (options.clientIp ? options.clientIp(req) : (req.socket.remoteAddress ?? "unknown"));

  function authed(req: IncomingMessage, res: ServerResponse): AccountProfile | null {
    const profile = accounts.authenticate(bearerToken(req));
    if (!profile) fail(res, 401, "ログインし直してください");
    return profile;
  }

  const handleAdmin = options.admin ? createAdminHandler({ ...options.admin, readJson, sendJson, clientIp }) : null;

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== ONLINE_API_PREFIX && !path.startsWith(`${ONLINE_API_PREFIX}/`)) return false;
    const route = `${req.method} ${path.slice(ONLINE_API_PREFIX.length)}`;
    try {
      const sub = path.slice(ONLINE_API_PREFIX.length);
      if (sub === "/admin" || sub.startsWith("/admin/")) {
        if (!handleAdmin) return fail(res, 404, "見つかりません"), true;
        return await handleAdmin(req, res, sub.slice("/admin".length));
      }
      if (req.method === "GET" && route.startsWith("GET /replays/")) {
        const matchId = decodeURIComponent(route.slice("GET /replays/".length));
        const profile = authed(req, res);
        if (!profile) return true;
        const replay = replays && /^[\w-]{1,64}$/.test(matchId) ? replays.load(matchId, profile.id) : null;
        if (!replay) return fail(res, 404, "牌譜が見つかりません"), true;
        sendJson(res, 200, replay);
        return true;
      }
      switch (route) {
        case "POST /guest": {
          const body = (await readJson(req)) as { displayName?: unknown };
          const name = normalizeDisplayName(body.displayName);
          if (!name) return fail(res, 400, "名前を入力してください"), true;
          if (!allowGuestCreation(clientIp(req))) {
            return fail(res, 429, "アカウントの作成が多すぎます。しばらくしてからお試しください"), true;
          }
          const { profile, token } = accounts.createGuest(name);
          sendJson(res, 200, { token, profile } satisfies GuestAccountResponse);
          return true;
        }
        case "GET /me": {
          const profile = authed(req, res);
          // 画面を開いた時に読むので、ここで今日のログインボーナスを渡す。
          if (profile) sendJson(res, 200, me(profile, wallet.claimDailyLogin(profile.id)));
          return true;
        }
        case "POST /me/name": {
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { displayName?: unknown };
          const name = normalizeDisplayName(body.displayName);
          if (!name) return fail(res, 400, "名前を入力してください"), true;
          sendJson(res, 200, me(accounts.rename(profile.id, name)));
          return true;
        }
        case "GET /me/history": {
          const profile = authed(req, res);
          if (profile) sendJson(res, 200, ranks.history(profile.id) satisfies RankedHistoryResponse);
          return true;
        }
        case "GET /me/records": {
          const profile = authed(req, res);
          if (profile) {
            sendJson(res, 200, { jade: wallet.history(profile.id), gacha: collections.gachaHistory(profile.id) } satisfies RecordsResponse);
          }
          return true;
        }
        case "GET /friends":
        case "POST /friends/request":
        case "POST /friends/respond":
        case "POST /friends/remove": {
          if (!friends) return fail(res, 404, "見つかりません"), true;
          const profile = authed(req, res);
          if (!profile) return true;
          if (req.method === "POST") {
            const body = (await readJson(req)) as { code?: unknown; accept?: unknown };
            try {
              if (route.endsWith("request")) friends.request(profile.id, body.code);
              else if (route.endsWith("respond")) friends.respond(profile.id, body.code, body.accept === true);
              else friends.remove(profile.id, body.code);
            } catch (err) {
              if (err instanceof FriendError) return fail(res, 409, err.message), true;
              throw err;
            }
          }
          sendJson(res, 200, friends.list(profile.id) satisfies FriendsResponse);
          return true;
        }
        case "GET /missions": {
          if (!missions) return fail(res, 404, "見つかりません"), true;
          const profile = authed(req, res);
          if (profile) sendJson(res, 200, { missions: missions.list(profile.id), resetsAt: missions.resetsAt() } satisfies MissionsResponse);
          return true;
        }
        case "POST /missions/claim": {
          if (!missions) return fail(res, 404, "見つかりません"), true;
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { missionId?: unknown };
          const missionId = body.missionId ?? null;
          if (missionId !== null && typeof missionId !== "string") return fail(res, 400, "ミッションが正しくありません"), true;
          let jade;
          try {
            jade = missions.claim(profile.id, missionId);
          } catch (err) {
            if (err instanceof MissionError) return fail(res, 409, err.message), true;
            throw err;
          }
          sendJson(res, 200, { jade, missions: missions.list(profile.id), me: me(profile) } satisfies MissionClaimResponse);
          return true;
        }
        case "GET /inbox": {
          if (!inbox) return fail(res, 404, "見つかりません"), true;
          const profile = authed(req, res);
          if (profile) {
            sendJson(res, 200, { announcements: inbox.announcements(), gifts: inbox.claimable(profile.id) } satisfies InboxResponse);
          }
          return true;
        }
        case "POST /gifts/claim": {
          if (!inbox) return fail(res, 404, "見つかりません"), true;
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { giftId?: unknown };
          const giftId = body.giftId ?? null;
          if (giftId !== null && !Number.isSafeInteger(giftId)) return fail(res, 400, "プレゼントが正しくありません"), true;
          let claimed;
          try {
            claimed = inbox.claim(profile.id, giftId as number | null);
          } catch (err) {
            if (err instanceof GiftError) return fail(res, 409, err.message), true;
            throw err;
          }
          sendJson(res, 200, { ...claimed, me: me(profile) } satisfies GiftClaimResponse);
          return true;
        }
        case "POST /me/delete": {
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { confirm?: unknown };
          // 押し間違いで消えないよう、画面で確認の言葉を打ってもらう。
          if (body.confirm !== ACCOUNT_DELETE_CONFIRM) return fail(res, 400, `確認のため「${ACCOUNT_DELETE_CONFIRM}」と入力してください`), true;
          accounts.deleteAccount(profile.id);
          sendJson(res, 200, {});
          return true;
        }
        case "GET /ranking": {
          const profile = authed(req, res);
          if (profile) sendJson(res, 200, ranks.ranking(profile.id) satisfies RankingResponse);
          return true;
        }
        case "GET /me/transfer": {
          const profile = authed(req, res);
          if (profile) sendJson(res, 200, { code: accounts.transferCode(profile.id) } satisfies TransferCodeResponse);
          return true;
        }
        case "POST /me/transfer": {
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { password?: unknown };
          const problem = transferPasswordProblem(body.password);
          if (problem) return fail(res, 400, problem), true;
          const code = accounts.setTransferPassword(profile.id, body.password as string);
          sendJson(res, 200, { code } satisfies TransferCodeResponse);
          return true;
        }
        case "POST /transfer": {
          const ip = clientIp(req);
          if (!underHourlyLimit(transferFailures, ip, transferFailureLimit, false)) {
            return fail(res, 429, "引き継ぎの失敗が多すぎます。1時間ほどしてからお試しください"), true;
          }
          const body = (await readJson(req)) as { code?: unknown; password?: unknown };
          const login = accounts.loginWithTransfer(body.code, body.password);
          if (!login) {
            underHourlyLimit(transferFailures, ip, transferFailureLimit, true);
            return fail(res, 401, "引き継ぎコードかパスワードが違います"), true;
          }
          sendJson(res, 200, login satisfies GuestAccountResponse);
          return true;
        }
        case "POST /gacha/roll": {
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { count?: unknown };
          if (body.count !== 1 && body.count !== 10) return fail(res, 400, "回数が正しくありません"), true;
          if (!collections.firstGachaState(profile.id).confirmed) return fail(res, 409, "先に最初の10連を受け取ってください"), true;
          let rolled;
          try {
            rolled = collections.rollGacha(profile.id, body.count, wallet);
          } catch (err) {
            if (err instanceof InsufficientJadeError) return fail(res, 409, err.message), true;
            throw err;
          }
          sendJson(res, 200, { ...rolled, me: me(profile) } satisfies GachaRollResponse);
          return true;
        }
        case "POST /gacha/exchange": {
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { item?: { kind?: unknown; id?: unknown } };
          const item = body.item;
          if (!item || (item.kind !== "character" && item.kind !== "card") || typeof item.id !== "string") {
            return fail(res, 400, "交換するものを選んでください"), true;
          }
          let exchanged;
          try {
            exchanged = collections.exchange(profile.id, { kind: item.kind, id: item.id });
          } catch (err) {
            if (err instanceof GachaError) return fail(res, 409, err.message), true;
            throw err;
          }
          sendJson(res, 200, { ...exchanged, me: me(profile) } satisfies GachaRollResponse);
          return true;
        }
        case "POST /units/equip": {
          const profile = authed(req, res);
          if (!profile) return true;
          const body = (await readJson(req)) as { unitId?: unknown; cardId?: unknown };
          if (typeof body.unitId !== "string" || typeof body.cardId !== "string") return fail(res, 400, "キャラとカードを選んでください"), true;
          try {
            collections.equipCard(profile.id, body.unitId, body.cardId);
          } catch (err) {
            if (err instanceof GachaError) return fail(res, 409, err.message), true;
            throw err;
          }
          sendJson(res, 200, me(profile));
          return true;
        }
        case "POST /dev/reset-collection": {
          if (!options.devTools) return fail(res, 404, "見つかりません"), true;
          const profile = authed(req, res);
          if (!profile) return true;
          collections.resetForTesting(profile.id);
          sendJson(res, 200, me(profile));
          return true;
        }
        case "POST /first-gacha/roll":
        case "POST /first-gacha/confirm": {
          const profile = authed(req, res);
          if (!profile) return true;
          try {
            if (route.endsWith("roll")) collections.rollFirstGacha(profile.id);
            else collections.confirmFirstGacha(profile.id);
          } catch (err) {
            if (err instanceof GachaError) return fail(res, 409, err.message), true;
            throw err;
          }
          sendJson(res, 200, me(profile));
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
