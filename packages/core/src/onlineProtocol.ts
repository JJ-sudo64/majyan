/**
 * ネット対戦のサーバー(packages/server)と画面(packages/web)の間でやり取りする
 * メッセージの型。両方から同じ定義を使うためcoreに置く（中身は型と定数だけ）。
 *
 * 座席番号の扱い: サーバーが送る座席番号・対局状態はすべて「受け取る人から
 * 見た座席番号」（自分=0、下家=1、対面=2、上家=3。seatView.tsの
 * rotateMatchForViewer参照）に回してある。画面から送る操作(action)も同じく
 * 自分=0の番号で組み立てて送り、サーバー側で本物の座席番号に戻す。
 */
import type { GameAction } from "./actions.js";
import type { MatchFormat, MatchState } from "./gameState.js";
import type { RoundScoreOutcome } from "./gameEngine.js";
import type { SeatOptions } from "./seatView.js";
import type { ClockDisplay } from "./turnClock.js";

/** WebSocketの接続先パス（開発時はViteがこのパスをサーバーへ中継する）。 */
export const ONLINE_WS_PATH = "/ws";
export const ONLINE_DEFAULT_PORT = 8787;
export const ROOM_CODE_MAX_LENGTH = 20;
export const PLAYER_NAME_MAX_LENGTH = 12;

// ---------------------------------------------------------------------------
// 画面 → サーバー
// ---------------------------------------------------------------------------

export type ClientMessage =
  /** 合言葉の部屋に入る。対局中の部屋に同じ名前で入り直すと、その席に復帰する。 */
  | { t: "join"; room: string; name: string; characterId: string | null; cardId: string | null }
  /** 部屋のキャラクター・カードを選び直す（対局開始前のみ）。 */
  | { t: "setLoadout"; characterId: string | null; cardId: string | null }
  /** 対局開始（部屋主のみ）。空いている席はCPUが入る。 */
  | { t: "start"; format: MatchFormat; continueBelowZero: boolean }
  /** 対局中の操作。playerやborrowSkillのtargetは自分=0の座席番号。 */
  | { t: "action"; action: GameAction }
  /** 局の結果を見終わった（全員が押すか時間切れで次局へ進む）。 */
  | { t: "nextRound" }
  | { t: "leave" };

// ---------------------------------------------------------------------------
// サーバー → 画面
// ---------------------------------------------------------------------------

export interface LobbyMember {
  name: string;
  characterId: string | null;
  cardId: string | null;
  isHost: boolean;
  isYou: boolean;
}

export interface SeatInfo {
  name: string;
  isCpu: boolean;
  /** 対局中に接続が切れている人間の席（その間は時間切れと同じ自動操作で進む）。 */
  disconnected: boolean;
}

/** 1人ぶんの画面に必要なものすべて（すべて受け取る人から見た座席番号）。 */
export interface OnlineSeatView {
  /** 自分の席から見える対局状態（他家の手牌・山は伏せてある）。 */
  match: MatchState;
  options: SeatOptions;
  clock: ClockDisplay | null;
  seats: [SeatInfo, SeatInfo, SeatInfo, SeatInfo];
  /** 局が終わって結果を表示している間true。 */
  pendingRoundEnd: boolean;
  lastRoundOutcome: RoundScoreOutcome | null;
  /** 自分がもう「次の局へ」を押したか。 */
  roundEndAcknowledged: boolean;
  /** 結果表示が自動で閉じて次局へ進むまでの残り時間。 */
  roundEndRemainingMs: number | null;
  /** カード「点棒吸収」等の即時の点数増減。keyが変わった時だけ演出する。 */
  lastScoreAdjustment: { delta: [number, number, number, number]; key: number } | null;
}

export type ServerMessage =
  | { t: "lobby"; room: string; members: LobbyMember[] }
  | { t: "state"; view: OnlineSeatView }
  /** 操作が受け付けられなかった等。fatal なら接続を閉じてタイトルへ戻す。 */
  | { t: "error"; message: string; fatal?: boolean };

/** サーバーが受け付ける画面からの操作の種類（ツモはサーバーが自動で行う）。 */
export function isClientActionAllowed(action: GameAction): boolean {
  return action.type !== "draw";
}

