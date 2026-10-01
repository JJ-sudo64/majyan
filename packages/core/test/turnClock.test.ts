import { describe, expect, it } from "vitest";
import { createMatch } from "../src/matchFormat.js";
import { advanceToNextRound, applyMatchAction, pendingDecision, settleRound } from "../src/matchController.js";
import { decideCpuCallResponse, decideCpuTurnAction } from "../src/ai/cpuPlayer.js";
import { randomCharacterIds } from "../src/characters.js";
import {
  clockDisplayForSeat,
  clockForSeat,
  createMatchClocks,
  DEFAULT_TIME_LIMIT_RULES,
  expiredSeats,
  refillBanksForNewRound,
  syncDecisionClock,
  timeoutAction,
  type MatchClocks,
  type TimeLimitRules,
} from "../src/turnClock.js";
import type { GameAction, PlayerIndex } from "../src/actions.js";
import type { MatchState } from "../src/gameState.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const ALL_SEATS: PlayerIndex[] = [0, 1, 2, 3];
const RULES: TimeLimitRules = { perDecisionMs: 5000, bankMs: 20000, bankRefillsEachRound: false, networkGraceMs: 1000 };

/** 最初に手番の判断が来るまで進めた対局。 */
function firstTurn(seed: number): MatchState {
  let match = createMatch("hanchan", makeRng(seed), randomCharacterIds(makeRng(seed)));
  while (pendingDecision(match.round).kind !== "turn") {
    match = applyMatchAction(match, { type: "draw", player: match.round.currentTurn }).match;
  }
  return match;
}

describe("syncDecisionClock", () => {
  it("does not touch the bank when acting within the per-decision time", () => {
    const match = firstTurn(1);
    const seat = match.round.currentTurn;
    let clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 1000, RULES);
    expect(clocks.active).toEqual([expect.objectContaining({ seat, kind: "turn", baseEndsAt: 6000, bankEndsAt: 26000, expiresAt: 27000 })]);

    const action = timeoutAction(match.round, seat)!;
    const next = applyMatchAction(match, action).match;
    clocks = syncDecisionClock(clocks, next.round, 5999, RULES);
    expect(clocks.bankRemainingMs[seat]).toBe(20000);
  });

  it("charges only the time spent beyond the per-decision time", () => {
    const match = firstTurn(2);
    const seat = match.round.currentTurn;
    let clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES);
    const next = applyMatchAction(match, timeoutAction(match.round, seat)!).match;
    clocks = syncDecisionClock(clocks, next.round, 8000, RULES);
    expect(clocks.bankRemainingMs[seat]).toBe(17000);
    // 他の座席の持ち時間は減らない。
    for (const s of ALL_SEATS) if (s !== seat) expect(clocks.bankRemainingMs[s]).toBe(20000);
  });

  it("never charges more than the bank, even if the action arrives after the grace period", () => {
    const match = firstTurn(3);
    const seat = match.round.currentTurn;
    let clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES);
    const next = applyMatchAction(match, timeoutAction(match.round, seat)!).match;
    clocks = syncDecisionClock(clocks, next.round, 999_999, RULES);
    expect(clocks.bankRemainingMs[seat]).toBe(0);
  });

  it("keeps the same clock while the same decision is pending", () => {
    const match = firstTurn(4);
    const clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES);
    expect(syncDecisionClock(clocks, match.round, 3000, RULES)).toBe(clocks);
  });

  it("starts the next decision with the reduced bank", () => {
    const rules: TimeLimitRules = { ...RULES, bankMs: 3000 };
    const match = firstTurn(5);
    const seat = match.round.currentTurn;
    const clocks: MatchClocks = {
      bankRemainingMs: ALL_SEATS.map((s) => (s === seat ? 1200 : 3000)) as MatchClocks["bankRemainingMs"],
      active: [],
    };
    const synced = syncDecisionClock(clocks, match.round, 100, rules);
    expect(synced.active[0]?.bankEndsAt).toBe(100 + 5000 + 1200);
  });

  it("stops the clock while nobody needs to decide (draw / round over)", () => {
    const match = createMatch("hanchan", makeRng(6));
    expect(pendingDecision(match.round).kind).toBe("draw");
    expect(syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES).active).toEqual([]);
  });
});

