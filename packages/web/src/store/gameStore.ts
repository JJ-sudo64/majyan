import { create } from "zustand";
import {
  applyAction,
  canDeclareRon,
  computeRoundScoreOutcome,
  createMatch,
  dealNewRound,
  decideCallResponse,
  decideTurnAction,
  planNextRound,
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

export interface HumanCallOptions {
  canRon: boolean;
  canPon: [string, string] | null;
  canMinkan: [string, string, string] | null;
  chiOptions: { tileCodes: [TileCode, TileCode, TileCode]; usedHandTileIds: [string, string] }[];
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

  const canRon = !!canDeclareRon(round, HUMAN, discardTile.code, window.isChankan);
  if (window.isChankan) return { canRon, canPon: null, canMinkan: null, chiOptions: [] };

  const matches = hand.concealed.filter((t) => t.code === discardTile.code);
  const canPon = matches.length >= 2 ? ([matches[0]!.id, matches[1]!.id] as [string, string]) : null;
  const canMinkan = matches.length >= 3 ? ([matches[0]!.id, matches[1]!.id, matches[2]!.id] as [string, string, string]) : null;

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
        const codes = [discardTile.code, ta.code, tb.code].sort((x, y) => Number(x[0]) - Number(y[0])) as [TileCode, TileCode, TileCode];
        chiOptions.push({ tileCodes: codes, usedHandTileIds: [ta.id, tb.id] });
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
  startMatch: (format: MatchFormat, debugMode?: boolean, cpuDifficulty?: CpuDifficultySettings) => void;
  debugSetSpeed: (speed: "fast" | "normal") => void;
  debugTogglePause: () => void;
  humanDiscard: (tileId: string) => void;
  humanRiichi: (tileId: string) => void;
  humanTsumo: () => void;
  humanAnkan: (tileCode: TileCode) => void;
  humanKakan: (tileId: string) => void;
  humanKyushuKyuhai: () => void;
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

function applyRoundUpdate(
  get: () => GameStoreState,
  set: (s: Partial<GameStoreState>) => void,
  round: RoundState,
  riichiPlayer?: PlayerIndex,
) {
  const state = get();
  if (!state.match) return;
  const scores = state.match.scores;
  const nextScores: [number, number, number, number] =
    riichiPlayer !== undefined
      ? (scores.map((s, i) => (i === riichiPlayer ? s - RIICHI_STICK_COST : s)) as [number, number, number, number])
      : scores;
  set({
    history: pushHistory(state),
    match: { ...state.match, round, scores: nextScores },
    humanCallOptions: canHumanRespond(round) ? computeHumanCallOptions(round) : null,
  });
  scheduleTick(get, set);
}

function scheduleTick(get: () => GameStoreState, set: (s: Partial<GameStoreState>) => void, delay = 0) {
  setTimeout(() => tick(get, set), delay);
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
    const scores = state.match.scores.map((s, i) => s + outcome.scoreDeltas[i]!) as [number, number, number, number];
    set({ match: { ...state.match, scores }, pendingRoundEnd: true, lastRoundOutcome: outcome, humanCallOptions: null });
    return;
  }

  if (round.phase === "awaiting-draw") {
    const next = applyAction(round, { type: "draw", player: round.currentTurn });
    applyRoundUpdate(get, set, next);
    return;
  }

  if (round.phase === "awaiting-discard") {
    if (round.currentTurn === HUMAN) return;
    const thinkDelay = state.debugMode && state.debugSpeed === "fast" ? DEBUG_CPU_THINK_DELAY_MS : CPU_THINK_DELAY_MS;
    setTimeout(() => {
      const s2 = get();
      if (!s2.match) return;
      if (s2.debugMode && s2.debugPaused) return;
      const r2 = s2.match.round;
      if (r2.phase !== "awaiting-discard" || r2.currentTurn !== round.currentTurn) return;
      let action = decideTurnAction(r2, r2.currentTurn, s2.cpuDifficulty[r2.currentTurn]);
      if (s2.debugMode && action.type === "tsumo") {
        // デバッグモード中はCPUに和了させず、ツモ切りで手番を続行させる。
        action = { type: "discard", player: r2.currentTurn, tileId: r2.lastDrawnTile!.id, tsumogiri: true };
      }
      const next = applyAction(r2, action);
      applyRoundUpdate(get, set, next, action.type === "riichi" ? r2.currentTurn : undefined);
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

  startMatch: (format, debugMode = false, cpuDifficulty = DEFAULT_CPU_DIFFICULTY) => {
    const match = createMatch(format);
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
    safeDispatch(get, set, () => applyAction(state.match!.round, { type: "riichi", player: HUMAN, tileId }), HUMAN);
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
    if (!state.match || !state.match.round.result) return;
    const round = state.match.round;
    const result = round.result!;
    const keepKyotaku = result.type !== "tsumo" && result.type !== "ron";
    const roundKyotakuAfter = result.type === "tsumo" || result.type === "ron" ? 0 : round.kyotaku;

    const plan = planNextRound(round, state.match.format, result.dealerContinues, keepKyotaku);
    if (plan.matchOver) {
      set({ match: { ...state.match, finished: true }, pendingRoundEnd: false });
      return;
    }
    const nextRound = dealNewRound(plan.roundWind, plan.roundNumber, plan.honba, roundKyotakuAfter, plan.dealerSeat);
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
