/**
 * ネット対戦サーバー(packages/server)とのWebSocket接続。
 *
 * 待合室の様子はuseOnlineStoreに持ち、対局が始まってサーバーから画面の状態
 * (state)が届いたらgameStoreへ渡す（以後の画面描画はローカル対戦と同じ
 * コンポーネントがそのまま使う）。接続先は同じオリジンの /ws で、開発時は
 * Viteがサーバーへ中継する（vite.config.ts参照）。
 */
import { create } from "zustand";
import { ONLINE_WS_PATH, type ClientMessage, type LobbyMember, type ServerMessage } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { accountToken } from "./account.js";

export type OnlineStatus =
  /** 接続していない（タイトル・入室前） */
  | "idle"
  | "connecting"
  /** 待合室（対局開始待ち） */
  | "lobby"
  | "playing"
  /** 対局中に接続が切れた（同じアカウントで入り直せば席に戻れる） */
  | "disconnected";

export interface JoinRequest {
  room: string;
  characterId: string | null;
  cardId: string | null;
}

interface OnlineStoreState {
  status: OnlineStatus;
  room: string | null;
  members: LobbyMember[];
  /** 入室に失敗した等、画面に出すエラー。 */
  error: string | null;
}

export const useOnlineStore = create<OnlineStoreState>(() => ({
  status: "idle",
  room: null,
  members: [],
  error: null,
}));

let socket: WebSocket | null = null;
let lastJoin: JoinRequest | null = null;

function wsUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${ONLINE_WS_PATH}`;
}

function handleMessage(message: ServerMessage) {
  switch (message.t) {
    case "lobby":
      // 対局中に入り直したのに待合室が返ってきた＝サーバーの再起動等で対局が
      // 消えている。新しい待合室に入ったままにせず、抜けて知らせる。
      if (useGameStore.getState().online) {
        onlineLink.close();
        useOnlineStore.setState({ error: "対局が見つかりませんでした（サーバーが再起動された可能性があります）" });
        return;
      }
      useOnlineStore.setState({ status: "lobby", room: message.room, members: message.members, error: null });
      return;
    case "state":
      useOnlineStore.setState({ status: "playing", error: null });
      useGameStore.getState().applyOnlineView(message.view);
      return;
    case "error":
      if (message.fatal) {
        onlineLink.close();
        useOnlineStore.setState({ error: message.message });
      } else {
        // 対局中の操作が弾かれた（自動進行と操作が行き違った等）。画面は次に
        // 届く状態で正しく戻るため、ここでは記録だけにする。
        console.warn("[majyan-online]", message.message);
      }
      return;
  }
}

export const onlineLink = {
  /** サーバーにつないで合言葉の部屋に入る。 */
  join(request: JoinRequest) {
    onlineLink.close();
    lastJoin = request;
    useOnlineStore.setState({ status: "connecting", error: null, members: [], room: null });
    const ws = new WebSocket(wsUrl());
    socket = ws;
    ws.onopen = () => {
      // 名前はアカウントの表示名が使われ、対局中に入り直すと同じアカウントの席に戻れる。
      const message: ClientMessage = { t: "join", ...request, authToken: accountToken() ?? "" };
      ws.send(JSON.stringify(message));
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      try {
        handleMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch (err) {
        console.error("[majyan-online] サーバーからのメッセージを処理できませんでした:", err);
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      const { status } = useOnlineStore.getState();
      if (status === "playing") useOnlineStore.setState({ status: "disconnected" });
      else if (status !== "idle") {
        useOnlineStore.setState({
          status: "idle",
          error: status === "connecting" ? "サーバーにつながりませんでした（サーバーが起動しているか確認してください）" : "サーバーとの接続が切れました",
        });
      }
    };
  },

  /** 対局中に切れた接続を、同じ合言葉・同じアカウントで入り直して席に戻す。 */
  rejoin() {
    if (lastJoin) onlineLink.join(lastJoin);
  },

  send(message: ClientMessage) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  },

  /** 部屋を抜けて接続を閉じる（タイトルへ戻る時）。 */
  close() {
    const ws = socket;
    socket = null;
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "leave" } satisfies ClientMessage));
      ws.close();
    }
    useOnlineStore.setState({ status: "idle", room: null, members: [] });
  },
};
