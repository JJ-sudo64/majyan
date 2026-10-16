import { describe, expect, it } from "vitest";
import {
  applyMatchAction,
  createMatch,
  decideCpuCallResponse,
  decideCpuTurnAction,
  pendingDecision,
  summarizeRound,
  type GameAction,
  type MatchState,
  type ReplayRound,
} from "@majyan/core";
import { openDatabase } from "../src/db.js";
import { AccountService } from "../src/accounts.js";
import { RankService } from "../src/ranks.js";
import { ReplayStore } from "../src/replays.js";
import { backfillRoundStats } from "../src/roundStats.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** CPU同士で1局を最後まで打ち、牌譜（局の始まりと操作の並び）を返す。 */
function playRound(start: MatchState): ReplayRound {
  const actions: GameAction[] = [];
  let current = start;
  const apply = (action: GameAction) => {
    actions.push(action);
    current = applyMatchAction(current, action).match;
  };
  for (let steps = 0; pendingDecision(current.round).kind !== "round-over"; steps++) {
    if (steps > 5000) throw new Error("局が終わりません");
    const d = pendingDecision(current.round);
    if (d.kind === "draw") apply({ type: "draw", player: d.seat });
    else if (d.kind === "turn") apply(decideCpuTurnAction(current.round, d.seat));
    else if (d.kind === "call") apply(decideCpuCallResponse(current.round, d.seat));
    else throw new Error(`想定外の局面: ${d.kind}`);
  }
  return { start, actions };
}

function setup() {
  const db = openDatabase(":memory:");
  const accounts = new AccountService(db);
  const ranks = new RankService(db);
  const replays = new ReplayStore(db);
  const { profile } = accounts.createGuest("検証太郎");
  return { db, ranks, replays, userId: profile.id };
}

describe("round stats", () => {
  it("counts each recorded round and adds them up per format on the history", () => {
    const { db, ranks, replays, userId } = setup();
    const rng = makeRng(11);
    const start = createMatch("tonpuusen", rng);
    const round = playRound(start);
    const expected = summarizeRound(round)!;
    replays.saveRound("m1", 0, round);
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_stats WHERE match_id = 'm1' AND seat >= 0").get()).toEqual({ n: 4 });

    // この人は席2だった、という記録を作る。
    ranks.recordMatch("m1", "tonpuusen", [{ userId, seat: 2, place: 1, finalScore: 30000 }]);
    const mine = expected.find((s) => s.seat === 2)!;
    const history = ranks.history(userId);
    expect(history.roundStats.hanchan.rounds).toBe(0);
    expect(history.roundStats.tonpuusen).toMatchObject({
      rounds: 1,
      wins: +mine.win,
      tsumoWins: +mine.tsumo,
      dealtIn: +mine.dealtIn,
      riichiRounds: +mine.riichi,
      openRounds: +mine.open,
      winPointsTotal: mine.winPoints,
      winTurnTotal: mine.winTurn,
      maxRenchan: mine.dealer ? 1 : 0,
    });
    // 和了の種類は、和了した時だけ1つ数える。
    const kinds = history.winKinds;
    expect(kinds.riichi + kinds.open + kinds.dama).toBe(+mine.win);
  });

  it("counts the longest run of dealer rounds within one match", () => {
    const { db, ranks, userId } = setup();
    const insert = db.prepare(
      "INSERT INTO round_stats (match_id, round_index, seat, dealer, riichi, open, win, tsumo, dealt_in, win_points, win_turn) VALUES (?, ?, 0, ?, 0, 0, 0, 0, 0, 0, 0)",
    );
    // 親の局が 2回続く → 子 → 親 3回続く。別の対局の最初は、前の対局の続きにしない。
    [1, 1, 0, 1, 1, 1].forEach((dealer, i) => insert.run("m1", i, dealer));
    insert.run("m2", 0, 1);
    ranks.recordMatch("m1", "hanchan", [{ userId, seat: 0, place: 2, finalScore: 25000 }]);
    ranks.recordMatch("m2", "hanchan", [{ userId, seat: 0, place: 2, finalScore: 25000 }]);
    expect(ranks.history(userId).roundStats.hanchan.maxRenchan).toBe(3);
  });

  it("backfills rounds that were recorded before counting started, and marks broken records once", () => {
    const { db, replays } = setup();
    const rng = makeRng(23);
    const round = playRound(createMatch("tonpuusen", rng));
    replays.saveRound("old", 0, round);
    replays.saveRound("broken", 0, { start: round.start, actions: round.actions.slice(0, 3) });
    db.exec("DELETE FROM round_stats");

    expect(backfillRoundStats(db)).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_stats WHERE match_id = 'old' AND seat >= 0").get()).toEqual({ n: 4 });
    // 途中で切れた記録は印（seat -1）だけ残り、もう数え直さない。
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_stats WHERE match_id = 'broken' AND seat = -1").get()).toEqual({ n: 1 });
    expect(backfillRoundStats(db)).toBe(0);
  });
});
