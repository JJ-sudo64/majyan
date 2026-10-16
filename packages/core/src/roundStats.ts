/**
 * 1局ぶんの成績の集計（戦績画面の和了率・放銃率・副露率・立直率などの元になる数字）。
 * 牌譜の1局（replay.tsのReplayRound）を作り直して、各席が「何をしたか」を数える。
 * 対局が終わった時にサーバーが1度だけ数えて保存する（server/src/roundStats.ts）。
 */
import type { PlayerIndex } from "./actions.js";
import { replayRoundFrames, type ReplayRound } from "./replay.js";

/** ある席の、1局での成績。 */
export interface RoundSeatStats {
  seat: PlayerIndex;
  /** この局の親だったか。 */
  dealer: boolean;
  /** 立直したか（ダブル立直を含む）。 */
  riichi: boolean;
  /** 副露したか（暗槓だけなら副露にしない）。 */
  open: boolean;
  /** 和了したか（ツモ・ロンのどちらも）。ダブロンなら両者が和了。 */
  win: boolean;
  /** 和了がツモだったか。 */
  tsumo: boolean;
  /** 放銃したか（ロンされたか）。 */
  dealtIn: boolean;
  /** 和了した時の和了点（本場・供託を含まない、支払いの合計）。和了していなければ0。 */
  winPoints: number;
  /** 和了した巡目（自分が捨てた牌の数＋1）。和了していなければ0。 */
  winTurn: number;
}

/**
 * 牌譜の1局を数える。局が最後まで終わっていない（記録が途中で切れている）場合はnull。
 * 流局は4席とも和了・放銃なしで、立直・副露だけが数えられる。
 */
export function summarizeRound(round: ReplayRound): RoundSeatStats[] | null {
  const { states, settled } = replayRoundFrames(round);
  if (!settled) return null;
  const last = states[states.length - 1]!.round;
  const result = last.result;
  if (!result) return null;
  const winners = result.type === "tsumo" || result.type === "ron" ? result.winners : [];
  return ([0, 1, 2, 3] as PlayerIndex[]).map((seat): RoundSeatStats => {
    const p = last.players[seat]!;
    const won = winners.includes(seat);
    const analysis = settled.outcome.winAnalyses[seat];
    return {
      seat,
      dealer: seat === last.dealerSeat,
      riichi: p.riichi,
      open: p.hand.melds.some((m) => m.type !== "ankan"),
      win: won,
      tsumo: won && result.type === "tsumo",
      dealtIn: result.type === "ron" && result.loser === seat,
      winPoints: won && analysis ? analysis.score.payments.total : 0,
      // ツモは自分が引いた牌も含めた巡目、ロンは捨てた牌の数＋1（相手の捨て牌に当たる時点）。
      winTurn: won ? p.discards.length + 1 : 0,
    };
  });
}
