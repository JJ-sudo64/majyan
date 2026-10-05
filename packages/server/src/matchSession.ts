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
 * 鳴きの応答は、まだ答えていない全員（人間もCPUも）から同時に受け付ける。
 * タイマーは局面が進むたびに「今張っておくべきもの」を数え直して張り直す
 * （reconcileTimers）。局面が変わって不要になったタイマーはその時点で外れるので、
 * 操作が先に届いていたのに古いタイマーが発火する、ということは起きない。
 *
 * サーバーを再起動しても対局を続けられるよう、局面が進むたびにonChangeで知らせ、
 * 呼んだ側（rooms.ts）がsnapshot()をDBへ保存する。再起動後はMatchSession.restoreで
 * 作り直してresumeで再開する。再開直後は人間が全員切断中の扱いになるが、
 * 入り直してくるのを猶予の間だけ待つ（すぐ自動操作で進めてしまわないように）。
 */
import {
  actionFromViewer,
  advanceToNextRound,
  applyMatchAction,
  autoActionForHuman,
  clockDisplayForSeat,
  clockForSeat,
  computeCallOptions,
  computeSeatOptions,
  createMatchClocks,
  cutinHoldMs,
  dealCutinHoldMs,
  decideCpuCallResponse,
  decideCpuTurnAction,
  hasAnyCallOption,
  holdClocks,
  isClientActionAllowed,
  pendingSeatDecisions,
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
  | { kind: "human"; name: string; connected: boolean; rankLabel: string | null }
  | { kind: "cpu"; name: string; difficulty: AiDifficulty };

export interface MatchSessionOptions {
  match: MatchState;
  seats: [SessionSeat, SessionSeat, SessionSeat, SessionSeat];
  /** 席（本物の座席番号）へ、その席から見た画面の状態を送る。人間の席にだけ呼ばれる。 */
  send: (seat: PlayerIndex, view: OnlineSeatView) => void;
  rng?: () => number;
  now?: () => number;
  timing?: SessionTiming;
  /** 対局が終わった瞬間に1回だけ呼ばれる（段位戦の結果の反映等）。 */
  onFinished?: (match: MatchState) => void;
  /** 局面が変わるたびに呼ばれる（snapshot()を保存するため）。 */
  onChange?: () => void;
}

/** 再起動をまたいで対局を続けるために保存する中身（JSONにできる値だけ）。 */
export interface SessionSnapshot {
  match: MatchState;
  seats: [SessionSeat, SessionSeat, SessionSeat, SessionSeat];
  /** 座席ごとの残り持ち時間。動いていた時計は再開時に新しく始め直す。 */
  bankRemainingMs: [number, number, number, number];
  pendingRoundEnd: boolean;
  roundEndRemainingMs: number | null;
  lastRoundOutcome: RoundScoreOutcome | null;
  roundEndAcks: PlayerIndex[];
  lastScoreAdjustment: { delta: [number, number, number, number]; key: number } | null;
  finishReported: boolean;
}

export class MatchSession {
  private match: MatchState;
  private readonly seats: [SessionSeat, SessionSeat, SessionSeat, SessionSeat];
  private readonly sendView: MatchSessionOptions["send"];
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly timing: SessionTiming;
  private clocks: MatchClocks;
  /** 画面でカットインを流している間はこの時刻まで時計を止める。 */
  private clockHoldUntil = 0;
  /** 張っているタイマー（キーはreconcileTimers参照）。 */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingRoundEnd = false;
  private roundEndDeadline: number | null = null;
  private lastRoundOutcome: RoundScoreOutcome | null = null;
  private readonly roundEndAcks = new Set<PlayerIndex>();
  private lastScoreAdjustment: { delta: [number, number, number, number]; key: number } | null = null;
  private disposed = false;
  private finishReported = false;
  private readonly onFinished: MatchSessionOptions["onFinished"];
  private readonly onChange: MatchSessionOptions["onChange"];
  /** 再開直後、切断中の人間が入り直してくるのを待つ期限（この時刻までは自動操作しない）。 */
  private awayGraceUntil = 0;

  constructor(options: MatchSessionOptions) {
    this.match = options.match;
    this.seats = options.seats;
    this.sendView = options.send;
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
    this.timing = options.timing ?? DEFAULT_SESSION_TIMING;
    this.clocks = createMatchClocks(this.timing.rules);
    this.onFinished = options.onFinished;
    this.onChange = options.onChange;
  }

  /** 保存しておいた対局から作り直す（続きはresumeで始める）。人間の席は全員切断中にする。 */
  static restore(snapshot: SessionSnapshot, options: Omit<MatchSessionOptions, "match" | "seats">): MatchSession {
    const seats = snapshot.seats.map((s) => (s.kind === "human" ? { ...s, connected: false } : { ...s }));
    const session = new MatchSession({ ...options, match: snapshot.match, seats: seats as MatchSessionOptions["seats"] });
    session.clocks = { bankRemainingMs: [...snapshot.bankRemainingMs], active: [] };
    session.pendingRoundEnd = snapshot.pendingRoundEnd;
    session.roundEndDeadline = snapshot.roundEndRemainingMs === null ? null : session.now() + snapshot.roundEndRemainingMs;
    session.lastRoundOutcome = snapshot.lastRoundOutcome;
    for (const seat of snapshot.roundEndAcks) session.roundEndAcks.add(seat);
    session.lastScoreAdjustment = snapshot.lastScoreAdjustment;
    session.finishReported = snapshot.finishReported;
    return session;
  }

  /** restoreで作り直した対局を再開する。graceMsの間は切断中の人間の席を自動操作しない。 */
  resume(graceMs: number): void {
    const now = this.now();
    this.awayGraceUntil = now + graceMs;
    if (this.roundEndDeadline !== null) this.roundEndDeadline = Math.max(this.roundEndDeadline, this.awayGraceUntil);
    this.step();
  }

  snapshot(): SessionSnapshot {
    return {
      match: this.match,
      seats: this.seats,
      bankRemainingMs: this.clocks.bankRemainingMs,
      pendingRoundEnd: this.pendingRoundEnd,
      roundEndRemainingMs: this.roundEndDeadline === null ? null : Math.max(0, this.roundEndDeadline - this.now()),
      lastRoundOutcome: this.lastRoundOutcome,
      roundEndAcks: [...this.roundEndAcks],
      lastScoreAdjustment: this.lastScoreAdjustment,
      finishReported: this.finishReported,
    };
  }

  private reportFinishedOnce(): void {
    if (!this.match.finished || this.finishReported) return;
    this.finishReported = true;
    try {
      this.onFinished?.(this.match);
    } catch (err) {
      console.error("[majyan-server] 対局終了の処理に失敗しました:", err);
    }
  }

  /** 対局を始める（最初の配牌はMatchStateの作成時に済んでいる）。 */
  start(): void {
    this.holdForCutin(dealCutinHoldMs(this.match.round));
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
    this.clearTimers();
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
    // 再開直後の猶予中に戻ってきた人の時計は、戻った時から数え直す（再開した
    // 時点から動いていた時計のままだと、戻るまでの時間で持ち時間が減ってしまう）。
    if (connected && this.now() < this.awayGraceUntil) {
      this.clocks = { ...this.clocks, active: this.clocks.active.filter((c) => c.seat !== seat) };
    }
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
    const before = this.match.round;
    this.match = result.match;
    if (result.scoreAdjustment) {
      this.lastScoreAdjustment = { delta: result.scoreAdjustment, key: (this.lastScoreAdjustment?.key ?? 0) + 1 };
    }
    // 操作を受け取った時刻で時計を止める（使った持ち時間を引く）。
    this.clocks = syncDecisionClock(this.clocks, this.match.round, this.now(), this.timing.rules, this.clockHoldUntil);
    // 必殺技・リーチのカットインが流れる間は、続けて判断する人の時計も止める。
    this.holdForCutin(cutinHoldMs(before, this.match.round));
    this.step();
    return true;
  }

  private holdForCutin(ms: number): void {
    if (ms <= 0) return;
    const now = this.now();
    this.clockHoldUntil = Math.max(this.clockHoldUntil, now + ms);
    this.clocks = holdClocks(this.clocks, now, this.clockHoldUntil);
  }

  private clearTimers(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /**
   * 張っておくべきタイマーの一覧に合わせて、タイマーを張り直す。キーが同じ
   * タイマーは張り直さずにそのまま残す（鳴きの応答で1人が答えても、残りの人の
   * CPU思考や制限時間のタイマーが最初からやり直しにならないように）。キーには
   * 局面を表す値を含めてあるので、局面が進むと古いタイマーは自然に外れる。
   */
  private reconcileTimers(wanted: Map<string, { delayMs: number; run: () => void }>): void {
    for (const [key, t] of this.timers) {
      if (wanted.has(key)) continue;
      clearTimeout(t);
      this.timers.delete(key);
    }
    for (const [key, w] of wanted) {
      if (this.timers.has(key)) continue;
      this.timers.set(
        key,
        setTimeout(() => {
          this.timers.delete(key);
          if (!this.disposed) w.run();
        }, Math.max(0, w.delayMs)),
      );
    }
  }

  /** 局面を表すキー（ツモ・局終了待ち等、時計の無い局面のタイマー用）。 */
  private roundKey(): string {
    const r = this.match.round;
    const discards = r.players.reduce((n, p) => n + p.discards.length, 0);
    return [r.roundWind, r.roundNumber, r.honba, discards, r.kanCount, r.phase, r.currentTurn].join(":");
  }

  /** 切断中で、もう戻りを待たない人間の席（再開直後の猶予中は待つ）。 */
  private isAway(seat: PlayerIndex): boolean {
    const s = this.seats[seat];
    return s.kind === "human" && !s.connected && this.now() >= this.awayGraceUntil;
  }

  private allHumansAcked(): boolean {
    return SEATS.every((seat) => {
      const s = this.seats[seat];
      return s.kind !== "human" || this.isAway(seat) || (s.connected && this.roundEndAcks.has(seat));
    });
  }

  /** 今の局面で次に起きることを決めて、タイマーを張り直すか即座に進める。 */
  private step(): void {
    if (this.disposed) return;
    const wanted = new Map<string, { delayMs: number; run: () => void }>();
    if (this.pendingRoundEnd) {
      // 結果表示中: 次局へ進むタイマー（advanceRoundの中でここに来ることは無い）。
      if (!this.match.finished && this.roundEndDeadline !== null) {
        const delayMs = this.allHumansAcked() ? this.timing.cpuThinkMs : this.roundEndDeadline - this.now();
        wanted.set(`roundEnd:${this.roundKey()}`, { delayMs, run: () => this.advanceRound() });
      }
      this.reconcileTimers(wanted);
      return;
    }
    const now = this.now();
    this.clocks = syncDecisionClock(this.clocks, this.match.round, now, this.timing.rules, this.clockHoldUntil);
    const round = this.match.round;
    const decision = pendingDecision(round);

    if (decision.kind === "round-over") {
      const { match, outcome } = settleRound(this.match);
      this.match = match;
      this.lastRoundOutcome = outcome;
      this.pendingRoundEnd = true;
      this.roundEndAcks.clear();
      this.roundEndDeadline = match.finished ? null : now + this.timing.roundEndWaitMs;
      this.reportFinishedOnce();
      this.broadcast();
      this.step();
      return;
    }
    if (decision.kind === "draw") {
      const draw: GameAction = { type: "draw", player: decision.seat };
      if (!decision.timeStopBonus) {
        this.reconcileTimers(wanted);
        this.apply(draw);
        return;
      }
      wanted.set(`draw:${this.roundKey()}`, { delayMs: this.timing.timeStopBonusDrawMs, run: () => this.apply(draw) });
    }

    // 手番は1人、鳴きの応答はまだ答えていない全員から同時に受け付ける。
    for (const pending of pendingSeatDecisions(round)) {
      const { seat, kind, key } = pending;
      const s = this.seats[seat];
      if (s.kind === "cpu") {
        wanted.set(`cpu:${key}`, {
          delayMs: this.timing.cpuThinkMs,
          run: () => {
            const r = this.match.round;
            this.apply(kind === "turn" ? decideCpuTurnAction(r, seat, s.difficulty) : decideCpuCallResponse(r, seat, s.difficulty));
          },
        });
        continue;
      }
      if (!s.connected) {
        const delayMs = Math.max(this.timing.disconnectedActMs, this.awayGraceUntil - now);
        wanted.set(`away:${key}`, { delayMs, run: () => this.applyTimeout(seat) });
        continue;
      }
      // 選べる余地が無い判断（リーチ後のツモ切り・鳴けない打牌の見送り）は待たずに進める。
      if (kind === "turn" ? !!autoActionForHuman(round, seat) : !hasAnyCallOption(computeCallOptions(round, seat))) {
        wanted.set(`auto:${key}`, {
          delayMs: kind === "turn" ? this.timing.cpuThinkMs : 0,
          run: () => this.applyTimeout(seat),
        });
        continue;
      }
      const clock = clockForSeat(this.clocks, seat);
      if (clock) wanted.set(`timeout:${key}`, { delayMs: clock.expiresAt - now, run: () => this.applyTimeout(seat) });
    }
    this.reconcileTimers(wanted);
    this.broadcast();
  }

  private applyTimeout(seat: PlayerIndex): void {
    const action = timeoutAction(this.match.round, seat);
    if (action) this.apply(action);
  }

  private advanceRound(): void {
    if (!this.pendingRoundEnd || this.match.finished) return;
    this.match = advanceToNextRound(this.match, this.rng, this.cpuSeats());
    this.pendingRoundEnd = false;
    this.roundEndDeadline = null;
    this.lastRoundOutcome = null;
    this.roundEndAcks.clear();
    this.clocks = refillBanksForNewRound(this.clocks, this.timing.rules);
    this.holdForCutin(dealCutinHoldMs(this.match.round));
    if (this.match.finished) {
      this.reportFinishedOnce();
      this.broadcast();
      return;
    }
    this.step();
  }

  /** 配牌入れ替え権を自動で消化させる席（CPUと、切断中の人間）。 */
  private cpuSeats(): PlayerIndex[] {
    return SEATS.filter((seat) => this.seats[seat].kind === "cpu" || this.isAway(seat));
  }

  private broadcast(): void {
    for (const seat of SEATS) {
      const s = this.seats[seat];
      if (s.kind === "human" && s.connected) this.sendView(seat, this.viewFor(seat));
    }
    try {
      this.onChange?.();
    } catch (err) {
      // 保存に失敗しても対局そのものは続ける（再起動すると直前の保存からになるだけ）。
      console.error("[majyan-server] 対局の保存に失敗しました:", err);
    }
  }

  /** その席から見た画面の状態（本物の座席番号をその席=0に回してある）。 */
  viewFor(seat: PlayerIndex): OnlineSeatView {
    const now = this.now();
    // 他家の鳴き判断の時計は見せない（clockDisplayForSeat参照）。
    const clock = clockDisplayForSeat(this.clocks, now, seat);
    const seats = SEATS.map((i) => this.seats[(i + seat) % 4 as PlayerIndex]).map(
      (s): SeatInfo => ({
        name: s.name,
        rankLabel: s.kind === "human" ? s.rankLabel : null,
        isCpu: s.kind === "cpu",
        disconnected: s.kind === "human" && !s.connected,
      }),
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