describe("expiredSeats / clockDisplayForSeat", () => {
  it("expires only after the bank and the network grace are used up", () => {
    const match = firstTurn(7);
    const clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES);
    const seat = match.round.currentTurn;
    expect(expiredSeats(clocks, 24_999)).toEqual([]);
    expect(expiredSeats(clocks, 25_000)).toEqual([]); // 表示上は0秒だが猶予中
    expect(expiredSeats(clocks, 25_999)).toEqual([]);
    expect(expiredSeats(clocks, 26_000)).toEqual([seat]);
    expect(expiredSeats(createMatchClocks(RULES), 1e12)).toEqual([]);
  });

  it("shows the per-decision time first, then the bank", () => {
    const match = firstTurn(8);
    const clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES);
    const seat = match.round.currentTurn;
    expect(clockDisplayForSeat(clocks, 2000, seat)).toMatchObject({ baseRemainingMs: 3000, bankRemainingMs: 20000 });
    expect(clockDisplayForSeat(clocks, 9000, seat)).toMatchObject({ baseRemainingMs: 0, bankRemainingMs: 16000 });
    expect(clockDisplayForSeat(clocks, 30000, seat)).toMatchObject({ baseRemainingMs: 0, bankRemainingMs: 0 });
  });
});

describe("call windows", () => {
  /** 誰かが打牌して鳴きの応答待ちになった局面。 */
  function firstCallWindow(seed: number): MatchState {
    let match = firstTurn(seed);
    match = applyMatchAction(match, timeoutAction(match.round, match.round.currentTurn)!).match;
    expect(match.round.phase).toBe("awaiting-calls");
    return match;
  }

  it("runs a clock for every seat that has not answered yet, at the same time", () => {
    const match = firstCallWindow(10);
    const discarder = match.round.pendingCallWindow!.discarderIndex;
    const clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES);
    expect(clocks.active.map((c) => c.seat).sort()).toEqual(ALL_SEATS.filter((s) => s !== discarder).sort());
    expect(clocks.active.every((c) => c.kind === "call" && c.expiresAt === 26000)).toBe(true);
  });

  it("stops only the clock of the seat that answered", () => {
    let match = firstCallWindow(11);
    let clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES);
    const [first, ...rest] = clocks.active;
    match = applyMatchAction(match, { type: "skip", player: first!.seat }).match;
    clocks = syncDecisionClock(clocks, match.round, 7000, RULES);
    expect(clocks.bankRemainingMs[first!.seat]).toBe(18000);
    expect(clocks.active.map((c) => c.key)).toEqual(rest.map((c) => c.key));
    // 残りの人の時計は最初の時刻のまま動き続けている（張り直されていない）。
    expect(clocks.active.every((c) => c.startedAt === 0)).toBe(true);
  });

  it("shows a seat its own call clock but never another seat's", () => {
    const match = firstCallWindow(12);
    const discarder = match.round.pendingCallWindow!.discarderIndex;
    const clocks = syncDecisionClock(createMatchClocks(RULES), match.round, 0, RULES);
    const responder = clocks.active[0]!.seat;
    expect(clockDisplayForSeat(clocks, 0, responder)).toMatchObject({ seat: responder, kind: "call" });
    expect(clockDisplayForSeat(clocks, 0, discarder)).toBeNull();
  });
});

describe("refillBanksForNewRound", () => {
  it("refills only when the rule says so", () => {
    const used: MatchClocks = { bankRemainingMs: [0, 5000, 20000, 1], active: [] };
    expect(refillBanksForNewRound(used, RULES)).toBe(used);
    expect(refillBanksForNewRound(used, { ...RULES, bankRefillsEachRound: true }).bankRemainingMs).toEqual([20000, 20000, 20000, 20000]);
  });
});

