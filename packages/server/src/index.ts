/**
 * ネット対戦サーバーの起動口。WebSocketの接続をRoomManagerへつなぐだけで、
 * 部屋・対局の中身はrooms.ts/matchSession.tsが扱う。
 *
 *   npm run dev:server   開発用（リポジトリ直下で。画面はVite(5173)が配り、/wsを中継する）
 *   npm start            本番用（画面をビルドして、このサーバーが画面と/wsの両方を配る）
 *
 * 環境変数:
 *   PORT              待ち受けポート（既定8787）
 *   STATIC_DIR        配る画面のビルド結果（既定 packages/web/dist。無ければ/wsだけ）
 *   ALLOWED_ORIGINS   WebSocketの接続を許すページのオリジン（カンマ区切り）。
 *                     未指定ならチェックしない。公開する時は自分のURLを入れる。
 *   DATABASE_PATH     アカウント等を保存するSQLiteファイル（既定 packages/server/data/majyan.db）
 *   TRUST_PROXY       "1"ならX-Forwarded-Forを接続元として信用する（リバースプロキシの後ろに置く時）
 *   RANKED_CPU_FILL_MS 段位戦で人がそろわない時、空席をCPUで埋めるまでの待ち時間（既定20秒）
 *   BACKUP_DIR        DBの定期バックアップの置き場所（既定 DBと同じ場所の backups/）
 *   BACKUP_INTERVAL_HOURS バックアップの間隔（既定6時間。0なら取らない）
 *   BACKUP_KEEP       残すバックアップの数（既定28＝6時間おきで1週間分）
 *   ADMIN_TOKEN       管理画面（/?admin）と運営用API（/api/admin）の合言葉。未設定なら管理画面は使えない。
 *                     推測されない長い文字列にする（例: node -e "console.log(crypto.randomBytes(24).toString('base64url'))"）
 *
 * 引数 --dev-tools（npm run dev:server が付ける）: 開発用の操作（最初の10連のやり直し等）を
 * 受け付け、アカウント作成の回数制限をゆるめる。npm start（本番）では付けない。
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { ONLINE_DEFAULT_PORT, ONLINE_WS_PATH, type ServerMessage } from "@majyan/core";
import { RoomManager, type Client } from "./rooms.js";
import { AccountService } from "./accounts.js";
import { openDatabase } from "./db.js";
import { createApiHandler } from "./httpApi.js";
import { RankService } from "./ranks.js";
import { CollectionService } from "./collection.js";
import { WalletService } from "./wallet.js";
import { InboxService } from "./inbox.js";
import { MissionService } from "./missions.js";
import { FriendService } from "./friends.js";
import { ReplayStore } from "./replays.js";
import { CpuPool } from "./cpuPool.js";
import { scheduleBackups } from "./backup.js";
import { MatchStore } from "./matchStore.js";
import { DEFAULT_CPU_FILL_MS, Matchmaker } from "./matchmaking.js";
import type { IncomingMessage } from "node:http";
import { createStaticHandler } from "./staticFiles.js";
import { parseClientMessage } from "./validate.js";

/** 1メッセージの上限。操作のJSONは数百バイトなので十分大きめ。 */
const MAX_MESSAGE_BYTES = 16 * 1024;
/** 応答の無い接続（回線が切れたのにTCPが閉じていない等）を見つける間隔。
    見つけたら切断扱いにし、その席は自動操作に切り替わる。 */
const HEARTBEAT_MS = 15_000;
/** 1接続あたりのメッセージ数の上限（連打・嫌がらせ対策）。人間の操作なら
    1秒に数回が精々なので、超えたら接続を切る。 */
const RATE_LIMIT = { perSecond: 10, burst: 30 };

const port = Number(process.env.PORT) || ONLINE_DEFAULT_PORT;
const staticDir = process.env.STATIC_DIR ?? resolve(import.meta.dirname, "../../web/dist");
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

const databasePath = process.env.DATABASE_PATH ?? resolve(import.meta.dirname, "../data/majyan.db");
const trustProxy = process.env.TRUST_PROXY === "1";
const clientIp = (req: IncomingMessage) =>
  (trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "") || req.socket.remoteAddress || "unknown";

const db = openDatabase(databasePath);
const backupHours = process.env.BACKUP_INTERVAL_HOURS === undefined ? 6 : Number(process.env.BACKUP_INTERVAL_HOURS);
const backupDir = process.env.BACKUP_DIR ?? resolve(dirname(databasePath), "backups");
const stopBackups =
  backupHours > 0
    ? scheduleBackups(db, { dir: backupDir, keep: Number(process.env.BACKUP_KEEP) || 28, intervalMs: backupHours * 60 * 60_000 })
    : () => {};
