/**
 * 対局（MatchState）を1手ずつ進めるための、座席に依存しない純粋関数群。
 *
 * gameEngine.tsのapplyActionは1局（RoundState）の中しか扱わず、点数（MatchState.scores）
 * の増減や局の変わり目は呼び出し側に任されている。以前はそれをWeb版の
 * gameStore.tsが「座席0が人間・1〜3がCPU」前提で抱えていたため、ここに
 * 切り出して、ローカル対戦とネット対戦（サーバー側）で同じ進行ロジックを
 * 使えるようにしている。「いつ実行するか」（CPUの思考待ち等のタイミング）は
 * 呼び出し側の責務で、ここでは扱わない。
 */
import type { TileCode } from "./tiles.js";
import type { GameAction, PlayerIndex } from "./actions.js";
import type { MatchState, RoundState } from "./gameState.js";
import {
  ankanOptions,
  applyAction,
  borrowableSkillTargets,
  canDeclareRon,
  canDeclareTsumo,
  canSwapStartingTile,
  canUseSkill,
  computeRoundScoreOutcome,
  RIICHI_STICK_COST,
  type RoundScoreOutcome,
} from "./gameEngine.js";
import { dealNewRound, hasBustedPlayer, planNextRound, rankSeats, settleLeftoverKyotaku } from "./matchFormat.js";
import { applyCardBustGuards, applyCardMatchEndBonuses, resolveKyotakuWithCard } from "./cards.js";
import { decideTileSwaps } from "./ai/simpleAi.js";

type Scores = [number, number, number, number];

// ---------------------------------------------------------------------------
// アクション適用
// ---------------------------------------------------------------------------

export interface MatchActionResult {
  match: MatchState;
  /** カード「点棒吸収」等でこのアクション中に即座の点数増減が起きた場合、その増減。
      UIの演出（ScoreAdjustmentOverlay）用。 */
  scoreAdjustment: Scores | null;
}

/**
 * 1アクションを対局に適用する。applyActionに加えて、RoundStateが持たない
 * 持ち点（MatchState.scores）への反映もここで行う:
 * - リーチ宣言者の供託1000点（カード「ノーコストリーチ」が未消費なら減点しない。
 *   round側もkyotakuを積まないためゼロサムは保たれる）
 * - RoundState.pendingScoreAdjustment（カード「点棒吸収」等）
 * 不正なアクションの場合はapplyAction同様に例外を投げる。
 */
export function applyMatchAction(match: MatchState, action: GameAction): MatchActionResult {
  const round = match.round;
  const freeRiichi =
    action.type === "riichi" &&
    round.cardIds[action.player] === "no-cost-riichi" &&
    round.cardUsesRemaining[action.player] > 0;
  let nextRound = applyAction(round, action);
  let scores = match.scores;
  if (action.type === "riichi" && !freeRiichi) {
    scores = scores.map((s, i) => (i === action.player ? s - RIICHI_STICK_COST : s)) as Scores;
  }
  const scoreAdjustment = nextRound.pendingScoreAdjustment;
  if (scoreAdjustment) {
    scores = scores.map((s, i) => s + scoreAdjustment[i]!) as Scores;
    nextRound = { ...nextRound, pendingScoreAdjustment: null };
  }
  // リーチの可否（1000点未満は不可）を局の中で判定できるよう、今の持ち点を写しておく。
  return { match: { ...match, round: { ...nextRound, points: scores }, scores }, scoreAdjustment };
}

// ---------------------------------------------------------------------------
// 局の終了と次局
// ---------------------------------------------------------------------------

export interface SettledRound {
  match: MatchState;
  outcome: RoundScoreOutcome;
}

/**
 * round-overになった局の点数を持ち点へ精算する。この局が対局全体の最終局
 * （または箱割れで打ち切り）ならここでfinishedを立てる。結果画面の表示中に
 * 「次の局へ」と「タイトルへ戻る」のどちらを出すかを決めるため、次局へ
 * 進む操作（advanceToNextRound）を待たずに確定させておく必要がある。
 */
