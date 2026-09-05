import { create } from "zustand";
import {
  ankanOptions,
  applyAction,
  applyCardBustGuards,
  applyCardMatchEndBonuses,
  borrowableSkillTargets,
  calcShanten,
  canDeclareRon,
  canDeclareTsumo,
  canRetrieveDiscard,
  canSwapStartingTile,
  canUseCard,
  canUseSkill,
  CHARACTERS,
  computeRoundScoreOutcome,
  createMatch,
  dealNewRound,
  decideCallResponse,
  decideTileSwaps,
  decideTurnAction,
  hasBustedPlayer,
  planNextRound,
  randomCardId,
  randomCharacterIds,
  reclaimableDiscardTileIds,
  resolveKyotakuWithCard,
  settleLeftoverKyotaku,
  RIICHI_STICK_COST,
  DEFAULT_AI_DIFFICULTY,
  type AiDifficulty,
  type GameAction,
  type MatchFormat,
  type MatchState,
  type PlayerIndex,
  type RoundScoreOutcome,
  type RoundState,
  type TileCode,
} from "@majyan/core";

const HUMAN: PlayerIndex = 0;
/** index 0(自分)は使わないが、PlayerIndexでそのまま添字アクセスできるよう4要素にしておく。 */
export type CpuDifficultySettings = [AiDifficulty, AiDifficulty, AiDifficulty, AiDifficulty];
const DEFAULT_CPU_DIFFICULTY: CpuDifficultySettings = [
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_AI_DIFFICULTY,
];
const CPU_THINK_DELAY_MS = 550;
/** デバッグモード中はCPUの手番・応答をほぼ即座に進める（＝早送り）。 */
const DEBUG_CPU_THINK_DELAY_MS = 15;
/** 巻き戻し用に保持する局面スナップショットの最大数。 */
const MAX_HISTORY = 50;
/** 必殺技「時間停止」のボーナス手番（本来なら次家に手番が渡るはずが、
    そのまま発動者がもう一度ツモる瞬間）で、他家3人ぶんの「手番が来た
    かのような」空振り演出（OpponentArea.tsx/Hand.tsxのnameplate--fake-turn）
    を1人ずつ順番に見せるための1ステップぶんの時間。tick()側は実際の
    ツモをこの3倍（他家3人ぶん）だけ遅らせ、CSS側もこの値をアニメーション
    のdurationにそのまま使うことで、演出が一巡し終わるのと実際にツモが
    実行されるタイミングを一致させる。 */
export const TIME_STOP_FAKE_TURN_STEP_MS = 650;