const accounts = new AccountService(db);
const ranks = new RankService(db);
const wallet = new WalletService(db);
const collections = new CollectionService(db, Math.random, Date.now, wallet);
const inbox = new InboxService(db, collections, wallet);
const missions = new MissionService(db, wallet);
const authenticate = (token: string) => accounts.authenticate(token);
// 対局中の卓はDBへ保存しておき、再起動したら続きから再開する（入り直せば同じ席に戻れる）。
const replays = new ReplayStore(db);
// フレンド（観戦の可否）はroomsの「今どこにいるか」を使い、roomsは観戦の可否にフレンドを使うので、後から結ぶ。
let friends: FriendService | undefined;
// CPUの思考は別スレッドで（重い局面で全部の卓が止まらないように）。
const cpuPool = new CpuPool();
const rooms = new RoomManager({
  decideCpu: (kind, round, seat, difficulty) => cpuPool.decide(kind, round, seat, difficulty),
  authenticate,
  ranks,
  collections,
  wallet,
  store: new MatchStore(db),
  replays,
  resolveSpectateTarget: (viewerId, code) => friends?.friendIdByCode(viewerId, code) ?? null,
});
const restoredMatches = rooms.restoreSavedMatches();
friends = new FriendService(db, { ranks, presenceOf: (userId) => rooms.presenceOf(userId) });
const matchmaker = new Matchmaker({
  rooms,
  ranks,
  authenticate,
  cpuFillMs: Number(process.env.RANKED_CPU_FILL_MS) || DEFAULT_CPU_FILL_MS,
});
const devTools = process.argv.includes("--dev-tools");
if (devTools) console.log("[majyan-server] 開発用の操作を有効にしています（--dev-tools）");
const handleApi = createApiHandler({
  accounts,
  ranks,
  collections,
  wallet,
  inbox,
  missions,
  friends,
  replays,
  admin: {
    db,
    inbox,
    ranks,
    wallet,
    token: process.env.ADMIN_TOKEN || undefined,
    liveStats: () => rooms.liveStats(),
  },
  clientIp,
  devTools,
  // 開発中は「新しいアカウントで始める」で何度も作り直すため、制限をゆるめる。
  ...(devTools ? { guestsPerHourPerIp: 1000 } : {}),
});
const serveStatic = createStaticHandler(staticDir);
const httpServer = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (await handleApi(req, res)) return;
  if (serveStatic) serveStatic(req, res);
  else res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("画面は開発サーバー(Vite)から開いてください");
});

const wss = new WebSocketServer({
  server: httpServer,
  path: ONLINE_WS_PATH,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: ({ origin }: { origin: string }) => !allowedOrigins || allowedOrigins.includes(origin),
});

const alive = new WeakMap<WebSocket, boolean>();

wss.on("connection", (socket: WebSocket) => {
  const client: Client = {
    id: randomUUID(),
    send(message: ServerMessage) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  };
  alive.set(socket, true);
  socket.on("pong", () => alive.set(socket, true));

  let tokens = RATE_LIMIT.burst;
  let lastRefill = Date.now();

  socket.on("message", (data) => {
    const now = Date.now();
    tokens = Math.min(RATE_LIMIT.burst, tokens + ((now - lastRefill) / 1000) * RATE_LIMIT.perSecond);
    lastRefill = now;
    if (tokens < 1) {
      client.send({ t: "error", message: "操作が多すぎるため接続を切りました", fatal: true });
      socket.close(1008, "rate limit");
      return;
    }
    tokens -= 1;

    const message = parseClientMessage(data.toString());
    if (!message) {
      client.send({ t: "error", message: "不正なメッセージです" });
      return;
    }
    try {
      if (message.t === "queueRanked" || message.t === "cancelQueue") matchmaker.handleMessage(client, message);
      else rooms.handleMessage(client, message);
    } catch (err) {
      // 1人の変な入力でサーバー全体（他の卓）が落ちないようにする。
      console.error("[majyan-server] メッセージの処理に失敗しました:", err);
      client.send({ t: "error", message: "サーバーでエラーが起きました" });
    }
  });
  socket.on("close", () => {
    matchmaker.remove(client);
    rooms.disconnect(client);
  });
  socket.on("error", () => socket.terminate());
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!alive.get(socket)) {
      socket.terminate(); // closeイベント経由で切断扱いになる
      continue;
    }
    alive.set(socket, false);
    socket.ping();
  }
}, HEARTBEAT_MS);
wss.on("close", () => clearInterval(heartbeat));

httpServer.listen(port, () => {
  console.log(`[majyan-server] http://localhost:${port} で待ち受け中（WebSocket: ${ONLINE_WS_PATH}）`);
  console.log(serveStatic ? `[majyan-server] 画面を配信: ${staticDir}` : "[majyan-server] 画面のビルドが無いため /api と /ws だけ提供します");
  console.log(`[majyan-server] データベース: ${databasePath}`);
  if (restoredMatches > 0) console.log(`[majyan-server] 保存されていた対局を${restoredMatches}卓再開しました`);
});

// 止める時（Ctrl+C・コンテナの停止）は受け付けをやめてからDBを閉じる。対局は局面が進むたびに
// 保存済みなので、次に起動すれば続きから再開できる。
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[majyan-server] ${signal} を受けたので止めます`);
  stopBackups();
  void cpuPool.close();
  matchmaker.dispose();
  for (const socket of wss.clients) socket.terminate();
  wss.close();
  httpServer.close();
  try {
    db.close();
  } catch (err) {
    console.error("[majyan-server] DBを閉じられませんでした:", err);
  }
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
