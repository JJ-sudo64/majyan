import { create } from "zustand";
import { onlineLink } from "../online/onlineLink.js";
import {
  advanceToNextRound,
  applyMatchAction,
  autoActionForHuman,
  computeSeatOptions,
  createMatch,
  decideCpuCallResponse,
  decideCpuTurnAction,
  pendingDecision,
  randomCardId,
  randomCharacterIds,
  fromViewerSeat,
  redactMatchForSeat,
  replayRoundFrames,
  rotateMatchForViewer,
  rotateOutcomeForViewer,
  settleRound,
  shareUnchanged,
  DEFAULT_AI_DIFFICULTY,
  type AiDifficulty,
  type ClockDisplay,
  type GameAction,
  type MatchActionResult,
  type MatchFormat,
  type MatchState,
  type OnlineSeatView,
  type PendingDecision,
  type PlayerIndex,
  type ReplayResponse,
  type ReplayRoundFrames,
  type RoundScoreOutcome,
  type RoundState,
  type SeatInfo,
  type SeatOptions,
  type TileCode,
} from "@majyan/core";

const HUMAN: PlayerIndex = 0;
/** 配牌入れ替え権を自動消化させる座席（＝CPU席）。 */
const CPU_SEATS: readonly PlayerIndex[] = [1, 2, 3];
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

export type HumanCallOptions = NonNullable<SeatOptions["call"]>;
export type HumanTurnOptions = NonNullable<SeatOptions["turn"]>;

/**
 * 本物の対局状態から、画面に渡す「自分の席から見える版」を作る。
 * 他家の手牌や山の中身は伏せ（redactMatchForSeat）、自分が選べる操作は
 * 本物の状態から計算しておく（伏せた状態では山や他家を見る判定が狂うため）。
 * ネット対戦ではこの計算がサーバー側に移り、画面は同じ形のデータを受け取る。
 */
function viewStateFor(full: MatchState | null): Pick<GameStoreState, "fullMatch" | "match" | "humanOptions" | "humanCallOptions"> {
  if (!full) return { fullMatch: null, match: null, humanOptions: null, humanCallOptions: null };
  const options = computeSeatOptions(full.round, HUMAN);
  return { fullMatch: full, match: redactMatchForSeat(full, HUMAN), humanOptions: options, humanCallOptions: options.call };
}

/** 牌譜の再生中の状態。 */
export interface ReplayState {
  data: ReplayResponse;
  /** どの席の視点で見ているか（本物の座席番号）。 */
  viewer: PlayerIndex;
  /** 全員の手牌を表で見せるか。 */
  revealAll: boolean;
  roundIndex: number;
  /** stops内の位置。stops.lengthと同じ値は結果画面（局が最後まで終わっている時だけ）。 */
  step: number;
  frames: ReplayRoundFrames;
  /** 1手ずつ進める時に止まる局面（frames.statesの添字）。ツモと「鳴かない」の応答は
      見た目がほとんど変わらないので飛ばし、打牌・鳴き・和了などで止まる。 */
  stops: number[];
}

const NO_OPTIONS: SeatOptions = { turn: null, call: null, canSwapStartingTile: false };

/** 牌譜の1局ぶんで進められる最後のstep。 */
export function replayLastStep(r: ReplayState): number {
  return r.stops.length - 1 + (r.frames.settled ? 1 : 0);
}

function replayStops(data: ReplayResponse, roundIndex: number, frames: ReplayRoundFrames): number[] {
  const actions = data.rounds[roundIndex]!.actions;
  const stops = [0];
  for (let i = 1; i < frames.states.length; i++) {
    const type = actions[i - 1]!.type;
    if ((type !== "draw" && type !== "skip") || i === frames.states.length - 1) stops.push(i);
  }
  return stops;
}