describe("timeoutAction", () => {
  /**
   * timeoutSeatsの座席は手番を常に時間切れ扱い（timeoutAction）で進め、
   * それ以外と鳴きの応答はCPUで進める。時計も実際のサーバーと同じ要領で回し、
   * 時間切れ扱いにする前に expiredSeats にその座席が入ることを確かめる。
   */
  function playWithTimeouts(seed: number, timeoutSeats: PlayerIndex[], timeoutCalls: boolean) {
    const rng = makeRng(seed);
    let match = createMatch("tonpuusen", rng, randomCharacterIds(rng));
    let clocks = createMatchClocks(DEFAULT_TIME_LIMIT_RULES);
    let now = 0;
    const stats = { tsumogiri: 0, nonTsumogiri: 0, skips: 0 };
    for (let steps = 0; !match.finished; steps++) {
      if (steps > 200000) throw new Error("対局が終わりません");
      clocks = syncDecisionClock(clocks, match.round, now, DEFAULT_TIME_LIMIT_RULES);
      const decision = pendingDecision(match.round);
      let action: GameAction;
      switch (decision.kind) {
        case "round-over":
          match = advanceToNextRound(settleRound(match).match, rng, ALL_SEATS);
          clocks = refillBanksForNewRound(clocks, DEFAULT_TIME_LIMIT_RULES);
          continue;
        case "draw":
          action = { type: "draw", player: decision.seat };
          break;
        case "turn":
        case "call": {
          const timesOut = timeoutSeats.includes(decision.seat) && (decision.kind === "turn" || timeoutCalls);
          if (timesOut) {
            const clock = clockForSeat(clocks, decision.seat)!;
            expect(clock).not.toBeNull();
            now = Math.max(now, clock.expiresAt);
            expect(expiredSeats(clocks, now)).toContain(decision.seat);
            action = timeoutAction(match.round, decision.seat)!;
            expect(action).not.toBeNull();
            if (action.type === "skip") stats.skips++;
            else if (action.type === "discard" && action.tsumogiri) stats.tsumogiri++;
            else stats.nonTsumogiri++;
          } else {
            now += 500;
            action =
              decision.kind === "turn"
                ? decideCpuTurnAction(match.round, decision.seat)
                : decideCpuCallResponse(match.round, decision.seat);
          }
          break;
        }
        case "none":
          throw new Error("誰の番でもない局面で止まりました");
      }
      // 時間切れの操作が常に合法であること（不正ならapplyMatchActionが例外を投げる）。
      match = applyMatchAction(match, action).match;
    }
    return { match, clocks, stats };
  }

  it("lets a match finish when every seat always times out", () => {
    const { match, clocks, stats } = playWithTimeouts(11, ALL_SEATS, true);
    expect(match.finished).toBe(true);
    expect(stats.tsumogiri).toBeGreaterThan(0);
    expect(stats.skips).toBeGreaterThan(0);
    expect(clocks.bankRemainingMs).toEqual([0, 0, 0, 0]);
  }, 300000);

  it("discards a legal tile after calling (no drawn tile in hand)", () => {
    // 時間切れの座席でも鳴きはCPUに任せ、ポン/チー直後の手番で時間切れになる局面を作る。
    let nonTsumogiri = 0;
    for (let seed = 1; seed <= 6 && nonTsumogiri === 0; seed++) {
      const { match, stats } = playWithTimeouts(seed * 31, ALL_SEATS, false);
      expect(match.finished).toBe(true);
      nonTsumogiri += stats.nonTsumogiri;
    }
    expect(nonTsumogiri).toBeGreaterThan(0);
  }, 300000);

  it("returns null for a seat that is not being waited on", () => {
    const match = firstTurn(9);
    const other = ((match.round.currentTurn + 1) % 4) as PlayerIndex;
    expect(timeoutAction(match.round, other)).toBeNull();
  });
});
