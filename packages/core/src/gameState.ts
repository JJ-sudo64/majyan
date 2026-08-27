import type { Tile, Wind } from "./tiles.js";
import type { Hand } from "./hand.js";
import type { WallState } from "./wall.js";
import type { PlayerIndex } from "./actions.js";

export type MatchFormat = "tonpuusen" | "hanchan";

export interface DiscardedTile {
  tile: Tile;
  /** 他家に鳴かれて手牌上から消えた場合 true（河には残すが見た目を薄くする等に使用） */
  calledAway: boolean;
  /** この牌がリーチ宣言牌かどうか（横向き表示用） */
  isRiichiDeclaration: boolean;
  /** ツモってきた牌をそのまま切った（ツモ切り）場合 true。手出しなら false */
  isTsumogiri: boolean;
}

export interface PlayerRoundState {
  hand: Hand;
  discards: DiscardedTile[];
  riichi: boolean;
  doubleRiichi: boolean;
  /** リーチ直後で一発可能な状態か（他家の鳴き/自分の次巡到達で false になる） */
  ippatsuActive: boolean;
  isTenpai: boolean; // 流局時のテンパイ判定用に都度更新
}

export type TurnPhase =
  | "awaiting-draw"
  | "awaiting-discard"
  | "awaiting-calls"
  | "round-over";

export type DeclaredCallAction =
  | { type: "ron"; player: PlayerIndex }
  | { type: "pon"; player: PlayerIndex; usedHandTileIds: [string, string] }
  | { type: "minkan"; player: PlayerIndex; usedHandTileIds: [string, string, string] }
  | { type: "chi"; player: PlayerIndex; tileCodes: [import("./tiles.js").TileCode, import("./tiles.js").TileCode, import("./tiles.js").TileCode]; usedHandTileIds: [string, string] };

export interface PendingCallWindow {
  discarderIndex: PlayerIndex;
  discardTile: Tile;
  /** 加槓に対する槍槓チェックの場合 true（ロンのみ受け付ける） */
  isChankan: boolean;
  /** 応答が必要なプレイヤー一覧（捨て主/加槓者以外の3人） */
  awaitingPlayers: PlayerIndex[];
  /** 既に意思表示（鳴き宣言 or スキップ）したプレイヤー */
  respondedBy: PlayerIndex[];
  /** 鳴き/ロンを宣言した内容（スキップは含まない） */
  declaredCalls: DeclaredCallAction[];
}

export interface RoundEndResult {
  type: "tsumo" | "ron" | "exhaustive-draw" | "abortive-draw";
  winners: PlayerIndex[];
  loser?: PlayerIndex; // ロン時の放銃者
  tenpaiPlayers?: PlayerIndex[]; // 荒牌流局時のテンパイ者
  dealerContinues: boolean;
}

export interface RoundState {
  roundWind: Wind; // 1=東 2=南
  roundNumber: number; // 1-4
  honba: number;
  kyotaku: number;
  dealerSeat: PlayerIndex;
  players: [PlayerRoundState, PlayerRoundState, PlayerRoundState, PlayerRoundState];
  wall: WallState;
  currentTurn: PlayerIndex;
  phase: TurnPhase;
  lastDiscard: { player: PlayerIndex; tile: Tile } | null;
  lastDrawnTile: Tile | null;
  isRinshanTurn: boolean;
  pendingCallWindow: PendingCallWindow | null;
  kanCount: number;
  result: RoundEndResult | null;
  /** 九種九牌の判定用: これまでに鳴き/リーチが一度でも発生したか */
  anyCallOrRiichiMade: boolean;
}

export interface MatchState {
  format: MatchFormat;
  scores: [number, number, number, number];
  round: RoundState;
  finished: boolean;
  finalRanking: PlayerIndex[] | null;
}

export function seatWindOf(dealerSeat: PlayerIndex, player: PlayerIndex): Wind {
  return (((player - dealerSeat + 4) % 4) + 1) as Wind;
}
