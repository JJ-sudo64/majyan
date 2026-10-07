/**
 * ネット対戦サーバー(packages/server)とのWebSocket接続。
 *
 * 待合室・段位戦の待ち行列の様子はuseOnlineStoreに持ち、対局が始まってサーバー
 * から画面の状態(state)が届いたらgameStoreへ渡す（以後の画面描画はローカル対戦と
 * 同じコンポーネントがそのまま使う）。接続先は同じオリジンの /ws で、開発時は
 * Viteがサーバーへ中継する（vite.config.ts参照）。
 */
import { create } from "zustand";
import {
  ONLINE_WS_PATH,
  type ClientMessage,
  type LobbyMember,
  type MatchFormat,
  type RankResult,
  type ServerMessage,
} from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { accountToken, loadAccount } from "./account.js";

export type OnlineStatus =
  /** 接続していない（タイトル・入室前） */
  | "idle"
  | "connecting"
  /** 友人戦の待合室（対局開始待ち） */
  | "lobby"
  /** 段位戦の待ち行列に並んでいる */
  | "queued"
  | "playing"
  /** 対局中に接続が切れた（同じアカウントで入り直せば席に戻れる） */
  | "disconnected";

export interface JoinRequest {
  room: string;
  /** 対局に出す手持ちのキャラ（付いているカードごと出る）。null=おまかせ。 */
  unitId: string | null;
}

interface OnlineStoreState {
  status: OnlineStatus;
  room: string | null;
  members: LobbyMember[];
  /** 入室に失敗した等、画面に出すエラー。 */
  error: string | null;
  /** 段位戦に並んでいる間の情報（並び始めた時刻はperformance.now()基準）。 */
  queue: { format: MatchFormat; since: number; cpuFillInMs: number } | null;
  /** 今の対局が段位戦か。 */
  ranked: boolean;
  /** 直前の段位戦で段位がどう変わったか（結果画面用）。 */
  rankResult: RankResult | null;
  /** 対局中に切れて、自動で入り直そうとしている（次の試みを待っている間も含む）。 */
  autoRejoining: boolean;
}

export const useOnlineStore = create<OnlineStoreState>(() => ({
  status: "idle",
  room: null,
  members: [],
  error: null,
  queue: null,
  ranked: false,
  rankResult: null,
  autoRejoining: false,
}));

let socket: WebSocket | null = null;
/** 対局中に切れた時に入り直す先（友人戦の合言葉、または段位戦の卓の合言葉）。 */
let lastJoin: JoinRequest | null = null;

/**
 * 対局中に接続が切れたら、この間隔で自動的に入り直しを試みる（合計約1分。サーバーの
 * 再起動中も、サーバーは対局を保存しておいて再開後しばらく戻りを待つため）。
 * 使い切ったら「入り直す」ボタンで手動で試してもらう。
 */
const AUTO_REJOIN_DELAYS_MS = [500, 1000, 2000, 3000, 5000, 5000, 10_000, 10_000, 15_000, 15_000];
let autoRejoinAttempt = 0;
let autoRejoinTimer: ReturnType<typeof setTimeout> | null = null;
/** 今の接続が、対局へ入り直すためのものか（つながらなかった時に次を試すため）。 */
let rejoinConnection = false;

function stopAutoRejoin() {
  if (autoRejoinTimer) clearTimeout(autoRejoinTimer);
  autoRejoinTimer = null;
  autoRejoinAttempt = 0;
  useOnlineStore.setState({ autoRejoining: false });
}

function scheduleAutoRejoin() {
  if (autoRejoinTimer) clearTimeout(autoRejoinTimer);
  autoRejoinTimer = null;
  const delay = AUTO_REJOIN_DELAYS_MS[autoRejoinAttempt];
  if (delay === undefined || !lastJoin?.room) {
    useOnlineStore.setState({ autoRejoining: false });
    return;
  }
  autoRejoinAttempt++;
  useOnlineStore.setState({ autoRejoining: true });
  autoRejoinTimer = setTimeout(() => {
    autoRejoinTimer = null;
    if (useOnlineStore.getState().status === "disconnected") rejoinNow();
  }, delay);
}

