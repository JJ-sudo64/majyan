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
import type { RankState } from "./ranked.js";
import type { GachaItem } from "./gacha.js";
import type { MissionView } from "./missions.js";

/** WebSocketの接続先パス（開発時はViteがこのパスをサーバーへ中継する）。 */
export const ONLINE_WS_PATH = "/ws";
/** アカウント等のHTTP APIのパス（開発時はViteがサーバーへ中継する）。 */
export const ONLINE_API_PREFIX = "/api";
export const ONLINE_DEFAULT_PORT = 8787;
export const ROOM_CODE_MAX_LENGTH = 20;
export const PLAYER_NAME_MAX_LENGTH = 12;

// ---------------------------------------------------------------------------
// アカウント（HTTP API）
//   POST /api/guest  {displayName}            → GuestAccountResponse  ゲストアカウントを作る
//   GET  /api/me     (Authorization: Bearer)   → MeResponse
//   POST /api/me/name {displayName} (Bearer)   → MeResponse            名前を変える
//   GET  /api/me/transfer         (Bearer)     → TransferCodeResponse  引き継ぎコード（未設定ならnull）
//   POST /api/me/transfer {password} (Bearer)  → TransferCodeResponse  引き継ぎのパスワードを決める（変える）
//   POST /api/transfer {code, password}        → GuestAccountResponse  引き継ぎコードで別の端末から入る
//   POST /api/first-gacha/roll    (Bearer)     → MeResponse            最初の10連を引く（確定するまで何度でも引き直せる）
//   POST /api/first-gacha/confirm (Bearer)     → MeResponse            今の結果で確定してキャラを受け取る
//   POST /api/gacha/roll {count: 1|10} (Bearer) → GachaRollResponse    雀玉でガチャを引く
//   POST /api/gacha/exchange {item} (Bearer)   → GachaRollResponse    交換ポイントで★3のキャラかカードを1つもらう（天井）
//   POST /api/units/equip {unitId, cardId} (Bearer) → MeResponse        手持ちのキャラにカードを付ける（外せない）
//   GET  /api/me/history          (Bearer)     → RankedHistoryResponse 段位戦の戦績（通算の順位と最近の対局）
//   GET  /api/inbox               (Bearer)     → InboxResponse         お知らせと、受け取れるプレゼント
//   GET  /api/me/records          (Bearer)     → RecordsResponse       雀玉の増減とガチャの結果の履歴
//   GET  /api/ranking             (Bearer)     → RankingResponse       段位の上位と、自分の順位
//   GET  /api/missions            (Bearer)     → MissionsResponse      今日のデイリーミッション
//   POST /api/missions/claim {missionId?} (Bearer) → MissionClaimResponse 達成したミッションの報酬を受け取る（無指定なら全部）
//   POST /api/me/delete {confirm} (Bearer)     → {}                    退会（confirmはACCOUNT_DELETE_CONFIRM）
//   POST /api/gifts/claim {giftId?} (Bearer)   → GiftClaimResponse     プレゼントを受け取る（giftId無しなら全部）
//   POST /api/dev/reset-collection (Bearer)    → MeResponse            開発用: 手持ちと最初の10連を作った直後に戻す（--dev-tools時のみ）
//   失敗時は 4xx と ApiErrorResponse
// ---------------------------------------------------------------------------

export interface AccountProfile {
  id: string;
  displayName: string;
  createdAt: number;
}

export interface GuestAccountResponse {
  /** ログイン用の鍵。この時しか受け取れないので、画面側はブラウザに保存しておく。 */
  token: string;
  profile: AccountProfile;
}

/** 引き継ぎコードの桁数と使う文字（見間違えやすい0/O・1/I/Lは使わない）。 */
export const TRANSFER_CODE_LENGTH = 12;
export const TRANSFER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TRANSFER_PASSWORD_MIN_LENGTH = 8;
export const TRANSFER_PASSWORD_MAX_LENGTH = 64;

/** 入力された引き継ぎコードを保存されている形に揃える（小文字・ハイフン・空白を許す）。 */
export function normalizeTransferCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** 引き継ぎコードを読みやすく4文字ずつに区切る（例: ABCD-EFGH-JKMN）。 */
export function formatTransferCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export interface TransferCodeResponse {
  /** まだパスワードを決めていなければnull。 */
  code: string | null;
}

/** 画面に出す段位（RankStateに表示用の値を足したもの）。 */
export interface RankView extends RankState {
  /** 例: "上雀2"、"雀神" */
  label: string;
  /** 昇段に必要なポイント（雀神はnull）。 */
  maxPoints: number | null;
  gamesPlayed: number;
}

