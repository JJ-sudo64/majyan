/**
 * ネット対戦サーバーの起動口。WebSocketの接続をRoomManagerへつなぐだけで、
 * 部屋・対局の中身はrooms.ts/matchSession.tsが扱う。
 *
 *   npm run dev:server   （リポジトリ直下で。ポートは環境変数PORT、既定8787）
 *
 * 開発時はVite(5173)が /ws をこのサーバーへ中継するので、画面からは同じ
 * オリジンの /ws へつなげばよい（packages/web/vite.config.ts参照）。
 */
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { ONLINE_DEFAULT_PORT, ONLINE_WS_PATH, type ClientMessage, type ServerMessage } from "@majyan/core";
import { RoomManager, type Client } from "./rooms.js";

/** 1メッセージの上限。操作のJSONは数百バイトなので十分大きめ。 */
const MAX_MESSAGE_BYTES = 16 * 1024;

const port = Number(process.env.PORT) || ONLINE_DEFAULT_PORT;
const rooms = new RoomManager();
const wss = new WebSocketServer({ port, path: ONLINE_WS_PATH, maxPayload: MAX_MESSAGE_BYTES });

wss.on("connection", (socket: WebSocket) => {
  const client: Client = {
    id: randomUUID(),
    send(message: ServerMessage) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  };
  socket.on("message", (data) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      client.send({ t: "error", message: "不正なメッセージです" });
      return;
    }
    if (!message || typeof message !== "object" || typeof message.t !== "string") return;
    try {
      rooms.handleMessage(client, message);
    } catch (err) {
      // 1人の変な入力でサーバー全体（他の卓）が落ちないようにする。
      console.error("[majyan-server] メッセージの処理に失敗しました:", err);
      client.send({ t: "error", message: "サーバーでエラーが起きました" });
    }
  });
  socket.on("close", () => rooms.disconnect(client));
});

wss.on("listening", () => {
  console.log(`[majyan-server] ws://localhost:${port}${ONLINE_WS_PATH} で待ち受け中`);
});