export function settleRound(match: MatchState): SettledRound {
  const round = match.round;
  if (round.phase !== "round-over" || !round.result) throw new Error("局がまだ終わっていません");
  const outcome = computeRoundScoreOutcome(round);
  const rawScores = match.scores.map((s, i) => s + outcome.scoreDeltas[i]!) as Scores;
  // カード「箱割れ防止」: 既に0点未満へ落ちている座席を、箱割れ判定・結果画面へ
  // 反映する前に救済する。カードの消費状態（cardUsesRemaining）は次局へ
  // 持ち越すため、更新後のroundを以降は使う。
  const { round: guardedRound, scores } = applyCardBustGuards(round, rawScores);
  const result = round.result;
  const keepKyotaku = result.type !== "tsumo" && result.type !== "ron";
  const plan = planNextRound(round, match.format, result.dealerContinues, keepKyotaku);
  // 箱下続行ルール(continueBelowZero)がオフの場合、誰かが箱割れした時点で
  // 通常の局数を消化しきっていなくても即座に対局終了とする。
  const busted = !match.continueBelowZero && hasBustedPlayer(scores);
  const finished = plan.matchOver || busted;
  // 対局がここで終わる場合、次局へ持ち越すはずだった供託(plan.kyotaku)の
  // 行き先がもう無いため清算する（settleLeftoverKyotakuのコメント参照）。
  // カード「起死回生」等、対局終了時にだけ点数を調整するパッシブ効果もここで適用する。
  const settledScores = finished
    ? applyCardMatchEndBonuses(guardedRound, resolveKyotakuWithCard(guardedRound, scores, plan.kyotaku, settleLeftoverKyotaku))
    : scores;
  const finalRanking = finished ? rankSeats(settledScores, match.startingDealer) : null;
  return { match: { ...match, round: guardedRound, scores: settledScores, finished, finalRanking }, outcome };
}

/**
 * ルナの必殺技「運命の采配」で得た配牌入れ替え権を、指定した座席（CPU席）の
 * ぶんだけ自動で消化する。人間の席は自分でUI操作して使うため含めない。
 * 交換は権利の残り枚数ぶんを1回のアクションでまとめて同時に行う仕様。
 */
export function resolveAutoTileSwaps(round: RoundState, seats: readonly PlayerIndex[]): RoundState {
  let next = round;
  for (const seat of seats) {
    if (!canSwapStartingTile(next, seat)) continue;
    const tileIds = decideTileSwaps(next, seat, next.players[seat].tileSwapsRemaining);
    if (tileIds.length === 0) continue;
    next = applyAction(next, { type: "swapTiles", player: seat, tileIds });
  }
  return next;
}

/**
 * settleRound済みの対局を次局へ進める（配牌まで）。autoTileSwapSeatsには
 * 配牌入れ替え権を自動消化させる座席（＝CPU席）を渡す。
 * 既に対局終了している場合はそのまま返す。
 */
export function advanceToNextRound(
  match: MatchState,
  rng: () => number,
  autoTileSwapSeats: readonly PlayerIndex[],
): MatchState {
  const round = match.round;
  if (!round.result || match.finished) return match;
  const result = round.result;
  const keepKyotaku = result.type !== "tsumo" && result.type !== "ron";
  const roundKyotakuAfter = keepKyotaku ? round.kyotaku : 0;
  const plan = planNextRound(round, match.format, result.dealerContinues, keepKyotaku);
  // 対局終了はsettleRoundで既にfinishedとして反映済みのため通常ここには来ないが、念のため。
  if (plan.matchOver) {
    const settledScores = applyCardMatchEndBonuses(
      round,
      resolveKyotakuWithCard(round, match.scores, plan.kyotaku, settleLeftoverKyotaku),
    );
    return { ...match, scores: settledScores, finished: true, finalRanking: rankSeats(settledScores, match.startingDealer) };
  }
  // 必殺技ゲージは半荘/東風戦を通して持ち越す（局をまたいでリセットしない）。
  const carriedGauges = round.players.map((p) => p.skillGauge) as Scores;
  const carriedTileSwaps = round.players.map((p) => p.pendingTileSwapNextRound) as [boolean, boolean, boolean, boolean];
  // ナオキの「クマクマタイム」等が見る「自分の和了による連荘か」。本場が付く
  // 連荘には荒牌流局の親テンパイ継続・九種九牌流局も含まれるため、resultの
  // 種別まで見て区別する（RoundState.dealerRenchanByWin参照）。
  const dealerWonRenchan = result.dealerContinues && (result.type === "tsumo" || result.type === "ron");
  const nextRound = dealNewRound(
    plan.roundWind,
    plan.roundNumber,
    plan.honba,
    roundKyotakuAfter,
    plan.dealerSeat,
    rng,
    round.characterIds,
    carriedGauges,
    carriedTileSwaps,
    dealerWonRenchan,
    round.cardIds,
    round.cardUsesRemaining,
    round.cardNegateArmed,
    match.format,
  );
  return { ...match, round: resolveAutoTileSwaps({ ...nextRound, points: match.scores }, autoTileSwapSeats) };
}

