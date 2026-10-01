/**
 * 打牌・鳴きの制限時間（ネット対戦用）。
 *
 * 考え方は天鳳/雀魂と同じ「1回の判断ごとに毎回もらえる時間(perDecisionMs)」＋
 * 「それを超えた分だけ減っていく持ち時間(bankMs)」。両方使い切ると時間切れで、
 * サーバーが timeoutAction の操作（ツモ切り/見送り）を代わりに適用する。
 *
 * ここは時刻を引数で受け取るだけの純粋関数で、タイマー(setTimeout)は持たない。
 * サーバーは操作を適用するたび（＝局面が変わるたび）に syncDecisionClock を呼び、
 * 返ってきた current.expiresAt にタイマーを仕掛け直す。タイマーが発火したら
 * isClockExpired で本当に時間切れかを確かめてから timeoutAction を適用する
 * （発火までの間に本人の操作が届いて局面が進んでいることがあるため）。
 */
import type { GameAction, PlayerIndex } from "./actions.js";
import type { RoundState } from "./gameState.js";
import { pendingDecision } from "./matchController.js";

type Four<T> = [T, T, T, T];

export interface TimeLimitRules {
  /** 判断1回ごとに毎回もらえる時間。この中で操作すれば持ち時間は減らない。 */
  perDecisionMs: number;
  /** perDecisionMsを超えた分を払う持ち時間（座席ごと）。 */
  bankMs: number;
  /** 持ち時間を局ごとに満タンへ戻すか（false なら対局を通して減る一方）。 */
  bankRefillsEachRound: boolean;
  /** 通信の遅れぶんの猶予。表示上の残り時間が0になってから実際に
      時間切れ扱いにするまでの時間で、持ち時間からは引かない。 */
  networkGraceMs: number;
}

export const DEFAULT_TIME_LIMIT_RULES: TimeLimitRules = {
  perDecisionMs: 5_000,
  bankMs: 20_000,
  bankRefillsEachRound: false,
  networkGraceMs: 1_000,
};

/** いま時計が動いている判断（自分の手番の打牌、または鳴きの応答）。 */
export interface DecisionClock {
  /** どの判断かを見分けるキー。同じキーの間は同じ時計が動き続ける
      （必殺技を使った後に続けて打牌する時など、時間はリセットしない）。 */
  key: string;
  seat: PlayerIndex;
  kind: "turn" | "call";
  startedAt: number;
  /** 毎回もらえる時間を使い切る時刻。ここから先は持ち時間が減っていく。 */
  baseEndsAt: number;
  /** 持ち時間も使い切る時刻（表示上の0秒）。 */
  bankEndsAt: number;
  /** 実際に時間切れとして扱う時刻（bankEndsAt＋通信の猶予）。 */
  expiresAt: number;
}

export interface MatchClocks {
  /** 座席ごとの残り持ち時間（いま動いている時計のぶんはまだ引いていない）。 */
  bankRemainingMs: Four<number>;
  current: DecisionClock | null;
}

export function createMatchClocks(rules: TimeLimitRules = DEFAULT_TIME_LIMIT_RULES): MatchClocks {
  return { bankRemainingMs: [rules.bankMs, rules.bankMs, rules.bankMs, rules.bankMs], current: null };
}

/**
 * 局面が待っている判断のキー。時計が要らない局面（ツモ・局終了・応答の解決待ち）はnull。
 * 局・打牌数・副露数・カン数を含めるのは、同じ座席の同じ種類の判断が続いた時
 * （時間停止のボーナス手番、暗槓後の嶺上ツモ後の打牌等）にも別の判断として
 * 時計を回し直すため。
 */
export function decisionClockKey(round: RoundState): string | null {
  const decision = pendingDecision(round);
  if (decision.kind !== "turn" && decision.kind !== "call") return null;
  const discards = round.players.reduce((n, p) => n + p.discards.length, 0);
  const melds = round.players.reduce((n, p) => n + p.hand.melds.length, 0);
  return [decision.kind, decision.seat, round.roundWind, round.roundNumber, round.honba, discards, melds, round.kanCount].join(":");
}

/** 終わった判断で持ち時間を何ミリ秒使ったか（毎回もらえる時間の内なら0）。 */
function bankUsed(clock: DecisionClock, now: number): number {
  return Math.max(0, Math.min(now, clock.bankEndsAt) - clock.baseEndsAt);
}

