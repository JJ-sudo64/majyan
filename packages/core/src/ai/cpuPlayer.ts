import type { RoundState } from "../gameState.js";
import type { GameAction, PlayerIndex } from "../actions.js";
import { calcShanten } from "../shanten.js";
import { CHARACTERS } from "../characters.js";
import {
  applyAction,
  borrowableSkillTargets,
  canDeclareTsumo,
  canUseCard,
  canUseSkill,
  reclaimableDiscardTileIds,
} from "../gameEngine.js";
import { decideCallResponse, decideTurnAction, DEFAULT_AI_DIFFICULTY, type AiDifficulty } from "./simpleAi.js";

export interface CpuDecisionOptions {
  /** true の間はCPUに和了させない（ツモはツモ切り、ロンは見送りに差し替える）。
      Web版のデバッグモード用。 */
  noWin?: boolean;
}

/**
 * 実際に適用できるアクションかどうかを試し打ちで確かめる。canUseSkill等が
 * trueを返している以上失敗しないはずだが、想定外の例外で「その手番のCPUが
 * 何も決められず対局がフリーズする」のを避けるため、失敗したら次の候補へ
 * 回す（旧gameStore.tsのtry/catchと同じ扱い）。
 */
function isApplicable(round: RoundState, action: GameAction): boolean {
  try {
    applyAction(round, action);
    return true;
  } catch {
    return false;
  }
}

/**
 * ミオの「取り返し」。「河から取り返せる牌ごとに、手牌に戻して何を切り直せば
 * 一番シャンテンが良くなるか」を全探索し、現状より実際に改善する組み合わせが
 * ある時だけ使う（改善しないなら空撃ちせず見送る＝ゲージを無駄にしない）。
 */
function decideRetrieveDiscard(round: RoundState, seat: PlayerIndex): GameAction | null {
  const character = CHARACTERS[round.characterIds[seat]];
  if (!character?.retrievesDiscard) return null;
  const p = round.players[seat];
  const currentShanten = calcShanten(p.hand);
  let best: { reclaimTileId: string; replacementTileId: string; shanten: number } | null = null;
  for (const reclaimTileId of reclaimableDiscardTileIds(round, seat)) {
    const reclaimed = p.discards.find((d) => d.tile.id === reclaimTileId)!.tile;
    const candidateConcealed = [...p.hand.concealed, reclaimed];
    for (const t of candidateConcealed) {
      if (t.id === reclaimed.id) continue; // 戻した牌をそのまま切り直すのは無意味
      const trial = { concealed: candidateConcealed.filter((x) => x.id !== t.id), melds: p.hand.melds };
      const shanten = calcShanten(trial);
      if (!best || shanten < best.shanten) best = { reclaimTileId, replacementTileId: t.id, shanten };
    }
  }
  if (!best || best.shanten >= currentShanten) return null;
  return { type: "retrieveDiscard", player: seat, reclaimTileId: best.reclaimTileId, replacementTileId: best.replacementTileId };
}

/**
 * 自分の手番（awaiting-discard）のCPUが次に取る1アクションを決める。
 *
 * 必殺技・借り物競争・取り返し・カードは打牌とは別のアクションとして1つずつ
 * 返す（呼び出し側は適用後にもう一度この関数を呼ぶ）。発動と打牌を1回の
 * 状態更新にまとめると、発動でゲージが0になった瞬間がUIに一度も現れず、
 * SkillActivationOverlayの「満タンから0への低下」検知が発火しなくなるため。
 *
 * 今引いた牌がそのままツモ和了になる場合は、どれよりも和了を優先する。
 * ナギ/ライコのように自摸牌をすり替えるタイプの必殺技を先に使うと、和了牌
 * そのものを山に戻して引き直してしまい、リーチ中でも和了を逃すため。
 * （判断はまだ単純に「使えるなら即使う」だけ。駆け引きの調整は今後の課題。）
 */
export function decideCpuTurnAction(
  round: RoundState,
  seat: PlayerIndex,
  difficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY,
  options: CpuDecisionOptions = {},
): GameAction {
  if (!canDeclareTsumo(round, seat)) {
    const candidates: (GameAction | null)[] = [
      canUseSkill(round, seat) ? { type: "useSkill", player: seat } : null,
      // カリンの「借り物競争」: 借りられるなら選べる中の先頭の相手から借りる。
      (() => {
        const targets = borrowableSkillTargets(round, seat);
        return targets.length > 0 ? { type: "borrowSkill", player: seat, target: targets[0]! } : null;
      })(),
      decideRetrieveDiscard(round, seat),
      canUseCard(round, seat) ? { type: "useCard", player: seat } : null,
    ];
    for (const candidate of candidates) {
      if (candidate && isApplicable(round, candidate)) return candidate;
    }
  }
  const action = decideTurnAction(round, seat, difficulty);
  if (options.noWin && action.type === "tsumo") {
    return { type: "discard", player: seat, tileId: round.lastDrawnTile!.id, tsumogiri: true };
  }
  return action;
}

/** 他家の打牌に対する応答（awaiting-calls）をCPUとして決める。 */
export function decideCpuCallResponse(
  round: RoundState,
  seat: PlayerIndex,
  difficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY,
  options: CpuDecisionOptions = {},
): GameAction {
  const action = decideCallResponse(round, seat, difficulty);
  if (options.noWin && action.type === "ron") return { type: "skip", player: seat };
  return action;
}
