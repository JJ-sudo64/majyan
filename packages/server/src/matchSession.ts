/**
 * サーバー側で1卓の対局を進める。Web版のgameStore.ts（ローカル対戦）と同じ
 * 進行をするが、こちらは本物の対局状態をサーバーだけが持ち、各席には
 * その席から見える版（seatView.ts）だけを送る。
 *
 * - CPU席: CPU_THINK_MSだけ待ってからcoreのCPU思考で操作する
 * - 人間の席: 操作が届くのを待つ。制限時間（turnClock.ts）を過ぎたら
 *   timeoutActionを代わりに適用する。接続が切れている間は待たずに同じ自動操作で進める
 * - 局の結果表示: 人間全員が「次の局へ」を押すか、ROUND_END_WAIT_MSで次局へ進む
 *
 * タイマーは常に1つだけ（timer）で、局面が進むたびに張り直す。発火時には
 * 張った時と同じ局面（decisionKey）かを確かめ、操作が先に届いて局面が
 * 進んでいたら何もしない。
 */
import {
  actionFromViewer,
  advanceToNextRound,
  applyMatchAction,
  autoActionForHuman,
  clockDisplay,
  computeSeatOptions,
  createMatchClocks,
  decideCpuCallResponse,
  decideCpuTurnAction,
  isClientActionAllowed,
  pendingDecision,
  redactMatchForSeat,
  refillBanksForNewRound,
  rotateMatchForViewer,
  rotateOutcomeForViewer,
  rotateSeatOptionsForViewer,
  settleRound,
  syncDecisionClock,
  timeoutAction,
  toViewerSeat,
  DEFAULT_TIME_LIMIT_RULES,
  type AiDifficulty,
  type GameAction,
  type MatchClocks,
  type MatchState,
  type OnlineSeatView,
  type PlayerIndex,
  type RoundScoreOutcome,
  type SeatInfo,
  type TimeLimitRules,
} from "@majyan/core";

const SEATS: readonly PlayerIndex[] = [0, 1, 2, 3];

export interface SessionTiming {
  /** CPUが1手を決めるまでの間（ローカル対戦のCPU_THINK_DELAY_MSと同じ）。 */
  cpuThinkMs: number;
  /** 必殺技「時間停止」のボーナス手番で、他家3人ぶんの空振り演出を見せる時間
      （web側のTIME_STOP_FAKE_TURN_STEP_MS×3）。 */
  timeStopBonusDrawMs: number;
  /** 局の結果表示を自動で閉じるまでの時間。 */
  roundEndWaitMs: number;
  /** 接続が切れている席の手番を自動で進めるまでの間。 */
  disconnectedActMs: number;
  rules: TimeLimitRules;
}

export const DEFAULT_SESSION_TIMING: SessionTiming = {
  cpuThinkMs: 550,
  timeStopBonusDrawMs: 650 * 3,
  roundEndWaitMs: 30_000,
  disconnectedActMs: 800,
  rules: DEFAULT_TIME_LIMIT_RULES,
};

export type SessionSeat =
  | { kind: "human"; name: string; connected: boolean }
  | { kind: "cpu"; name: string; difficulty: AiDifficulty };

export interface MatchSessionOptions {
  match: MatchState;
  seats: [SessionSeat, SessionSeat, SessionSeat, SessionSeat];
  /** 席（本物の座席番号）へ、その席から見た画面の状態を送る。人間の席にだけ呼ばれる。 */
  send: (seat: PlayerIndex, view: OnlineSeatView) => void;
  rng?: () => number;
  now?: () => number;
  timing?: SessionTiming;
}

export class MatchSession {
  private match: MatchState;
  private readonly seats: [SessionSeat, SessionSeat, SessionSeat, SessionSeat];
  private readonly sendView: MatchSessionOptions["send"];
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly timing: SessionTiming;
  private clocks: MatchClocks;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingRoundEnd = false;
  private roundEndDeadline: number | null = null;
  private lastRoundOutcome: RoundScoreOutcome | null = null;
  private readonly roundEndAcks = new Set<PlayerIndex>();
  private lastScoreAdjustment: { delta: [number, number, number, number]; key: number } | null = null;
  private disposed = false;

  constructor(options: MatchSessionOptions) {
    this.match = options.match;
    this.seats = options.seats;
    this.sendView = options.send;
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
    this.timing = options.timing ?? DEFAULT_SESSION_TIMING;
    this.clocks = createMatchClocks(this.timing.rules);
  }