/** 牌譜の今のstepを、画面に渡す状態（見ている席を0番に回した版）にする。 */
function replayViewState(r: ReplayState): Partial<GameStoreState> {
  const showResult = !!r.frames.settled && r.step >= r.stops.length;
  const base = showResult ? r.frames.settled!.match : r.frames.states[r.stops[Math.min(r.step, r.stops.length - 1)]!]!;
  let match = rotateMatchForViewer(r.revealAll ? base : redactMatchForSeat(base, r.viewer), r.viewer);
  // 他家の手牌は「自分に公開されている」時だけ表で描くので、全員表示ではその印を付ける。
  if (r.revealAll) match = { ...match, round: { ...match.round, handsRevealedTo: HUMAN } };
  const onlineSeats = ([0, 1, 2, 3] as PlayerIndex[]).map((i): SeatInfo => {
    const seat = r.data.seats[fromViewerSeat(i, r.viewer)]!;
    return { name: seat.name, rankLabel: null, isCpu: seat.isCpu, disconnected: false };
  });
  return {
    replay: r,
    online: false,
    fullMatch: null,
    match,
    humanOptions: NO_OPTIONS,
    humanCallOptions: null,
    pendingRoundEnd: showResult,
    lastRoundOutcome: showResult ? rotateOutcomeForViewer(r.frames.settled!.outcome, r.viewer) : null,
    onlineSeats,
    clock: null,
    debugMode: false,
    history: [],
  };
}

function replayAtRound(data: ReplayResponse, roundIndex: number, viewer: PlayerIndex, revealAll: boolean): ReplayState {
  const frames = replayRoundFrames(data.rounds[roundIndex]!);
  return { data, viewer, revealAll, roundIndex, step: 0, frames, stops: replayStops(data, roundIndex, frames) };
}

