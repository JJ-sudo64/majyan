import type { PlayerIndex } from "./actions.js";
import type { RoundState } from "./gameState.js";

/**
 * 必殺技が山に狙う牌がなくて不発だった時、それを画面に知らせる札（RoundState.cardTrigger。
 * カードの自動効果と同じ小さな札）を立てる。何も出ないと「技が働かなかった」のか
 * 「そもそも発動していない」のか分からないため。cards.tsのwithCardTriggerと同じ作りだが、
 * cards.tsはcharacters.tsを読み込むので、characters.tsから使えるようにここへ分けてある。
 */
export function withSkillFizzle(round: RoundState, seat: PlayerIndex, skillName: string, reason: string): RoundState {
  return {
    ...round,
    cardTrigger: { seq: (round.cardTrigger?.seq ?? 0) + 1, seat, title: `${skillName}は不発`, detail: reason, kind: "auto" },
  };
}