  /** 対局を始める（最初の配牌はMatchStateの作成時に済んでいる）。 */
  start(): void {
    this.step();
  }

  get state(): MatchState {
    return this.match;
  }

  get finished(): boolean {
    return this.match.finished;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  /** 人間の席から届いた操作（自分=0の座席番号）。受け付けなければエラーの文言を返す。 */
  handleAction(seat: PlayerIndex, viewerAction: GameAction): string | null {
    if (this.disposed || this.pendingRoundEnd) return "今は操作できません";
    if (this.seats[seat].kind !== "human") return "この席は操作できません";
    if (!isClientActionAllowed(viewerAction)) return "この操作は送れません";
    const action = actionFromViewer(viewerAction, seat);
    if (action.player !== seat) return "自分の席以外の操作は送れません";
    return this.apply(action) ? null : "操作が受け付けられませんでした（局面が既に進んでいた可能性があります）";
  }

  handleNextRound(seat: PlayerIndex): void {
    if (!this.pendingRoundEnd || this.match.finished) return;
    this.roundEndAcks.add(seat);
    if (this.allHumansAcked()) this.advanceRound();
    else this.broadcast();
  }

  setConnected(seat: PlayerIndex, connected: boolean): void {
    const s = this.seats[seat];
    if (s.kind !== "human" || s.connected === connected) return;
    this.seats[seat] = { ...s, connected };
    if (this.pendingRoundEnd) {
      if (!connected && this.allHumansAcked()) this.advanceRound();
      else this.broadcast();
      return;
    }
    // 切断・復帰でその席の待ち方（自動で進めるか、制限時間まで待つか）が変わる。
    this.step();
  }

  hasConnectedHuman(): boolean {
    return this.seats.some((s) => s.kind === "human" && s.connected);
  }

  // -------------------------------------------------------------------------

  private apply(action: GameAction): boolean {
    let result;
    try {
      result = applyMatchAction(this.match, action);
    } catch {
      return false;
    }
    this.match = result.match;
    if (result.scoreAdjustment) {
      this.lastScoreAdjustment = { delta: result.scoreAdjustment, key: (this.lastScoreAdjustment?.key ?? 0) + 1 };
    }
    // 操作を受け取った時刻で時計を止める（使った持ち時間を引く）。
    this.clocks = syncDecisionClock(this.clocks, this.match.round, this.now(), this.timing.rules);
    this.step();
    return true;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 局面がまだ同じ判断を待っていればfnを実行するタイマーを張る。 */
  private schedule(delayMs: number, fn: () => void): void {
    this.clearTimer();
    const key = this.decisionKey();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed || this.decisionKey() !== key) return;
      fn();
    }, Math.max(0, delayMs));
  }

  private decisionKey(): string {
    const d = pendingDecision(this.match.round);
    return `${this.clocks.current?.key ?? ""}|${d.kind}|${"seat" in d ? d.seat : ""}|${this.pendingRoundEnd}`;
  }

  private allHumansAcked(): boolean {
    return SEATS.every((seat) => {
      const s = this.seats[seat];
      return s.kind !== "human" || !s.connected || this.roundEndAcks.has(seat);
    });
  }

  /** 今の局面で次に起きることを決めて、タイマーを張り直すか即座に進める。 */
  private step(): void {
    if (this.disposed) return;
    this.clearTimer();
    if (this.pendingRoundEnd) return;
    const now = this.now();
    this.clocks = syncDecisionClock(this.clocks, this.match.round, now, this.timing.rules);
    const round = this.match.round;
    const decision = pendingDecision(round);

    switch (decision.kind) {
      case "round-over": {
        const { match, outcome } = settleRound(this.match);
        this.match = match;
        this.lastRoundOutcome = outcome;
        this.pendingRoundEnd = true;
        this.roundEndAcks.clear();
        this.broadcast();
        if (match.finished) return;
        this.roundEndDeadline = now + this.timing.roundEndWaitMs;
        if (this.allHumansAcked()) {
          // 人間が全員切断している等、待つ相手がいなければ少しだけ見せて進む。
          this.schedule(this.timing.cpuThinkMs, () => this.advanceRound());
        } else {
          this.schedule(this.timing.roundEndWaitMs, () => this.advanceRound());
        }
        return;
      }
      case "draw": {
        const draw: GameAction = { type: "draw", player: decision.seat };
        this.broadcast();
        if (decision.timeStopBonus) this.schedule(this.timing.timeStopBonusDrawMs, () => this.apply(draw));
        else this.apply(draw);
        return;
      }
      case "turn":
      case "call": {
        this.broadcast();
        const seat = decision.seat;
        const s = this.seats[seat];
        if (s.kind === "cpu") {
          this.schedule(this.timing.cpuThinkMs, () => {
            const r = this.match.round;
            this.apply(decision.kind === "turn" ? decideCpuTurnAction(r, seat, s.difficulty) : decideCpuCallResponse(r, seat, s.difficulty));
          });
          return;
        }
        if (!s.connected) {
          this.schedule(this.timing.disconnectedActMs, () => this.applyTimeout(seat));
          return;
        }
        // 選べる余地が無い判断（リーチ後のツモ切り・鳴けない打牌の見送り）は待たずに進める。
        const auto = autoActionForHuman(round, seat);
        if (auto) {
          const delay = decision.kind === "turn" ? this.timing.cpuThinkMs : 0;
          this.schedule(delay, () => {
            const again = autoActionForHuman(this.match.round, seat);
            if (again) this.apply(again);
          });
          return;
        }
        const clock = this.clocks.current;
        if (clock) this.schedule(clock.expiresAt - now, () => this.applyTimeout(seat));
        return;
      }
      case "none":
        this.broadcast();
        return;
    }
  }

  private applyTimeout(seat: PlayerIndex): void {
    const action = timeoutAction(this.match.round, seat);
    if (action) this.apply(action);
  }

  private advanceRound(): void {
    if (!this.pendingRoundEnd || this.match.finished) return;
    this.clearTimer();
    this.match = advanceToNextRound(this.match, this.rng, this.cpuSeats());
    this.pendingRoundEnd = false;
    this.roundEndDeadline = null;
    this.lastRoundOutcome = null;
    this.roundEndAcks.clear();
    this.clocks = refillBanksForNewRound(this.clocks, this.timing.rules);
    if (this.match.finished) {
      this.broadcast();
      return;
    }
    this.step();
  }

  /** 配牌入れ替え権を自動で消化させる席（CPUと、切断中の人間）。 */
  private cpuSeats(): PlayerIndex[] {
    return SEATS.filter((seat) => {
      const s = this.seats[seat];
      return s.kind === "cpu" || !s.connected;
    });
  }

  private broadcast(): void {
    for (const seat of SEATS) {
      const s = this.seats[seat];
      if (s.kind === "human" && s.connected) this.sendView(seat, this.viewFor(seat));
    }
  }

  /** その席から見た画面の状態（本物の座席番号をその席=0に回してある）。 */
  viewFor(seat: PlayerIndex): OnlineSeatView {
    const now = this.now();
    // 他家の鳴き判断の時計は見せない。鳴ける選択肢が無い人は即座に見送られるため、
    // 「誰の鳴き判断で待っているか」が見えるとその人が鳴ける（テンパイ等）とばれる。
    const fullClock = clockDisplay(this.clocks, now);
    const clock = fullClock && (fullClock.kind === "turn" || fullClock.seat === seat) ? fullClock : null;
    const seats = SEATS.map((i) => this.seats[(i + seat) % 4 as PlayerIndex]).map(
      (s): SeatInfo => ({ name: s.name, isCpu: s.kind === "cpu", disconnected: s.kind === "human" && !s.connected }),
    ) as OnlineSeatView["seats"];
    const adj = this.lastScoreAdjustment;
    return {
      match: rotateMatchForViewer(redactMatchForSeat(this.match, seat), seat),
      options: rotateSeatOptionsForViewer(computeSeatOptions(this.match.round, seat), seat),
      clock: clock && { ...clock, seat: toViewerSeat(clock.seat, seat) },
      seats,
      pendingRoundEnd: this.pendingRoundEnd,
      lastRoundOutcome: this.lastRoundOutcome && rotateOutcomeForViewer(this.lastRoundOutcome, seat),
      roundEndAcknowledged: this.roundEndAcks.has(seat),
      roundEndRemainingMs: this.roundEndDeadline === null ? null : Math.max(0, this.roundEndDeadline - now),
      lastScoreAdjustment: adj && {
        key: adj.key,
        delta: [adj.delta[seat]!, adj.delta[(seat + 1) % 4]!, adj.delta[(seat + 2) % 4]!, adj.delta[(seat + 3) % 4]!],
      },
    };
  }
}