/** 最初の10連の状態。 */
export interface FirstGachaState {
  /** 確定して受け取り済みか（受け取った後はもう引けない）。 */
  confirmed: boolean;
  /** 今出ている（まだ確定していない）結果。まだ1回も引いていなければnull。 */
  pending: GachaItem[] | null;
  /** 引き直した回数（表示用）。 */
  rolls: number;
}

/** 雀玉の残高。有償（購入した分）と無償（報酬等）は法律上分けて扱う必要があるため別々に持つ。 */
export interface JadeBalance {
  free: number;
  paid: number;
}

export interface MeResponse {
  profile: AccountProfile;
  rank: RankView;
  jade: JadeBalance;
  /** このリクエストで今日のログインボーナスを受け取った場合、その雀玉の数。 */
  dailyBonus: number | null;
  /** 手持ちのキャラ（同じキャラでも1体ずつ別。付けたカードもここに入る）。 */
  units: CharacterUnit[];
  /** まだどのキャラにも付けていないカードの枚数。 */
  cards: Record<string, number>;
  /** 天井の交換ポイント（gacha.tsのEXCHANGE_COST）。 */
  exchangePoints: number;
  firstGacha: FirstGachaState;
  /** 受け取っていないプレゼントの数（プレゼントボタンの印）。 */
  unclaimedGifts: number;
  /** 今出ているお知らせのうち一番新しいもののID（未読の印。無ければnull）。 */
  latestAnnouncementId: number | null;
  /** 達成して報酬を受け取っていないミッションの数（ミッションボタンの印）。 */
  claimableMissions: number;
}

/** 手持ちのキャラ1体。カードは一度付けたら外せない。 */
export interface CharacterUnit {
  unitId: string;
  characterId: string;
  cardId: string | null;
}

export interface GachaRollResponse {
  results: GachaItem[];
  /** resultsと同じ並びで、それが初めて手に入れたキャラ・カードか。 */
  isNew: boolean[];
  me: MeResponse;
}

/** 段位戦の順位の数え上げ。places[0]が1位の回数。 */
export interface RankedPlaceStats {
  games: number;
  places: [number, number, number, number];
}

/** 段位戦1試合の、ある席の人（CPUを含む）。 */
export interface RankedHistorySeat {
  name: string;
  isYou: boolean;
  isCpu: boolean;
  characterId: string;
  cardId: string | null;
  place: 1 | 2 | 3 | 4;
  finalScore: number;
}

export interface RankedHistoryEntry {
  matchId: string;
  format: MatchFormat;
  /** 終わった時刻（ミリ秒）。 */
  finishedAt: number;
  place: 1 | 2 | 3 | 4;
  finalScore: number;
  /** 段位ポイントの増減。 */
  delta: number;
  /** その対局の後の段位（例: "上雀2"）。 */
  rankAfter: string;
  /** 卓の4人を順位順に。席の記録を始める前の対局は空。 */
  seats: RankedHistorySeat[];
}

export interface RankedHistoryResponse {
  total: RankedPlaceStats;
  byFormat: Record<MatchFormat, RankedPlaceStats>;
  /** 新しい順。 */
  recent: RankedHistoryEntry[];
}

/** 運営からのお知らせ。 */
export interface Announcement {
  id: number;
  title: string;
  body: string;
  /** 出した時刻（ミリ秒）。 */
  publishedAt: number;
}

/** プレゼントボックスの1件。 */
export interface Gift {
  id: number;
  title: string;
  message: string;
  /** 無償の雀玉。 */
  jade: number;
  items: GachaItem[];
  createdAt: number;
  /** 受け取り期限（ミリ秒）。無期限ならnull。 */
  expiresAt: number | null;
}

export interface InboxResponse {
  /** 新しい順。 */
  announcements: Announcement[];
  /** 受け取っていないもの。期限の近い順。 */
  gifts: Gift[];
}

export interface GiftClaimResponse {
  /** 今回受け取った分の合計。 */
  jade: number;
  items: GachaItem[];
  me: MeResponse;
}

/** 雀玉の増減の記録の理由（サーバーのjade_ledger.reason）→ 画面の表示。 */
export const JADE_REASON_LABELS: Record<string, string> = {
  "starting-bonus": "はじめての雀玉",
  "daily-login": "ログインボーナス",
  "ranked-reward": "段位戦の報酬",
  gift: "プレゼント",
  "gacha-1": "ガチャ（1回）",
  "gacha-10": "ガチャ（10連）",
  mission: "ミッション",
};