// ---------------------------------------------------------------------------
// 次に誰が何をするか
// ---------------------------------------------------------------------------

export type PendingDecision =
  | { kind: "round-over" }
  /** ツモは常に自動。timeStopBonusは必殺技「時間停止」のボーナス手番
      （他家の手番を挟まずに発動者がもう一度ツモる）で、UIは他家3人ぶんの
      空振り演出の時間だけ実際のツモを遅らせる。 */
  | { kind: "draw"; seat: PlayerIndex; timeStopBonus: boolean }
  | { kind: "turn"; seat: PlayerIndex }
  | { kind: "call"; seat: PlayerIndex }
  /** 呼び出しウィンドウの全員が応答済みで解決待ち等、誰の番でもない。 */
  | { kind: "none" };

/**
 * 現在の局面で、次に意思決定が必要な座席とその種類。
 * 鳴きの応答はawaitingPlayersの並び順に1人ずつ求める。
 */
export function pendingDecision(round: RoundState): PendingDecision {
  switch (round.phase) {
    case "round-over":
      return { kind: "round-over" };
    case "awaiting-draw":
      return {
        kind: "draw",
        seat: round.currentTurn,
        timeStopBonus: round.players[round.currentTurn].timeStopTurnsRemaining > 0,
      };
    case "awaiting-discard":
      return { kind: "turn", seat: round.currentTurn };
    case "awaiting-calls": {
      const window = round.pendingCallWindow;
      const seat = window?.awaitingPlayers.find((p) => !window.respondedBy.includes(p));
      return seat === undefined ? { kind: "none" } : { kind: "call", seat };
    }
  }
}

/**
 * リーチ中の手番で、ツモ切り以外に「本当に選べる余地」（ツモ和了・暗槓・
 * 必殺技・借り物競争）があるか。
 */
export function hasRiichiTurnChoice(round: RoundState, seat: PlayerIndex): boolean {
  return (
    !!canDeclareTsumo(round, seat) ||
    ankanOptions(round, seat).length > 0 ||
    canUseSkill(round, seat) ||
    borrowableSkillTargets(round, seat).length > 0
  );
}

/**
 * 人間の席で、本人に選ばせるまでもなく自動で進めてよいアクション。無ければnull。
 * - リーチ後の手番で選べる余地が無い → ツモ切り（毎回クリックさせるのは冗長なため）
 * - 鳴きの応答で選べる選択肢が1つも無い → 見送り
 */
