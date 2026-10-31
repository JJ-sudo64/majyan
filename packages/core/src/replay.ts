/**
 * 牌譜（対局の再生）。1局ぶんを「局が始まった時の対局の状態」と「その局で行われた操作の
 * 並び」で持ち、applyMatchActionで順に当て直して局面を作り直す。乱数を使うのは配牌
 * （dealNewRound）だけで、局の中の進行（applyAction）は乱数も時刻も使わないため、
 * これだけで実際の対局とまったく同じ局面になる。
 */
import type { GameAction } from "./actions.js";
import type { MatchState, RoundState } from "./gameState.js";
import { applyMatchAction, settleRound, type SettledRound } from "./matchController.js";

export interface ReplayRound {
  /** 局が始まった時（配牌の直後）の対局の状態。 */
  start: MatchState;
  actions: GameAction[];
}

export interface ReplayRoundFrames {
  /** states[0]が局の始まり、states[i]がi番目の操作の後。 */
  states: MatchState[];
  /** 局が最後まで終わっていれば、その精算（結果画面の点数の動き）。 */
  settled: SettledRound | null;
}

/**
 * カードが2枠になる前に保存された牌譜には、2枠目（cardIds2・cardUsesRemaining2）が無い。
 * そのまま当て直すと最初の操作で落ちて、牌譜がほぼ見られなくなるため、空の2枠目を補う。
 */
export function withSecondCardSlot(match: MatchState): MatchState {
  const round = match.round as Omit<RoundState, "cardIds2" | "cardUsesRemaining2"> & Partial<Pick<RoundState, "cardIds2" | "cardUsesRemaining2">>;
  if (round.cardIds2 && round.cardUsesRemaining2) return match;
  return {
    ...match,
    round: {
      ...round,
      cardIds2: round.cardIds2 ?? [null, null, null, null],
      cardUsesRemaining2: round.cardUsesRemaining2 ?? [0, 0, 0, 0],
    },
  };
}

/** 1局ぶんの局面を作り直す。記録と合わない操作があればそこで止める（壊れた記録でも途中までは見られる）。 */
export function replayRoundFrames(round: ReplayRound): ReplayRoundFrames {
  const start = withSecondCardSlot(round.start);
  const states: MatchState[] = [start];
  let match = start;
  for (const action of round.actions) {
    try {
      match = applyMatchAction(match, action).match;
    } catch {
      break;
    }
    states.push(match);
  }
  const settled = match.round.phase === "round-over" && match.round.result ? settleRound(match) : null;
  return { states, settled };
}