/**
 * 局面に合わせて時計を進め直す。操作を適用した直後（now＝その操作を受け取った
 * 時刻）や新しい局を配った直後に呼ぶ。
 * - 待っている判断が今の時計と同じなら何もしない
 * - 違えば今の時計を止めて使った持ち時間を引き、新しい判断の時計を始める
 */
export function syncDecisionClock(
  clocks: MatchClocks,
  round: RoundState,
  now: number,
  rules: TimeLimitRules = DEFAULT_TIME_LIMIT_RULES,
): MatchClocks {
  const key = decisionClockKey(round);
  const current = clocks.current;
  if (current && current.key === key) return clocks;

  let bankRemainingMs = clocks.bankRemainingMs;
  if (current) {
    const used = bankUsed(current, now);
    bankRemainingMs = bankRemainingMs.map((b, i) => (i === current.seat ? Math.max(0, b - used) : b)) as Four<number>;
  }
  if (key === null) return { bankRemainingMs, current: null };

  const decision = pendingDecision(round) as { kind: "turn" | "call"; seat: PlayerIndex };
  const baseEndsAt = now + rules.perDecisionMs;
  const bankEndsAt = baseEndsAt + bankRemainingMs[decision.seat];
  return {
    bankRemainingMs,
    current: {
      key,
      seat: decision.seat,
      kind: decision.kind,
      startedAt: now,
      baseEndsAt,
      bankEndsAt,
      expiresAt: bankEndsAt + rules.networkGraceMs,
    },
  };
}

/** 新しい局の開始時に呼ぶ。bankRefillsEachRoundなら全員の持ち時間を満タンに戻す。 */
export function refillBanksForNewRound(clocks: MatchClocks, rules: TimeLimitRules = DEFAULT_TIME_LIMIT_RULES): MatchClocks {
  if (!rules.bankRefillsEachRound) return clocks;
  return { ...clocks, bankRemainingMs: [rules.bankMs, rules.bankMs, rules.bankMs, rules.bankMs] };
}

export function isClockExpired(clocks: MatchClocks, now: number): boolean {
  return !!clocks.current && now >= clocks.current.expiresAt;
}

/** 画面に出す残り時間。端末ごとに時計がずれるため、時刻ではなく残りの長さで渡す。 */
export interface ClockDisplay {
  seat: PlayerIndex;
  kind: "turn" | "call";
  /** 毎回もらえる時間の残り。 */
  baseRemainingMs: number;
  /** 持ち時間の残り（毎回もらえる時間を使い切るまでは減らない）。 */
  bankRemainingMs: number;
}

export function clockDisplay(clocks: MatchClocks, now: number): ClockDisplay | null {
  const c = clocks.current;
  if (!c) return null;
  return {
    seat: c.seat,
    kind: c.kind,
    baseRemainingMs: Math.max(0, c.baseEndsAt - now),
    bankRemainingMs: Math.max(0, c.bankEndsAt - Math.max(now, c.baseEndsAt)),
  };
}

/**
 * 時間切れの座席の代わりに適用する操作。
 * - 手番: ツモ切り。鳴いた直後などツモ牌が手に無い時は手牌の一番右（最後尾）を切る。
 *   ツモ和了できても和了はしない（本人が選んでいないため。天鳳・雀魂と同じ扱い）。
 * - 鳴きの応答: 見送り（ロンできても見送る）。
 * その座席の判断を待っていない局面ならnull。
 */
export function timeoutAction(round: RoundState, seat: PlayerIndex): GameAction | null {
  const decision = pendingDecision(round);
  if (decision.kind === "call" && decision.seat === seat) return { type: "skip", player: seat };
  if (decision.kind !== "turn" || decision.seat !== seat) return null;
  const concealed = round.players[seat].hand.concealed;
  const drawn = round.lastDrawnTile;
  if (drawn && concealed.some((t) => t.id === drawn.id)) {
    return { type: "discard", player: seat, tileId: drawn.id, tsumogiri: true };
  }
  const last = concealed[concealed.length - 1];
  return last ? { type: "discard", player: seat, tileId: last.id, tsumogiri: false } : null;
}
