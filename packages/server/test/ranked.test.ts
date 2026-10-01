import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_LIMIT_RULES, type ServerMessage, type OnlineSeatView, type MatchFormat } from "@majyan/core";
import { RoomManager, type Client } from "../src/rooms.js";
import { AccountService } from "../src/accounts.js";
import { openDatabase, type Database } from "../src/db.js";
import { RankService } from "../src/ranks.js";
import { Matchmaker } from "../src/matchmaking.js";
import type { SessionTiming } from "../src/matchSession.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const FAST: SessionTiming = {
  cpuThinkMs: 10,
  timeStopBonusDrawMs: 10,
  roundEndWaitMs: 50,
  disconnectedActMs: 10,
  rules: { ...DEFAULT_TIME_LIMIT_RULES, perDecisionMs: 100, bankMs: 100, networkGraceMs: 10 },
};

class TestClient implements Client {
  readonly received: ServerMessage[] = [];
  constructor(readonly id: string) {}
  send(message: ServerMessage) {
    this.received.push(JSON.parse(JSON.stringify(message)) as ServerMessage);
  }
  last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const m = this.received[i]!;
      if (m.t === t) return m as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
  get view(): OnlineSeatView {
    return this.last("state")!.view;
  }
}

let db: Database;
let accounts: AccountService;
let ranks: RankService;
let rooms: RoomManager;
let matchmaker: Matchmaker | undefined;

function setup(cpuFillMs = 20_000) {
  db = openDatabase(":memory:");
  accounts = new AccountService(db);
  ranks = new RankService(db);
  const authenticate = (token: string) => accounts.authenticate(token);
  rooms = new RoomManager({ authenticate, ranks, rng: makeRng(5), timing: FAST });
  matchmaker = new Matchmaker({ rooms, ranks, authenticate, cpuFillMs });
  return matchmaker;
}

function player(name: string) {
  const { profile, token } = accounts.createGuest(name);
  return { client: new TestClient(name), profile, token };
}

function queue(p: ReturnType<typeof player>, format: MatchFormat = "tonpuusen") {
  matchmaker!.handleMessage(p.client, { t: "queueRanked", authToken: p.token, format, characterId: null, cardId: null });
}

/** 段位を直接書き換える（マッチングの段位差を試すため）。 */
function setRank(userId: string, tier: number, level: number, points: number) {
  db.prepare("INSERT INTO user_ranks (user_id, tier, level, points, games_played, updated_at) VALUES (?, ?, ?, ?, 0, 0)").run(
    userId,
    tier,
    level,
    points,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  matchmaker?.dispose();
  matchmaker = undefined;
  vi.useRealTimers();
});

describe("RankService", () => {
  it("starts everyone at 下雀1 and applies a match once", () => {
    setup();
    const a = player("A");
    expect(ranks.get(a.profile.id)).toMatchObject({ label: "下雀1", points: 0, gamesPlayed: 0 });
    const first = ranks.recordMatch("m1", "hanchan", [{ userId: a.profile.id, seat: 0, place: 1, finalScore: 35000 }]);
    expect(first.get(a.profile.id)).toMatchObject({ place: 1, delta: 40, after: { label: "下雀2", points: 0, gamesPlayed: 1 } });
    // 同じ対局をもう一度渡しても段位は動かない。
    const again = ranks.recordMatch("m1", "hanchan", [{ userId: a.profile.id, seat: 0, place: 1, finalScore: 35000 }]);
    expect(again.size).toBe(0);
    expect(ranks.get(a.profile.id)).toMatchObject({ label: "下雀2", gamesPlayed: 1 });
  });
});

