import type { TileCode } from "./tiles.js";

export type PlayerIndex = 0 | 1 | 2 | 3;

export interface DrawAction {
  type: "draw";
  player: PlayerIndex;
}

export interface DiscardAction {
  type: "discard";
  player: PlayerIndex;
  tileId: string;
  /** ツモ切り（摸打）かどうか */
  tsumogiri: boolean;
}

export interface ChiAction {
  type: "chi";
  player: PlayerIndex;
  /** 鳴いた牌を含む3枚の牌コード（呼び出し側が手牌から選んだ2枚+鳴いた1枚） */
  tileCodes: [TileCode, TileCode, TileCode];
  usedHandTileIds: [string, string];
}

export interface PonAction {
  type: "pon";
  player: PlayerIndex;
  usedHandTileIds: [string, string];
}

export interface MinkanAction {
  type: "minkan";
  player: PlayerIndex;
  usedHandTileIds: [string, string, string];
}

export interface AnkanAction {
  type: "ankan";
  player: PlayerIndex;
  tileCode: TileCode;
}

export interface KakanAction {
  type: "kakan";
  player: PlayerIndex;
  tileId: string; // 追加する牌（手牌内）
}

export interface RiichiAction {
  type: "riichi";
  player: PlayerIndex;
  /** リーチ宣言と同時に切る牌 */
  tileId: string;
}

export interface TsumoAction {
  type: "tsumo";
  player: PlayerIndex;
}

export interface RonAction {
  type: "ron";
  player: PlayerIndex;
  /** 誰の捨て牌に対してかは gameState から自明なので保持しない */
}

export interface KyushuKyuhaiAction {
  type: "kyushukyuhai";
  player: PlayerIndex;
}

export interface SkipAction {
  type: "skip";
  player: PlayerIndex;
}

export type GameAction =
  | DrawAction
  | DiscardAction
  | ChiAction
  | PonAction
  | MinkanAction
  | AnkanAction
  | KakanAction
  | RiichiAction
  | TsumoAction
  | RonAction
  | KyushuKyuhaiAction
  | SkipAction;