export interface JadeHistoryEntry {
  /** 時刻（ミリ秒）。 */
  at: number;
  freeDelta: number;
  paidDelta: number;
  freeAfter: number;
  paidAfter: number;
  reason: string;
}

/** ガチャの記録の種類（サーバーのgacha_log.kind）→ 画面の表示。 */
export const GACHA_KIND_LABELS: Record<string, string> = {
  "first-gacha": "最初の10連",
  "gacha-1": "ガチャ（1回）",
  "gacha-10": "ガチャ（10連）",
  exchange: "交換（天井）",
};

export interface GachaHistoryEntry {
  at: number;
  kind: string;
  results: GachaItem[];
}

export interface RecordsResponse {
  /** 新しい順。 */
  jade: JadeHistoryEntry[];
  /** 新しい順。 */
  gacha: GachaHistoryEntry[];
}

/** 退会の時に打ってもらう確認の言葉。 */
export const ACCOUNT_DELETE_CONFIRM = "退会する";

export interface RankingEntry {
  /** 順位（同じ段位・ポイントなら同じ順位）。 */
  position: number;
  displayName: string;
  rankLabel: string;
  points: number;
  gamesPlayed: number;
  isYou: boolean;
}

export interface RankingResponse {
  /** 上位（段位戦を1回以上打った人だけ）。 */
  top: RankingEntry[];
  /** 自分（まだ打っていなければnull）。topに入っていない時もここで分かる。 */
  you: RankingEntry | null;
  /** 順位に載っている人数。 */
  totalPlayers: number;
}

export interface MissionsResponse {
  missions: MissionView[];
  /** 次にリセットされる時刻（ミリ秒）。 */
  resetsAt: number;
}

export interface MissionClaimResponse {
  /** 今回受け取った雀玉。 */
  jade: number;
  missions: MissionView[];
  me: MeResponse;
}

export interface ApiErrorResponse {
  error: string;
}

// ---------------------------------------------------------------------------
// 画面 → サーバー
// ---------------------------------------------------------------------------

export type ClientMessage =
  /** 合言葉の部屋に入る。authTokenはアカウントのログイン用の鍵で、名前はアカウントの
      表示名が使われる。対局中の部屋に同じアカウントで入り直すと、その席に戻れる。 */
  | { t: "join"; room: string; authToken: string; unitId: string | null }
  /** 段位戦の待ち行列に入る。揃ったら（または一定時間待ったら空席をCPUで埋めて）
      matchFoundが届き、そのまま対局が始まる。 */
  | { t: "queueRanked"; authToken: string; format: MatchFormat; unitId: string | null }
  | { t: "cancelQueue" }
  /** 対局に出すキャラ（手持ちのキャラ1体。付いているカードごと出る）を選び直す。
      nullは「おまかせ」（手持ちからランダム）。対局開始前のみ。 */
  | { t: "setLoadout"; unitId: string | null }
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
  /** 段位（CPUはnull）。 */
  rankLabel: string | null;
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

/** 段位戦1試合ぶんの段位の変化（結果画面用）。 */
export interface RankResult {
  place: 1 | 2 | 3 | 4;
  delta: number;
  /** この試合でもらえた雀玉（1日の上限に達していると0）。 */
  jadeReward: number;
  before: RankView;
  after: RankView;
}

export type ServerMessage =
  /** 段位戦の待ち行列に入った。cpuFillInMs後に人が揃っていなければ空席をCPUで埋めて始まる。 */
  | { t: "queued"; format: MatchFormat; cpuFillInMs: number }
  | { t: "queueCancelled" }
  /** 段位戦の卓が決まった。roomは接続が切れた時に入り直すための部屋の合言葉。 */
  | { t: "matchFound"; room: string; format: MatchFormat }
  /** 段位戦が終わり、段位が更新された。 */
  | { t: "rankResult"; result: RankResult }
  | { t: "lobby"; room: string; members: LobbyMember[] }
  | { t: "state"; view: OnlineSeatView }
  /** 操作が受け付けられなかった等。fatal なら接続を閉じてタイトルへ戻す。 */
  | { t: "error"; message: string; fatal?: boolean };

/** サーバーが受け付ける画面からの操作の種類（ツモはサーバーが自動で行う）。 */
export function isClientActionAllowed(action: GameAction): boolean {
  return action.type !== "draw";
}

