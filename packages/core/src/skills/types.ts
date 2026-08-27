/**
 * 将来のキャラクター必殺技システム用のフック型定義。
 * 今回のマイルストーンでは効果は実装せず、拡張口の型だけを用意する。
 */
import type { RoundState } from "../gameState.js";
import type { PlayerIndex } from "../actions.js";
import type { TileCode } from "../tiles.js";

export interface SkillContext {
  round: RoundState;
  owner: PlayerIndex;
}

export interface SkillHooks {
  /** ツモの直前。牌をすり替える等の効果を将来ここに差し込む */
  onBeforeDraw?: (ctx: SkillContext) => void;
  /** 打牌の直後 */
  onAfterDiscard?: (ctx: SkillContext, discarded: TileCode) => void;
  /** 点数計算の直前（役やドラを追加するような効果を想定） */
  onScoreCalculation?: (ctx: SkillContext) => void;
}

export interface CharacterSkill {
  id: string;
  name: string;
  description: string;
  hooks: SkillHooks;
}