export function autoActionForHuman(round: RoundState, seat: PlayerIndex): GameAction | null {
  const decision = pendingDecision(round);
  if (decision.kind === "turn" && decision.seat === seat) {
    if (!round.players[seat].riichi || hasRiichiTurnChoice(round, seat)) return null;
    return { type: "discard", player: seat, tileId: round.lastDrawnTile!.id, tsumogiri: true };
  }
  if (decision.kind === "call" && decision.seat === seat) {
    return hasAnyCallOption(computeCallOptions(round, seat)) ? null : { type: "skip", player: seat };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 鳴きの選択肢
// ---------------------------------------------------------------------------

export interface CallOptions {
  canRon: boolean;
  canPon: {
    tileCode: TileCode;
    /** ポンする3枚（discardTile+手牌2枚）ぶんの赤ドラ判定。牌画像を実物どおりに出すため。 */
    redFlags: [boolean, boolean, boolean];
    usedHandTileIds: [string, string];
  } | null;
  canMinkan: {
    tileCode: TileCode;
    /** カンする4枚（discardTile+手牌3枚）ぶんの赤ドラ判定。 */
    redFlags: [boolean, boolean, boolean, boolean];
    usedHandTileIds: [string, string, string];
  } | null;
  chiOptions: {
    tileCodes: [TileCode, TileCode, TileCode];
    /** tileCodesと同じ並び順の赤ドラ判定。牌画像を実物どおり（赤5なら赤い柄）に出すため。 */
    redFlags: [boolean, boolean, boolean];
    usedHandTileIds: [string, string];
  }[];
}

export function hasAnyCallOption(options: CallOptions): boolean {
  return options.canRon || !!options.canPon || !!options.canMinkan || options.chiOptions.length > 0;
}

/**
 * 現在の呼び出しウィンドウで、その座席がまだ応答していない対象かどうか。
 * 既に応答済み（他家の応答待ちでウィンドウがまだ開いている）の座席に
 * 選択肢を出すと、操作時にコアエンジンの「応答対象ではありません」で弾かれる。
 */
export function canRespondToCall(round: RoundState, seat: PlayerIndex): boolean {
  const window = round.pendingCallWindow;
  if (round.phase !== "awaiting-calls" || !window) return false;
  return window.awaitingPlayers.includes(seat) && !window.respondedBy.includes(seat);
}

/** 呼び出しウィンドウの打牌に対して、その座席が選べるロン/ポン/明槓/チー。 */
export function computeCallOptions(round: RoundState, seat: PlayerIndex): CallOptions {
  const window = round.pendingCallWindow;
  if (!window) return { canRon: false, canPon: null, canMinkan: null, chiOptions: [] };
  const discardTile = window.discardTile;
  const hand = round.players[seat].hand;

  const canRon = !!canDeclareRon(round, seat, discardTile.code, window.discarderIndex, window.isChankan);
  if (window.isChankan) return { canRon, canPon: null, canMinkan: null, chiOptions: [] };
  // リーチ後は手牌が固定されるため、チー/ポン/カンは選べない（ロンのみ）。
  if (round.players[seat].riichi) return { canRon, canPon: null, canMinkan: null, chiOptions: [] };

  const matches = hand.concealed.filter((t) => t.code === discardTile.code);
  const discardRed = !!discardTile.isRed;
  const canPon =
    matches.length >= 2
      ? {
          tileCode: discardTile.code,
          redFlags: [discardRed, !!matches[0]!.isRed, !!matches[1]!.isRed] as [boolean, boolean, boolean],
          usedHandTileIds: [matches[0]!.id, matches[1]!.id] as [string, string],
        }
      : null;
  const canMinkan =
    matches.length >= 3
      ? {
          tileCode: discardTile.code,
          redFlags: [discardRed, !!matches[0]!.isRed, !!matches[1]!.isRed, !!matches[2]!.isRed] as [boolean, boolean, boolean, boolean],
          usedHandTileIds: [matches[0]!.id, matches[1]!.id, matches[2]!.id] as [string, string, string],
        }
      : null;

  const chiOptions: CallOptions["chiOptions"] = [];
  const isNextSeat = ((window.discarderIndex + 1) % 4) === seat;
  if (isNextSeat && !discardTile.code.endsWith("z")) {
    const n = Number(discardTile.code[0]);
    const suit = discardTile.code[1];
    const find = (num: number) => hand.concealed.find((t) => t.code === `${num}${suit}`);
    const combos: [number, number][] = [
      [n - 2, n - 1],
      [n - 1, n + 1],
      [n + 1, n + 2],
    ];
    for (const [a, b] of combos) {
      if (a < 1 || b > 9) continue;
      const ta = find(a);
      const tb = a === b ? undefined : find(b);
      if (ta && tb) {
        const sorted = [
          { code: discardTile.code, isRed: !!discardTile.isRed },
          { code: ta.code, isRed: !!ta.isRed },
          { code: tb.code, isRed: !!tb.isRed },
        ].sort((x, y) => Number(x.code[0]) - Number(y.code[0]));
        const tileCodes = sorted.map((t) => t.code) as [TileCode, TileCode, TileCode];
        const redFlags = sorted.map((t) => t.isRed) as [boolean, boolean, boolean];
        chiOptions.push({ tileCodes, redFlags, usedHandTileIds: [ta.id, tb.id] });
      }
    }
  }

  return { canRon, canPon, canMinkan, chiOptions };
}