interface GameStoreState {
  /** 本物の対局状態（他家の手牌・山を含む）。進行ロジック専用で、画面の
      コンポーネントからは読まないこと（読むなら下のmatch）。 */
  fullMatch: MatchState | null;
  /** 画面に表示する、自分(座席0)の席から見える対局状態。他家の手の内・山・
      王牌の中身はTile.hidden付きのダミーに伏せてある（seatView.ts参照）。 */
  match: MatchState | null;
  /** 自分が今選べる操作（手番の操作・鳴きの応答・配牌交換）。 */
  humanOptions: SeatOptions | null;
  humanCallOptions: HumanCallOptions | null;
  pendingRoundEnd: boolean;
  lastRoundOutcome: RoundScoreOutcome | null;
  /** カード「点棒吸収」等、RoundState.pendingScoreAdjustmentが検知される
      たびにcommitが更新する一発イベント。keyは検知のたびに
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
  /** 巻き戻し用の局面スナップショット（本物の対局状態、新しいものが末尾）。デバッグモード中のみ蓄積する。 */
  history: MatchState[];
  /** 席ごとのCPU難易度（1〜5）。対局開始時に固定され、対局中は変わらない。 */
  cpuDifficulty: CpuDifficultySettings;
  /** ネット対戦中か。trueの間は対局をサーバーが進め、このストアは
      サーバーから届いた画面の状態（applyOnlineView）を持つだけになる
      （fullMatchは常にnull、操作はonlineLink経由でサーバーへ送る）。 */
  online: boolean;
  /** ネット対戦の各席の名前・CPUか・切断中か（自分=0の座席番号）。ローカル対戦ではnull。 */
  onlineSeats: SeatInfo[] | null;
  /** 制限時間の表示（ネット対戦のみ）。receivedAtはperformance.now()基準の受信時刻で、
      画面側はそこからの経過時間を引いて残り時間を出す。 */
  clock: (ClockDisplay & { receivedAt: number }) | null;
  /** ネット対戦で、自分はもう「次の局へ」を押したか。 */
  roundEndAcknowledged: boolean;
  roundEndDeadline: number | null;
  applyOnlineView: (view: OnlineSeatView) => void;
  /** 牌譜の再生中ならその状態（再生中は操作を受け付けず、局面はreplay*で動かす）。 */
  replay: ReplayState | null;
  openReplay: (data: ReplayResponse) => void;
  /** 1手進める/戻す。局の端では隣の局へ移る。 */
  replayStep: (delta: 1 | -1) => void;
  replayGotoRound: (roundIndex: number) => void;
  replaySetViewer: (viewer: PlayerIndex) => void;
  replayToggleRevealAll: () => void;
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

type Get = () => GameStoreState;
type Set = (s: Partial<GameStoreState>) => void;

/** デバッグモード中のみ、変更前の局面をスナップショットとして履歴に積む。 */
function pushHistory(state: GameStoreState): MatchState[] {
  if (!state.debugMode || !state.fullMatch) return state.history;
  const next = [...state.history, state.fullMatch];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** lastScoreAdjustmentのkey採番用。値そのものより「増えたかどうか」だけが
    ScoreAdjustmentOverlay.tsx側の検知条件のため、単調増加すれば方式は何でもよい。 */
let scoreAdjustmentKeySeq = 0;

function commit(get: Get, set: Set, result: MatchActionResult) {
  const state = get();
  let lastScoreAdjustment = state.lastScoreAdjustment;
  if (result.scoreAdjustment) {
    scoreAdjustmentKeySeq += 1;
    lastScoreAdjustment = { delta: result.scoreAdjustment, key: scoreAdjustmentKeySeq };
  }
  set({
    history: pushHistory(state),
    ...viewStateFor(result.match),
    lastScoreAdjustment,
  });
  scheduleTick(get, set);
}

function scheduleTick(get: Get, set: Set, delay = 0) {
  setTimeout(() => tick(get, set), delay);
}

/**
 * アクションを現在の対局に適用する。UIが表示していた選択肢はストアの自動
 * ティック（例:応答不要時の自動スキップ）と非同期に競合することがあり、
 * その場合コアエンジンが「応答対象ではありません」等の例外を投げる。
 * その操作だけ静かに無視し、ゲーム全体をクラッシュさせないようにする。
 */
function dispatch(get: Get, set: Set, action: GameAction) {
  // ネット対戦では判定も適用もサーバーが行う（不正な操作はサーバーが弾く）。
  if (get().online) {
    onlineLink.send({ t: "action", action });
    return;
  }
  const match = get().fullMatch;
  if (!match) return;
  let result: MatchActionResult;
  try {
    result = applyMatchAction(match, action);
  } catch (err) {
    console.error("[majyan] 操作を無視しました（状態が既に進行していた可能性があります）:", err);
    return;
  }
  commit(get, set, result);
}

function sameDecision(a: PendingDecision, b: PendingDecision): boolean {
  return a.kind === b.kind && ("seat" in a ? a.seat : null) === ("seat" in b ? b.seat : null);
}

/**
 * delayミリ秒後、局面がまだ同じ意思決定を待っていればbuildが返すアクションを
 * 適用する（待っている間に巻き戻し・対局終了・人間の操作等で局面が進んでいたら
 * 何もしない。その場合は局面を進めた側が改めてtickを予約している）。
 */
function dispatchLater(
  get: Get,
  set: Set,
  delay: number,
  decision: PendingDecision,
  build: (state: GameStoreState, round: RoundState) => GameAction | null,
) {
  setTimeout(() => {
    const s2 = get();
    if (!s2.fullMatch) return;
    if (s2.debugMode && s2.debugPaused) return;
    const r2 = s2.fullMatch.round;
    if (!sameDecision(pendingDecision(r2), decision)) return;
    const action = build(s2, r2);
    if (action) dispatch(get, set, action);
  }, delay);
}

function tick(get: Get, set: Set) {
  const state = get();
  if (!state.fullMatch || state.pendingRoundEnd) return;
  // 一時停止中は（人間の手番かどうかによらず）一切自動進行させない。
  // これがないと、巻き戻した先がちょうど「これから誰かがツモる直前」の
  // 局面だった場合にツモ処理だけは一時停止を無視して即座に進んでしまい、
  // 巻き戻した直後にまた元の局面へ戻ってしまう（＝巻き戻りが効かないように
  // 見える）不具合になる。
  if (state.debugMode && state.debugPaused) return;
  const round = state.fullMatch.round;
  const fast = state.debugMode && state.debugSpeed === "fast";
  const thinkDelay = fast ? DEBUG_CPU_THINK_DELAY_MS : CPU_THINK_DELAY_MS;
  const decision = pendingDecision(round);

  switch (decision.kind) {
    case "round-over": {
      const { match, outcome } = settleRound(state.fullMatch);
      set({ ...viewStateFor(match), pendingRoundEnd: true, lastRoundOutcome: outcome });
      return;
    }
    case "draw": {
      const draw: GameAction = { type: "draw", player: decision.seat };
      // 必殺技「時間停止」のボーナス手番は実際には他家の手番を一切挟まない
      // ため、即座にツモると「連続で自分だけが動いた」ようにしか見えない。
      // 他家3人ぶんの空振り演出（nameplate--fake-turn、styles.css参照）が
      // 一巡ぶん見える時間だけ、わざと実際のツモを遅らせる。
      if (decision.timeStopBonus) {
        dispatchLater(get, set, fast ? DEBUG_CPU_THINK_DELAY_MS : TIME_STOP_FAKE_TURN_STEP_MS * 3, decision, () => draw);
      } else {
        dispatch(get, set, draw);
      }
      return;
    }
    case "turn": {
      if (decision.seat === HUMAN) {
        // リーチ後で選べる余地が無い時だけ、CPUと同じ間合いで自動的にツモ切りする。
        if (!autoActionForHuman(round, HUMAN)) return;
        dispatchLater(get, set, thinkDelay, decision, (_s, r2) => autoActionForHuman(r2, HUMAN));
        return;
      }
      const seat = decision.seat;
      dispatchLater(get, set, thinkDelay, decision, (s2, r2) =>
        decideCpuTurnAction(r2, seat, s2.cpuDifficulty[seat], { noWin: s2.debugMode }),
      );
      return;
    }
    case "call": {
      if (decision.seat === HUMAN) {
        // 選択肢が無ければ即見送り。ある場合はUI側の応答を待つ（humanCallOptionsは既にセット済み）。
        const auto = autoActionForHuman(round, HUMAN);
        if (auto) dispatch(get, set, auto);
        return;
      }
      const seat = decision.seat;
      dispatchLater(get, set, thinkDelay, decision, (s2, r2) =>
        decideCpuCallResponse(r2, seat, s2.cpuDifficulty[seat], { noWin: s2.debugMode }),
      );
      return;
    }
    case "none":
      return;
  }
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  fullMatch: null,
  match: null,
  humanOptions: null,
  humanCallOptions: null,
  pendingRoundEnd: false,
  lastRoundOutcome: null,
  lastScoreAdjustment: null,
  debugMode: false,
  debugSpeed: "fast",
  debugPaused: false,
  history: [],
  cpuDifficulty: DEFAULT_CPU_DIFFICULTY,
  online: false,
  onlineSeats: null,
  clock: null,
  roundEndAcknowledged: false,
  roundEndDeadline: null,
  replay: null,

  openReplay: (data) => {
    if (data.rounds.length === 0) return;
    set(replayViewState(replayAtRound(data, 0, data.yourSeat, false)));
  },

  replayStep: (delta) => {
    const r = get().replay;
    if (!r) return;
    const step = r.step + delta;
    if (step > replayLastStep(r)) {
      if (r.roundIndex + 1 < r.data.rounds.length) set(replayViewState(replayAtRound(r.data, r.roundIndex + 1, r.viewer, r.revealAll)));
      return;
    }
    if (step < 0) {
      if (r.roundIndex === 0) return;
      const prev = replayAtRound(r.data, r.roundIndex - 1, r.viewer, r.revealAll);
      set(replayViewState({ ...prev, step: replayLastStep(prev) }));
      return;
    }
    set(replayViewState({ ...r, step }));
  },

  replayGotoRound: (roundIndex) => {
    const r = get().replay;
    if (!r || roundIndex < 0 || roundIndex >= r.data.rounds.length) return;
    set(replayViewState(replayAtRound(r.data, roundIndex, r.viewer, r.revealAll)));
  },

  replaySetViewer: (viewer) => {
    const r = get().replay;
    if (r) set(replayViewState({ ...r, viewer }));
  },

  replayToggleRevealAll: () => {
    const r = get().replay;
    if (r) set(replayViewState({ ...r, revealAll: !r.revealAll }));
  },

  applyOnlineView: (view) => {
    const state = get();
    const prev = state.lastScoreAdjustment;
    const now = performance.now();
    // 届いた状態はJSONから作られた新しいオブジェクトなので、前回から変わっていない
    // 部分は前回のオブジェクトを使い回す（core の shareUnchanged 参照）。そうしないと
    // 「オブジェクトが変わった＝変化があった」とみなす演出が、他家の打牌のたびに
    // 無関係な牌まで再生し直してしまう（上家・下家の河の牌が何度も飛び直す不具合）。
    const match = shareUnchanged(state.online ? state.match : null, view.match);
    const humanOptions = shareUnchanged(state.online ? state.humanOptions : null, view.options);
    set({
      online: true,
      fullMatch: null,
      match,
      humanOptions,
      humanCallOptions: humanOptions.call,
      pendingRoundEnd: view.pendingRoundEnd,
      lastRoundOutcome: view.lastRoundOutcome,
      // keyが変わった時だけ差し替える（同じ増減の演出を状態が届くたびに出さないため）。
      lastScoreAdjustment: view.lastScoreAdjustment && view.lastScoreAdjustment.key !== prev?.key ? view.lastScoreAdjustment : prev,
      onlineSeats: view.seats,
      clock: view.clock && { ...view.clock, receivedAt: now },
      roundEndAcknowledged: view.roundEndAcknowledged,
      roundEndDeadline: view.roundEndRemainingMs === null ? null : now + view.roundEndRemainingMs,
      debugMode: false,
      history: [],
    });
  },

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
    for (const seat of CPU_SEATS) {
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
      ...viewStateFor(match),
      pendingRoundEnd: false,
      lastRoundOutcome: null,
      debugMode,
      debugSpeed: "fast",
      debugPaused: false,
      history: [],
      cpuDifficulty,
    });
    scheduleTick(get, set);
  },