describe("Matchmaker", () => {
  it("seats four players of similar rank together right away", () => {
    setup();
    const ps = ["A", "B", "C", "D"].map(player);
    ps.forEach((p) => queue(p));
    for (const p of ps) {
      expect(p.client.last("matchFound")?.room).toMatch(/^ranked-[\w-]{12}$/);
      expect(p.client.view.seats.every((s) => !s.isCpu)).toBe(true);
      expect(p.client.view.seats[0]!.rankLabel).toBe("下雀1");
    }
    expect(new Set(ps.map((p) => p.client.last("matchFound")!.room)).size).toBe(1);
    expect(matchmaker!.waitingCount).toBe(0);
  });

  it("does not mix far-apart ranks, and fills with CPUs after waiting", () => {
    setup(20_000);
    const low = ["A", "B"].map(player);
    const high = ["C", "D"].map(player);
    for (const p of high) setRank(p.profile.id, 4, 0, 2500); // 雀帝1
    [...low, ...high].forEach((p) => queue(p));
    expect(low[0]!.client.last("queued")?.cpuFillInMs).toBe(20_000);
    expect(low[0]!.client.last("matchFound")).toBeUndefined();

    vi.advanceTimersByTime(21_000);
    const lowRoom = low[0]!.client.last("matchFound")!.room;
    const highRoom = high[0]!.client.last("matchFound")!.room;
    expect(low[1]!.client.last("matchFound")!.room).toBe(lowRoom);
    expect(high[1]!.client.last("matchFound")!.room).toBe(highRoom);
    expect(lowRoom).not.toBe(highRoom);
    expect(low[0]!.client.view.seats.filter((s) => s.isCpu)).toHaveLength(2);
  });

  it("keeps formats apart, and supports cancelling and disconnecting", () => {
    setup();
    const [a, b, c, d] = ["A", "B", "C", "D"].map(player);
    queue(a!, "hanchan");
    queue(b!, "tonpuusen");
    queue(c!, "tonpuusen");
    queue(d!, "tonpuusen");
    matchmaker!.handleMessage(c!.client, { t: "cancelQueue" });
    expect(c!.client.last("queueCancelled")).toBeDefined();
    matchmaker!.remove(d!.client);
    expect(matchmaker!.waitingCount).toBe(2);
    expect(a!.client.last("matchFound")).toBeUndefined();
  });

  it("rejects an invalid account", () => {
    setup();
    const c = new TestClient("x");
    matchmaker!.handleMessage(c, { t: "queueRanked", authToken: "y".repeat(43), format: "hanchan", characterId: null, cardId: null });
    expect(c.last("error")?.fatal).toBe(true);
    expect(matchmaker!.waitingCount).toBe(0);
  });
});

describe("ranked match", () => {
  it("updates every human's rank when the match ends, matching the final placement", () => {
    setup(1000);
    const a = player("A");
    const b = player("B");
    queue(a);
    queue(b);
    vi.advanceTimersByTime(1500);
    for (let t = 0; t < 60 * 60_000 && !a.client.last("rankResult"); t += 1000) vi.advanceTimersByTime(1000);

    expect(a.client.view.match.finished).toBe(true);
    for (const p of [a, b]) {
      const result = p.client.last("rankResult")!.result;
      const v = p.client.view;
      // 自分(座席0)の順位が最終順位と一致し、DBの段位とも一致する。
      expect(result.place).toBe(v.match.finalRanking!.indexOf(0) + 1);
      expect(ranks.get(p.profile.id)).toMatchObject({
        tier: result.after.tier,
        level: result.after.level,
        points: result.after.points,
        gamesPlayed: 1,
      });
    }
    const rows = db.prepare("SELECT COUNT(*) AS n FROM ranked_results").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("lets a player who dropped out return to the running match instead of queueing again", () => {
    setup();
    const ps = ["A", "B", "C", "D"].map(player);
    ps.forEach((p) => queue(p));
    const room = ps[0]!.client.last("matchFound")!.room;
    rooms.disconnect(ps[0]!.client);

    const back = new TestClient("A-again");
    matchmaker!.handleMessage(back, { t: "queueRanked", authToken: ps[0]!.token, format: "tonpuusen", characterId: null, cardId: null });
    expect(back.last("matchFound")?.room).toBe(room);
    rooms.handleMessage(back, { t: "join", room, authToken: ps[0]!.token, characterId: null, cardId: null });
    expect(back.view.seats[0]!.name).toBe("A");

    // 卓に座っていない人は、合言葉が分かっても入れない。
    const outsider = player("E");
    rooms.handleMessage(outsider.client, { t: "join", room, authToken: outsider.token, characterId: null, cardId: null });
    expect(outsider.client.last("error")?.fatal).toBe(true);
  });

  it("plays a ranked match to the end even if everyone leaves, so leaving never dodges a loss", () => {
    setup(1000);
    const a = player("A");
    queue(a);
    vi.advanceTimersByTime(1500);
    expect(a.client.last("matchFound")).toBeDefined();
    rooms.disconnect(a.client);
    for (let t = 0; t < 60 * 60_000 && ranks.get(a.profile.id).gamesPlayed === 0; t += 1000) vi.advanceTimersByTime(1000);
    expect(ranks.get(a.profile.id).gamesPlayed).toBe(1);
    vi.advanceTimersByTime(10);
    expect(rooms.roomCount).toBe(0);
  });
});