export interface HumanCallOptions {
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

/**
 * 現在の呼び出しウィンドウで自分がまだ応答していない対象かどうか。
 * これを経ずに humanCallOptions を真値にすると、既に応答済み（他家の応答待ちで
 * ウィンドウがまだ開いている）状態でも操作ボタンが再表示され、クリック時に
 * コアエンジンの「応答対象ではありません」エラーで弾かれてしまう。
 */
function canHumanRespond(round: RoundState): boolean {
  const window = round.pendingCallWindow;
  if (round.phase !== "awaiting-calls" || !window) return false;
  return window.awaitingPlayers.includes(HUMAN) && !window.respondedBy.includes(HUMAN);
}

function computeHumanCallOptions(round: RoundState): HumanCallOptions {
  const window = round.pendingCallWindow;
  if (!window) return { canRon: false, canPon: null, canMinkan: null, chiOptions: [] };
  const discardTile = window.discardTile;
  const hand = round.players[HUMAN].hand;

  const canRon = !!canDeclareRon(round, HUMAN, discardTile.code, window.discarderIndex, window.isChankan);
  if (window.isChankan) return { canRon, canPon: null, canMinkan: null, chiOptions: [] };
  // リーチ後は手牌が固定されるため、チー/ポン/カンは選べない（ロンのみ）。
  if (round.players[HUMAN].riichi) return { canRon, canPon: null, canMinkan: null, chiOptions: [] };

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

  const chiOptions: HumanCallOptions["chiOptions"] = [];
  const isNextSeat = ((window.discarderIndex + 1) % 4) === HUMAN;
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

interface GameStoreState {
  match: MatchState | null;
  humanCallOptions: HumanCallOptions | null;
  pendingRoundEnd: boolean;
  lastRoundOutcome: RoundScoreOutcome | null;
  /** カード「点棒吸収」等、RoundState.pendingScoreAdjustmentが検知される
      たびにapplyRoundUpdateが更新する一発イベント。keyは検知のたびに
      増分し、ScoreAdjustmentOverlay.tsx側がその変化を見て「今まさに
      増減が起きた」ことを検知し、演出（吸収エフェクト）を出す。値そのもの
      は次のイベントまで残り続ける（nullに戻さない）ため、UI側はkeyの
      変化だけを見る必要がある。 */
  lastScoreAdjustment: { delta: [number, number, number, number]; key: number } | null;
  /** デバッグモード: CPUが和了せず（常にツモ切り/スキップ）、巻き戻しが可能。 */
  debugMode: boolean;
  /** デバッグモード中のCPU手番の速さ。fast=ほぼ即時、normal=通常対局と同じ速さ。 */
  debugSpeed: "fast" | "normal";
  /** true の間はCPUの手番・応答の自動進行を止める（巻き戻した直後に自動で
      先の局面へ進んでしまい「巻き戻せない」ように見えるのを防ぐため）。
      人間側の操作（打牌・鳴き等）はこのフラグに関係なく常に受け付ける。 */
  debugPaused: boolean;
  /** 巻き戻し用の局面スナップショット（新しいものが末尾）。デバッグモード中のみ蓄積する。 */
  history: MatchState[];
  /** 席ごとのCPU難易度（1〜5）。対局開始時に固定され、対局中は変わらない。 */
  cpuDifficulty: CpuDifficultySettings;
  startMatch: (
    format: MatchFormat,
    debugMode?: boolean,
    cpuDifficulty?: CpuDifficultySettings,
    humanCharacterId?: string,
    continueBelowZero?: boolean,
    humanCardId?: string,
    /** 各CPU席のキャラクター指定。要素がnull/undefinedの席はランダムのまま。
        index 0(自分)は無視される。 */
    cpuCharacterIds?: [string | null, string | null, string | null, string | null],
  ) => void;
  debugSetSpeed: (speed: "fast" | "normal") => void;
  debugTogglePause: () => void;
  humanDiscard: (tileId: string) => void;
  humanRiichi: (tileId: string) => void;
  humanTsumo: () => void;
  humanAnkan: (tileCode: TileCode) => void;
  humanKakan: (tileId: string) => void;
  humanKyushuKyuhai: () => void;
  humanUseSkill: () => void;
  humanBorrowSkill: (target: PlayerIndex) => void;
  humanRetrieveDiscard: (reclaimTileId: string, replacementTileId: string) => void;
  humanUseCard: () => void;
  humanSwapTiles: (tileIds: string[]) => void;
  humanCall: (action: GameAction) => void;
  humanSkip: () => void;
  acknowledgeRoundEnd: () => void;
  backToTitle: () => void;
  debugRewind: () => void;
}

/** デバッグモード中のみ、変更前の局面をスナップショットとして履歴に積む。 */
function pushHistory(state: GameStoreState): MatchState[] {
  if (!state.debugMode || !state.match) return state.history;
  const next = [...state.history, state.match];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** lastScoreAdjustmentのkey採番用。値そのものより「増えたかどうか」だけが
    ScoreAdjustmentOverlay.tsx側の検知条件のため、単調増加すれば方式は何でもよい。 */
let scoreAdjustmentKeySeq = 0;

function applyRoundUpdate(
  get: () => GameStoreState,
  set: (s: Partial<GameStoreState>) => void,
  round: RoundState,
  riichiPlayer?: PlayerIndex,
) {
  const state = get();
  if (!state.match) return;
  let scores = state.match.scores;
  if (riichiPlayer !== undefined) {
    scores = scores.map((s, i) => (i === riichiPlayer ? s - RIICHI_STICK_COST : s)) as [number, number, number, number];
  }
  // カード「点棒吸収」等、RoundState側から即座の点数増減を要求された場合、
  // ここで検知してmatch.scoresへ反映する（RoundState自体は点数を持たないため）。
  // lastScoreAdjustmentにも記録し、ScoreAdjustmentOverlay.tsxが「吸収した」
  // 演出を出すきっかけに使う。
  let nextRound = round;
  let lastScoreAdjustment = state.lastScoreAdjustment;
  if (round.pendingScoreAdjustment) {
    const adjustment = round.pendingScoreAdjustment;
    scores = scores.map((s, i) => s + adjustment[i]!) as [number, number, number, number];
    nextRound = { ...round, pendingScoreAdjustment: null };
    scoreAdjustmentKeySeq += 1;
    lastScoreAdjustment = { delta: adjustment, key: scoreAdjustmentKeySeq };
  }
  set({
    history: pushHistory(state),
    match: { ...state.match, round: nextRound, scores },
    humanCallOptions: canHumanRespond(nextRound) ? computeHumanCallOptions(nextRound) : null,
    lastScoreAdjustment,
  });
  scheduleTick(get, set);
}

function scheduleTick(get: () => GameStoreState, set: (s: Partial<GameStoreState>) => void, delay = 0) {
  setTimeout(() => tick(get, set), delay);
}

/**
 * ルナの必殺技「運命の采配」でCPU(座席1〜3)が獲得した配牌入れ替え権を、
 * 配牌直後にまとめて自動消化する。人間(座席0)は自分でUI操作して使うため対象外。
 * 交換は権利の残り枚数ぶんを1回のアクションでまとめて同時に行う仕様。
 */
function resolveCpuTileSwaps(round: RoundState): RoundState {
  let next = round;
  for (const seat of [1, 2, 3] as PlayerIndex[]) {
    if (!canSwapStartingTile(next, seat)) continue;
    const tileIds = decideTileSwaps(next, seat, next.players[seat].tileSwapsRemaining);
    if (tileIds.length === 0) continue;
    next = applyAction(next, { type: "swapTiles", player: seat, tileIds });
  }
  return next;
}

/**
 * ユーザー操作由来のアクション適用をtry/catchで包む。UIが表示していた選択肢は
 * ストアの自動ティック（例:応答不要時の自動スキップ）と非同期に競合することがあり、
 * その場合コアエンジンが「応答対象ではありません」等の例外を投げる。その操作だけ
 * 静かに無視し、ゲーム全体をクラッシュさせないようにする。
 */
function safeDispatch(
  get: () => GameStoreState,
  set: (s: Partial<GameStoreState>) => void,
  build: () => RoundState,
  riichiPlayer?: PlayerIndex,
) {
  try {
    applyRoundUpdate(get, set, build(), riichiPlayer);
  } catch (err) {
    console.error("[majyan] 操作を無視しました（状態が既に進行していた可能性があります）:", err);
  }
}

function tick(get: () => GameStoreState, set: (s: Partial<GameStoreState>) => void) {
  const state = get();
  if (!state.match || state.pendingRoundEnd) return;
  // 一時停止中は（人間の手番かどうかによらず）一切自動進行させない。
  // これがないと、巻き戻した先がちょうど「これから誰かがツモる直前」の
  // 局面だった場合にツモ処理だけは一時停止を無視して即座に進んでしまい、
  // 巻き戻した直後にまた元の局面へ戻ってしまう（＝巻き戻りが効かないように
  // 見える）不具合になる。
  if (state.debugMode && state.debugPaused) return;
  const round = state.match.round;

  if (round.phase === "round-over") {
    const outcome = computeRoundScoreOutcome(round);
    const rawScores = state.match.scores.map((s, i) => s + outcome.scoreDeltas[i]!) as [number, number, number, number];
    // カード「箱割れ防止」: このタイミングで既に0点未満へ落ちている座席を、
    // 実際に箱割れ判定・結果画面へ反映する前に救済する。カード自体の消費状態
    // （cardUsesRemaining）は次局へ持ち越す必要があるため、更新後のroundも
    // 一緒に受け取り、以降はこのroundを使う。
    const { round: guardedRound, scores } = applyCardBustGuards(round, rawScores);
    // この局が対局全体の最終局だった場合はここでfinishedを立てておく。
    // acknowledgeRoundEnd（「次の局へ」ボタン）任せにすると、最終局の結果画面
    // 表示中はまだfinishedがfalseのままボタンが「次の局へ」表記になってしまい、
    // 押した瞬間にpendingRoundEndごと消えて順位表を見せずに終わっていた。
    const result = round.result!;
    const keepKyotaku = result.type !== "tsumo" && result.type !== "ron";
    const plan = planNextRound(round, state.match.format, result.dealerContinues, keepKyotaku);
    // 箱下続行ルール(continueBelowZero)がオフの場合、誰かが箱割れ（0点未満）に
    // なった時点で、通常の局数を消化しきっていなくても即座に対局終了とする。
    const busted = !state.match.continueBelowZero && hasBustedPlayer(scores);
    const finished = plan.matchOver || busted;
    // 対局がここで終わる場合、plan.kyotaku（本来は次局へ持ち越すはずだった
    // 供託）の行き先となる次局はもう無い。清算しないと対局全体の点数合計が
    // 供託ぶんだけ静かに目減りしてしまう（settleLeftoverKyotakuのコメント参照）。
    // カード「起死回生」等、対局終了時にだけ点数を調整するパッシブ効果。
    // 対局が終わらない局の変わり目では適用しない（settledScores同様finished限定）。
    const settledScores = finished
      ? applyCardMatchEndBonuses(guardedRound, resolveKyotakuWithCard(guardedRound, scores, plan.kyotaku, settleLeftoverKyotaku))
      : scores;
    set({
      match: { ...state.match, round: guardedRound, scores: settledScores, finished },
      pendingRoundEnd: true,
      lastRoundOutcome: outcome,
      humanCallOptions: null,
    });
    return;
  }

  if (round.phase === "awaiting-draw") {
    // 必殺技「時間停止」のボーナス手番（打牌解決の瞬間、次家に手番を渡さず
    // そのまま発動者自身がもう一度ツモる。gameEngine.tsのresolveDiscardTurnTransition
    // 参照）は、実際には他家の手番を一切挟まないため、即座にツモってしまうと
    // 「連続で自分だけが動いた」ようにしか見えない。他家3人ぶんの「手番が
    // 来たかのような」空振り演出（nameplate--fake-turn、styles.css参照）が
    // 一巡ぶん見える時間だけ、わざと実際のツモを遅らせる。
    if (round.players[round.currentTurn].timeStopTurnsRemaining > 0) {
      const delay =
        state.debugMode && state.debugSpeed === "fast" ? DEBUG_CPU_THINK_DELAY_MS : TIME_STOP_FAKE_TURN_STEP_MS * 3;
      setTimeout(() => {
        const s2 = get();
        if (!s2.match) return;
        if (s2.debugMode && s2.debugPaused) return;
        const r2 = s2.match.round;
        if (r2.phase !== "awaiting-draw" || r2.currentTurn !== round.currentTurn) return;
        const next = applyAction(r2, { type: "draw", player: r2.currentTurn });
        applyRoundUpdate(get, set, next);
      }, delay);
      return;
    }
    const next = applyAction(round, { type: "draw", player: round.currentTurn });
    applyRoundUpdate(get, set, next);
    return;
  }

  if (round.phase === "awaiting-discard") {
    if (round.currentTurn === HUMAN) {
      // リーチ後は打つ牌を選べない（ツモ切り強制）。ツモ和了・待ちを変えない
      // 暗槓・必殺技という「本当に選べる余地」が無い時だけ、CPUと同じ間合いで
      // 自動的にツモ切りする（毎回クリックさせるのは冗長との指摘のため）。
      const player = round.players[HUMAN];
      if (!player.riichi) return;
      const hasRealChoice =
        !!canDeclareTsumo(round, HUMAN) ||
        ankanOptions(round, HUMAN).length > 0 ||
        canUseSkill(round, HUMAN) ||
        borrowableSkillTargets(round, HUMAN).length > 0;
      if (hasRealChoice) return;
      const thinkDelay = state.debugMode && state.debugSpeed === "fast" ? DEBUG_CPU_THINK_DELAY_MS : CPU_THINK_DELAY_MS;
      setTimeout(() => {
        const s2 = get();
        if (!s2.match) return;
        if (s2.debugMode && s2.debugPaused) return;
        const r2 = s2.match.round;
        if (r2.phase !== "awaiting-discard" || r2.currentTurn !== HUMAN || !r2.players[HUMAN].riichi) return;
        if (
          canDeclareTsumo(r2, HUMAN) ||
          ankanOptions(r2, HUMAN).length > 0 ||
          canUseSkill(r2, HUMAN) ||
          borrowableSkillTargets(r2, HUMAN).length > 0
        )
          return;
        const next = applyAction(r2, { type: "discard", player: HUMAN, tileId: r2.lastDrawnTile!.id, tsumogiri: true });
        applyRoundUpdate(get, set, next);
      }, thinkDelay);
      return;
    }
    const thinkDelay = state.debugMode && state.debugSpeed === "fast" ? DEBUG_CPU_THINK_DELAY_MS : CPU_THINK_DELAY_MS;
    setTimeout(() => {
      const s2 = get();
      if (!s2.match) return;
      if (s2.debugMode && s2.debugPaused) return;
      const r2 = s2.match.round;
      if (r2.phase !== "awaiting-discard" || r2.currentTurn !== round.currentTurn) return;
      // ゲージが満タンなら、打牌前に必ず必殺技を使う（CPU側の判断はまだ
      // 単純で「使えるなら即使う」だけ。駆け引きの調整は今後の課題）。
      // ただし今引いた牌がそのままツモ和了になる場合は別。canUseSkillは
      // 「ツモできるかどうか」を見ていないため、そこを確認せずに発動して
      // しまうと、ナギ/ライコのように自摸牌をすり替えるタイプの必殺技が
      // 和了牌そのものを山に戻して引き直してしまい、リーチ中でも和了を
      // 逃す（＝ユーザーには「バグった」ように見える）。ツモできる時は
      // 必殺技より和了を優先する。
      // canUseSkillがtrueを返している以上applyActionが失敗することは無い
      // はずだが、ここで想定外の例外が飛ぶとtick()の呼び出し元
      // (setTimeoutコールバック)がそこで静かに止まり、以降どのプレイヤーの
      // 手番も一切進まなくなる（＝対局がフリーズしたように見える）。
      // 人間操作側のsafeDispatchと同様、ここも1手ぶんだけ無視して
      // 対局を止めないようにする。
      // 発動は打牌と別のstate更新として反映する（applyRoundUpdateを
      // ここで一度呼んで即returnする）。以前は同じtick内で打牌までまとめて
      // 1回のset()にしていたため、発動でゲージが0になった瞬間がReactの
      // 状態に一度も現れず（すぐ次の打牌でまたゲージが加算された最終結果
      // しか見えない）、SkillActivationOverlayの「満タン(>0)から0への低下」
      // 検知が発火しないまま演出が出ない不具合になっていた
      // （ルナだけ次局までゲージが凍結されるため、たまたま0のまま観測できて
      // 演出が見えていた）。
      if (!canDeclareTsumo(r2, r2.currentTurn) && canUseSkill(r2, r2.currentTurn)) {
        try {
          const activated = applyAction(r2, { type: "useSkill", player: r2.currentTurn });
          applyRoundUpdate(get, set, activated);
          return;
        } catch (err) {
          console.error("[majyan] CPUの必殺技発動を無視しました:", err);
        }
      }
      // カリンの「借り物競争」。CPU側の判断は他の必殺技と同じく単純に
      // 「借りられるなら即、選べる中の先頭の相手から借りる」だけ。
      if (!canDeclareTsumo(r2, r2.currentTurn)) {
        const targets = borrowableSkillTargets(r2, r2.currentTurn);
        if (targets.length > 0) {
          try {
            const activated = applyAction(r2, { type: "borrowSkill", player: r2.currentTurn, target: targets[0]! });
            applyRoundUpdate(get, set, activated);
            return;
          } catch (err) {
            console.error("[majyan] CPUの借り物競争発動を無視しました:", err);
          }
        }
      }
      // ミオの「取り返し」。CPU側は「河から取り返せる牌ごとに、手牌に戻して
      // 何を切り直せば一番シャンテンが良くなるか」を全探索し、現状より
      // 実際に改善する組み合わせがある時だけ使う（改善しないなら空撃ちせず
      // 見送る＝ゲージを無駄にしない）。
      if (!canDeclareTsumo(r2, r2.currentTurn)) {
        const character = CHARACTERS[r2.characterIds[r2.currentTurn]];
        if (character?.retrievesDiscard) {
          const p = r2.players[r2.currentTurn];
          const currentShanten = calcShanten(p.hand);
          let best: { reclaimTileId: string; replacementTileId: string; shanten: number } | null = null;
          for (const reclaimTileId of reclaimableDiscardTileIds(r2, r2.currentTurn)) {
            const reclaimed = p.discards.find((d) => d.tile.id === reclaimTileId)!.tile;
            const candidateConcealed = [...p.hand.concealed, reclaimed];
            for (const t of candidateConcealed) {
              if (t.id === reclaimed.id) continue; // 戻した牌をそのまま切り直すのは無意味
              const trial = { concealed: candidateConcealed.filter((x) => x.id !== t.id), melds: p.hand.melds };
              const shanten = calcShanten(trial);
              if (!best || shanten < best.shanten) best = { reclaimTileId, replacementTileId: t.id, shanten };
            }
          }
          if (best && best.shanten < currentShanten) {
            try {
              const activated = applyAction(r2, {
                type: "retrieveDiscard",
                player: r2.currentTurn,
                reclaimTileId: best.reclaimTileId,
                replacementTileId: best.replacementTileId,
              });
              applyRoundUpdate(get, set, activated);
              return;
            } catch (err) {
              console.error("[majyan] CPUの取り返し発動を無視しました:", err);
            }
          }
        }
      }
      // カードもCPUを含む全席が対象。判断はまだ単純に「使えるなら即使う」だけ
      // （必殺技と同じ考え方。駆け引きの調整は今後の課題）。
      if (!canDeclareTsumo(r2, r2.currentTurn) && canUseCard(r2, r2.currentTurn)) {
        try {
          const activated = applyAction(r2, { type: "useCard", player: r2.currentTurn });
          applyRoundUpdate(get, set, activated);
          return;
        } catch (err) {
          console.error("[majyan] CPUのカード使用を無視しました:", err);
        }
      }
      let action = decideTurnAction(r2, r2.currentTurn, s2.cpuDifficulty[r2.currentTurn]);
      if (s2.debugMode && action.type === "tsumo") {
        // デバッグモード中はCPUに和了させず、ツモ切りで手番を続行させる。
        action = { type: "discard", player: r2.currentTurn, tileId: r2.lastDrawnTile!.id, tsumogiri: true };
      }
      const next = applyAction(r2, action);
      // カード「ノーコストリーチ」: 未消費なら供託の1000点減点自体を起こさない。
      const freeRiichi =
        action.type === "riichi" && r2.cardIds[r2.currentTurn] === "no-cost-riichi" && r2.cardUsesRemaining[r2.currentTurn] > 0;
      applyRoundUpdate(get, set, next, action.type === "riichi" && !freeRiichi ? r2.currentTurn : undefined);
    }, thinkDelay);
    return;
  }

  if (round.phase === "awaiting-calls") {
    const window = round.pendingCallWindow!;
    const next = window.awaitingPlayers.find((p) => !window.respondedBy.includes(p));
    if (next === undefined) return; // 解決待ち（次のtickで解消される想定だが念のため）

    if (next === HUMAN) {
      const options = computeHumanCallOptions(round);
      const hasAnyOption = options.canRon || options.canPon || options.canMinkan || options.chiOptions.length > 0;
      if (!hasAnyOption) {
        const nextRound = applyAction(round, { type: "skip", player: HUMAN });
        applyRoundUpdate(get, set, nextRound);
      }
      // 選択肢がある場合はUI側の応答を待つ（humanCallOptions は既にセット済み）
      return;
    }

    const thinkDelay = state.debugMode && state.debugSpeed === "fast" ? DEBUG_CPU_THINK_DELAY_MS : CPU_THINK_DELAY_MS;
    setTimeout(() => {
      const s2 = get();
      if (!s2.match) return;
      if (s2.debugMode && s2.debugPaused) return;
      const r2 = s2.match.round;
      if (r2.phase !== "awaiting-calls" || !r2.pendingCallWindow) return;
      const stillWaiting = r2.pendingCallWindow.awaitingPlayers.includes(next) && !r2.pendingCallWindow.respondedBy.includes(next);
      if (!stillWaiting) return;
      let action = decideCallResponse(r2, next, s2.cpuDifficulty[next]);
      if (s2.debugMode && action.type === "ron") {
        // デバッグモード中はCPUにロンさせず、見送らせる。
        action = { type: "skip", player: next };
      }
      const nextRound = applyAction(r2, action);
      applyRoundUpdate(get, set, nextRound);
    }, thinkDelay);
  }
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  match: null,
  humanCallOptions: null,
  pendingRoundEnd: false,
  lastRoundOutcome: null,
  lastScoreAdjustment: null,
  debugMode: false,
  debugSpeed: "fast",
  debugPaused: false,
  history: [],
  cpuDifficulty: DEFAULT_CPU_DIFFICULTY,

  debugSetSpeed: (speed) => set({ debugSpeed: speed }),

  debugTogglePause: () => {
    const state = get();
    const nextPaused = !state.debugPaused;
    set({ debugPaused: nextPaused });
    if (!nextPaused) scheduleTick(get, set);
  },

  startMatch: (
    format,
    debugMode = false,
    cpuDifficulty = DEFAULT_CPU_DIFFICULTY,
    humanCharacterId,
    continueBelowZero = false,
    humanCardId,
    cpuCharacterIds,
  ) => {
    // 全席まずランダムで割り当て、自分・CPUそれぞれ選んだ席だけ上書きする
    // （未選択の席はランダムのまま）。
    const characterIds = randomCharacterIds();
    if (humanCharacterId) characterIds[HUMAN] = humanCharacterId;
    for (const seat of [1, 2, 3] as PlayerIndex[]) {
      const chosen = cpuCharacterIds?.[seat];
      if (chosen) characterIds[seat] = chosen;
    }
    // 人間は選択したカード（未選択ならカード無し）、CPU3人は必ずランダムで
    // 1枚を持たせる（「なし」は無い）。
    const cardIds: [string | null, string | null, string | null, string | null] = [
      humanCardId ?? null,
      randomCardId(),
      randomCardId(),
      randomCardId(),
    ];
    const match = createMatch(format, Math.random, characterIds, continueBelowZero, cardIds);
    set({
      match,
      pendingRoundEnd: false,
      lastRoundOutcome: null,
      humanCallOptions: null,
      debugMode,
      debugSpeed: "fast",
      debugPaused: false,
      history: [],
      cpuDifficulty,
    });
    scheduleTick(get, set);
  },

  humanDiscard: (tileId) => {
    const state = get();
    if (!state.match) return;
    const round = state.match.round;
    safeDispatch(get, set, () => applyAction(round, { type: "discard", player: HUMAN, tileId, tsumogiri: tileId === round.lastDrawnTile?.id }));
  },

  humanRiichi: (tileId) => {
    const state = get();
    if (!state.match) return;
    const round = state.match.round;
    // カード「ノーコストリーチ」: 未消費なら供託の1000点減点自体を起こさない
    // （riichiPlayerを渡さない。round側もkyotakuを積まないためゼロサムは保たれる）。
    const freeRiichi = round.cardIds[HUMAN] === "no-cost-riichi" && round.cardUsesRemaining[HUMAN] > 0;
    safeDispatch(get, set, () => applyAction(round, { type: "riichi", player: HUMAN, tileId }), freeRiichi ? undefined : HUMAN);
  },

  humanTsumo: () => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "tsumo", player: HUMAN }));
  },

  humanAnkan: (tileCode) => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "ankan", player: HUMAN, tileCode }));
  },

  humanKakan: (tileId) => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "kakan", player: HUMAN, tileId }));
  },

  humanKyushuKyuhai: () => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "kyushukyuhai", player: HUMAN }));
  },

  humanUseSkill: () => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "useSkill", player: HUMAN }));
  },

  humanBorrowSkill: (target) => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "borrowSkill", player: HUMAN, target }));
  },

  humanRetrieveDiscard: (reclaimTileId, replacementTileId) => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () =>
      applyAction(state.match!.round, { type: "retrieveDiscard", player: HUMAN, reclaimTileId, replacementTileId }),
    );
  },

  humanUseCard: () => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "useCard", player: HUMAN }));
  },

  humanSwapTiles: (tileIds) => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "swapTiles", player: HUMAN, tileIds }));
  },

  humanCall: (action) => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, action));
  },

  humanSkip: () => {
    const state = get();
    if (!state.match) return;
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "skip", player: HUMAN }));
  },

  acknowledgeRoundEnd: () => {
    const state = get();
    // 対局終了時はボタンが「タイトルへ戻る」(backToTitle)に切り替わっており
    // このメソッドは呼ばれない想定だが、念のため二重呼び出しをガードしておく。
    if (!state.match || !state.match.round.result || state.match.finished) return;
    const round = state.match.round;
    const result = round.result!;
    const keepKyotaku = result.type !== "tsumo" && result.type !== "ron";
    const roundKyotakuAfter = result.type === "tsumo" || result.type === "ron" ? 0 : round.kyotaku;

    const plan = planNextRound(round, state.match.format, result.dealerContinues, keepKyotaku);
    // 対局終了(plan.matchOver)は既にtick()側でmatch.finishedとして反映済みのため
    // ここに到達する時点では常にfalseのはずだが、念のため防御しておく。
    if (plan.matchOver) {
      const settledScores = applyCardMatchEndBonuses(
        round,
        resolveKyotakuWithCard(round, state.match.scores, plan.kyotaku, settleLeftoverKyotaku),
      );
      set({ match: { ...state.match, scores: settledScores, finished: true }, pendingRoundEnd: false });
      return;
    }
    // 必殺技ゲージは半荘/東風戦を通して持ち越す（局をまたいでリセットしない）。
    const carriedGauges = round.players.map((p) => p.skillGauge) as [number, number, number, number];
    const carriedTileSwaps = round.players.map((p) => p.pendingTileSwapNextRound) as [boolean, boolean, boolean, boolean];
    // ナオキの「クマクマタイム」等が見る「自分の和了による連荘か」。
    // 本場が付く連荘には荒牌流局の親テンパイ継続・九種九牌流局も含まれる
    // ため、resultの種別まで見て区別する（RoundState.dealerRenchanByWin参照）。
    const dealerWonRenchan = result.dealerContinues && (result.type === "tsumo" || result.type === "ron");
    let nextRound = dealNewRound(
      plan.roundWind,
      plan.roundNumber,
      plan.honba,
      roundKyotakuAfter,
      plan.dealerSeat,
      Math.random,
      round.characterIds,
      carriedGauges,
      carriedTileSwaps,
      dealerWonRenchan,
      round.cardIds,
      round.cardUsesRemaining,
      round.cardNegateArmed,
      state.match.format,
    );
    nextRound = resolveCpuTileSwaps(nextRound);
    set({ match: { ...state.match, round: nextRound }, pendingRoundEnd: false, lastRoundOutcome: null, humanCallOptions: null });
    scheduleTick(get, set);
  },

  backToTitle: () => {
    set({
      match: null,
      pendingRoundEnd: false,
      lastRoundOutcome: null,
      humanCallOptions: null,
      debugMode: false,
      debugSpeed: "fast",
      debugPaused: false,
      history: [],
      cpuDifficulty: DEFAULT_CPU_DIFFICULTY,
    });
  },

  debugRewind: () => {
    const state = get();
    if (!state.debugMode || state.history.length === 0) return;
    const prevMatch = state.history[state.history.length - 1]!;
    set({
      match: prevMatch,
      history: state.history.slice(0, -1),
      pendingRoundEnd: false,
      lastRoundOutcome: null,
      humanCallOptions: canHumanRespond(prevMatch.round) ? computeHumanCallOptions(prevMatch.round) : null,
      // 巻き戻した直後にCPUの自動進行（tick内のツモ等）が即座に先へ進めて
      // しまい「巻き戻せない」ように見える不具合を防ぐため、巻き戻した瞬間は
      // 自動進行を一時停止する。続きを進めたい場合はユーザーが一時停止解除
      // ボタンを押す。
      debugPaused: true,
    });
    scheduleTick(get, set);
  },
}));