  humanDiscard: (tileId) => {
    // 自分のツモ牌は伏せた版(match)にもそのまま入っている。
    const round = get().match?.round;
    if (!round) return;
    dispatch(get, set, { type: "discard", player: HUMAN, tileId, tsumogiri: tileId === round.lastDrawnTile?.id });
  },

  humanRiichi: (tileId) => dispatch(get, set, { type: "riichi", player: HUMAN, tileId }),

  humanTsumo: () => dispatch(get, set, { type: "tsumo", player: HUMAN }),

  humanAnkan: (tileCode) => dispatch(get, set, { type: "ankan", player: HUMAN, tileCode }),

  humanKakan: (tileId) => dispatch(get, set, { type: "kakan", player: HUMAN, tileId }),

  humanKyushuKyuhai: () => dispatch(get, set, { type: "kyushukyuhai", player: HUMAN }),

  humanUseSkill: () => dispatch(get, set, { type: "useSkill", player: HUMAN }),

  humanBorrowSkill: (target) => dispatch(get, set, { type: "borrowSkill", player: HUMAN, target }),

  humanRetrieveDiscard: (reclaimTileId, replacementTileId) =>
    dispatch(get, set, { type: "retrieveDiscard", player: HUMAN, reclaimTileId, replacementTileId }),

