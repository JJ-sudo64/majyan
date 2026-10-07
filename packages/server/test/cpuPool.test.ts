import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_TIME_LIMIT_RULES,
  applyMatchAction,
  createMatch,
  decideCpuTurnAction,
  pendingDecision,
  randomCharacterIds,
} from "@majyan/core";
import { CpuPool } from "../src/cpuPool.js";
import { openDatabase } from "../src/db.js";
import { AccountService } from "../src/accounts.js";
import { RankService } from "../src/ranks.js";
import { RoomManager } from "../src/rooms.js";

const pool = new CpuPool(2);
afterAll(() => pool.close());

describe("CpuPool", () => {
  it("decides exactly what the main thread would", async () => {
    let match = createMatch("tonpuusen", Math.random, randomCharacterIds(), false, [null, null, null, null]);
    const d = pendingDecision(match.round);
    if (d.kind === "draw") match = applyMatchAction(match, { type: "draw", player: d.seat }).match;
    const seat = match.round.currentTurn;
    const fromWorker = await pool.decide("turn", match.round, seat, DEFAULT_AI_DIFFICULTY);
    expect(fromWorker).toEqual(decideCpuTurnAction(match.round, seat, DEFAULT_AI_DIFFICULTY));
    // 本体で考え直したのではなく、ワーカーが答えたこと。
    expect(pool.isDegraded).toBe(false);
  });

  it("keeps a ranked match moving with CPUs thinking in workers", async () => {
    const db = openDatabase(":memory:");
    const accounts = new AccountService(db);
    const ranks = new RankService(db);
    let decided = 0;
    const rooms = new RoomManager({
      authenticate: (t) => accounts.authenticate(t),
      ranks,
      decideCpu: (kind, round, seat, difficulty) => pool.decide(kind, round, seat, difficulty).then((a) => (decided++, a)),
      timing: {
        cpuThinkMs: 0,
        timeStopBonusDrawMs: 0,
        roundEndWaitMs: 0,
        disconnectedActMs: 0,
        rules: { ...DEFAULT_TIME_LIMIT_RULES, perDecisionMs: 1, bankMs: 1, networkGraceMs: 0 },
      },
    });
    const { profile } = accounts.createGuest("A");
    const client = { id: "c", send() {} };
    const code = rooms.startRankedMatch([{ client, account: profile, unitId: null }], "tonpuusen");
    rooms.disconnect(client); // 抜けた人の席も自動で進む
    // 最初の局が終わって次の局へ進むまで、止まらずに進むこと（Windowsのタイマーは粗いので対局全体は待たない）。
    const session = (rooms as unknown as { rooms: Map<string, { session: { state: { round: { roundNumber: number; honba: number } } } }> }).rooms.get(code)!.session;
    const started = Date.now();
    while (session.state.round.roundNumber === 1 && session.state.round.honba === 0) {
      if (Date.now() - started > 60_000) throw new Error(`最初の局が終わりませんでした（CPUの判断 ${decided} 回）`);
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(decided).toBeGreaterThan(10);
    rooms.disconnect(client);
  }, 90_000);
});