function rejoinNow() {
  if (!lastJoin?.room) return;
  connect({ t: "join", ...lastJoin, authToken: accountToken() ?? "" });
  rejoinConnection = true;
}

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
    case "queued":
      useOnlineStore.setState({
        status: "queued",
        error: null,
        queue: { format: message.format, since: performance.now(), cpuFillInMs: message.cpuFillInMs },
      });
      return;
    case "queueCancelled":
      onlineLink.close();
      return;
    case "matchFound":
      // 卓が決まった。新しい卓ならサーバーがそのまま状態を送ってくるが、途中で
      // 抜けていた段位戦へ戻る場合は自分で卓に入る必要があるので、常にjoinを送る
      // （既に座っている卓へのjoinは何も変えない）。合言葉は入り直し用に覚えておく。
      lastJoin = { room: message.room, unitId: lastJoin?.unitId ?? null };
      useOnlineStore.setState({ queue: null, ranked: true, rankResult: null, room: message.room });
      onlineLink.send({ t: "join", ...lastJoin, authToken: accountToken() ?? "" });
      return;
    case "rankResult":
      useOnlineStore.setState({ rankResult: message.result });
      void loadAccount();
      return;
    case "state":
      if (rejoinConnection || autoRejoinAttempt > 0) stopAutoRejoin();
      rejoinConnection = false;
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

/** 新しく接続し、つながったらfirstを送る。 */
function connect(first: ClientMessage) {
  closeSocket();
  rejoinConnection = false;
  useOnlineStore.setState({ status: "connecting", error: null, members: [], room: null });
  const ws = new WebSocket(wsUrl());
  socket = ws;
  ws.onopen = () => ws.send(JSON.stringify(first));
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
    // 観戦は入り直す席が無いので、切れたら観戦を終えて元の画面に戻る。
    if (useGameStore.getState().spectating) {
      useOnlineStore.setState({ status: "idle", error: "観戦の接続が切れました" });
      useGameStore.getState().backToTitle();
      return;
    }
    if (status === "playing") {
      useOnlineStore.setState({ status: "disconnected" });
      scheduleAutoRejoin();
    } else if (status === "connecting" && rejoinConnection) {
      // 入り直そうとしたがつながらなかった（サーバーの再起動中等）。少し待って次を試す。
      useOnlineStore.setState({ status: "disconnected", error: "サーバーにつながりませんでした" });
      scheduleAutoRejoin();
    } else if (status !== "idle") {
      useOnlineStore.setState({
        status: "idle",
        queue: null,
        error: status === "connecting" ? "サーバーにつながりませんでした（サーバーが起動しているか確認してください）" : "サーバーとの接続が切れました",
      });
    }
  };
}

export const onlineLink = {
  /** サーバーにつないで合言葉の部屋（友人戦）に入る。 */
  join(request: JoinRequest) {
    stopAutoRejoin();
    lastJoin = request;
    useOnlineStore.setState({ ranked: false, rankResult: null });
    // 名前はアカウントの表示名が使われ、対局中に入り直すと同じアカウントの席に戻れる。
    connect({ t: "join", ...request, authToken: accountToken() ?? "" });
  },

  /** フレンドの対局を観戦する（フレンドコードで指定）。 */
  spectate(friendCode: string) {
    stopAutoRejoin();
    lastJoin = null;
    useOnlineStore.setState({ ranked: false, rankResult: null });
    connect({ t: "spectate", authToken: accountToken() ?? "", friendCode });
  },

  /** 段位戦の待ち行列に並ぶ。 */
  queueRanked(format: MatchFormat, unitId: string | null) {
    stopAutoRejoin();
    lastJoin = { room: "", unitId };
    connect({ t: "queueRanked", authToken: accountToken() ?? "", format, unitId });
  },

  cancelQueue() {
    onlineLink.send({ t: "cancelQueue" });
  },

  /** 対局中に切れた接続を、同じ合言葉・同じアカウントで入り直して席に戻す。 */
  rejoin() {
    rejoinNow();
  },

  send(message: ClientMessage) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  },

  /** 部屋・待ち行列を抜けて接続を閉じる（タイトルへ戻る時）。 */
  close() {
    stopAutoRejoin();
    rejoinConnection = false;
    closeSocket();
    useOnlineStore.setState({ status: "idle", room: null, members: [], queue: null });
  },
};

function closeSocket() {
  const ws = socket;
  socket = null;
  if (ws) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "leave" } satisfies ClientMessage));
    ws.close();
  }
}