  humanUseCard: () => dispatch(get, set, { type: "useCard", player: HUMAN }),

  humanSwapTiles: (tileIds) => dispatch(get, set, { type: "swapTiles", player: HUMAN, tileIds }),

  humanCall: (action) => dispatch(get, set, action),

  humanSkip: () => dispatch(get, set, { type: "skip", player: HUMAN }),

  acknowledgeRoundEnd: () => {
    const state = get();
    // 牌譜の結果画面の「次の局へ」は、次の局の最初へ進む。
    if (state.replay) {
      get().replayGotoRound(state.replay.roundIndex + 1);
      return;
    }
    if (state.online) {
      onlineLink.send({ t: "nextRound" });
      set({ roundEndAcknowledged: true });
      return;
    }
    // 対局終了時はボタンが「タイトルへ戻る」(backToTitle)に切り替わっており
    // このメソッドは呼ばれない想定だが、念のため二重呼び出しをガードしておく。
    if (!state.fullMatch || !state.fullMatch.round.result || state.fullMatch.finished) return;
    const match = advanceToNextRound(state.fullMatch, Math.random, CPU_SEATS);
    if (match.finished) {
      set({ ...viewStateFor(match), pendingRoundEnd: false });
      return;
    }
    set({ ...viewStateFor(match), pendingRoundEnd: false, lastRoundOutcome: null });
    scheduleTick(get, set);
  },

  backToTitle: () => {
    if (get().online) onlineLink.close();
    set({
      replay: null,
      online: false,
      onlineSeats: null,
      clock: null,
      roundEndAcknowledged: false,
      roundEndDeadline: null,
      ...viewStateFor(null),
      pendingRoundEnd: false,
      lastRoundOutcome: null,
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
      ...viewStateFor(prevMatch),
      history: state.history.slice(0, -1),
      pendingRoundEnd: false,
      lastRoundOutcome: null,
      // 巻き戻した直後にCPUの自動進行（tick内のツモ等）が即座に先へ進めて
      // しまい「巻き戻せない」ように見える不具合を防ぐため、巻き戻した瞬間は
      // 自動進行を一時停止する。続きを進めたい場合はユーザーが一時停止解除
      // ボタンを押す。
      debugPaused: true,
    });
    scheduleTick(get, set);
  },
}));
