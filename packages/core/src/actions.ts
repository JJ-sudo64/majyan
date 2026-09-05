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

export interface UseSkillAction {
  type: "useSkill";
  player: PlayerIndex;
}

export interface BorrowSkillAction {
  type: "borrowSkill";
  player: PlayerIndex;
  /** 技を借りる相手（自分以外） */
  target: PlayerIndex;
}

export interface RetrieveDiscardAction {
  type: "retrieveDiscard";
  player: PlayerIndex;
  /** 手牌に取り返す、自分の河にある牌のid */
  reclaimTileId: string;
  /** 代わりにその場で切り直す、手牌内の牌のid */
  replacementTileId: string;
}

export interface UseCardAction {
  type: "useCard";
  player: PlayerIndex;
}

export interface SwapTilesAction {
  type: "swapTiles";
  player: PlayerIndex;
  /** 同時に交換して山に返す牌（手牌内、まとめて1回で処理する） */
  tileIds: string[];
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
  | SkipAction
  | UseSkillAction
  | BorrowSkillAction
  | RetrieveDiscardAction
  | SwapTilesAction
  | UseCardAction;
