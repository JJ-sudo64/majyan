import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_LIMIT_RULES, replayRoundFrames, type ServerMessage, type OnlineSeatView, type MatchFormat } from "@majyan/core";
import { RoomManager, type Client } from "../src/rooms.js";
import { AccountService } from "../src/accounts.js";
import { openDatabase, type Database } from "../src/db.js";
import { RankService } from "../src/ranks.js";
import { Matchmaker } from "../src/matchmaking.js";
import { CollectionService } from "../src/collection.js";
import { WalletService } from "../src/wallet.js";
import { ReplayStore } from "../src/replays.js";
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
let collections: CollectionService;
let rooms: RoomManager;
let matchmaker: Matchmaker | undefined;
let replays: ReplayStore;

function setup(cpuFillMs = 20_000) {
  db = openDatabase(":memory:");
  accounts = new AccountService(db);
  ranks = new RankService(db);
  const authenticate = (token: string) => accounts.authenticate(token);
  collections = new CollectionService(db, makeRng(9), () => Date.now());
  replays = new ReplayStore(db);
  rooms = new RoomManager({ authenticate, ranks, collections, wallet: new WalletService(db), rng: makeRng(5), timing: FAST, replays });
  matchmaker = new Matchmaker({ rooms, ranks, authenticate, cpuFillMs });
  return matchmaker;
}

function player(name: string) {
  const { profile, token } = accounts.createGuest(name);
  return { client: new TestClient(name), profile, token };
}

function queue(p: ReturnType<typeof player>, format: MatchFormat = "tonpuusen") {
  matchmaker!.handleMessage(p.client, { t: "queueRanked", authToken: p.token, format, unitId: null });
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

  it("returns place counts and the latest matches first, also for matches recorded before seats were kept", () => {
    setup();
    const a = player("A");
    const id = a.profile.id;
    vi.setSystemTime(1_000);
    ranks.recordMatch("old", "hanchan", [{ userId: id, seat: 0, place: 4, finalScore: -2000 }]);
    vi.setSystemTime(2_000);
    ranks.recordMatch("new", "tonpuusen", [{ userId: id, seat: 2, place: 1, finalScore: 41000 }], [
      { seat: 0, userId: null, name: "CPU 1", characterId: "zeno", cardId: null, place: 2, finalScore: 30000 },
      { seat: 2, userId: id, name: "A", characterId: "masato", cardId: "point-drain", place: 1, finalScore: 41000 },
    ]);
    const h = ranks.history(id);
    expect(h.total).toEqual({ games: 2, places: [1, 0, 0, 1] });
    expect(h.byFormat.hanchan).toEqual({ games: 1, places: [0, 0, 0, 1] });
    expect(h.recent.map((e) => e.matchId)).toEqual(["new", "old"]);
    expect(h.recent[0]!.seats.map((s) => [s.name, s.isYou, s.isCpu])).toEqual([
      ["A", true, false],
      ["CPU 1", false, true],
    ]);
    expect(h.recent[1]!.seats).toEqual([]);
    expect(ranks.history(player("B").profile.id).recent).toEqual([]);
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
    matchmaker!.handleMessage(c, { t: "queueRanked", authToken: "y".repeat(43), format: "hanchan", unitId: null });
    expect(c.last("error")?.fatal).toBe(true);
    expect(matchmaker!.waitingCount).toBe(0);
  });
});

describe("units in matches", () => {
  it("plays the chosen unit with its equipped card, and never someone else's unit", () => {
    setup();
    const ps = ["A", "B", "C", "D"].map(player);
    // 最初から持っているキャラは無いので、2体ずつ持たせておく。
    for (const p of ps) {
      for (const characterId of ["zeno", "masato"]) {
        db.prepare(
          "INSERT INTO character_units (unit_id, user_id, character_id, card_id, source, acquired_at) VALUES (lower(hex(randomblob(12))), ?, ?, NULL, 'test', 0)",
        ).run(p.profile.id, characterId);
      }
    }
    // Bの2体目にカードを付ける。
    const cardId = "point-drain";
    db.prepare("INSERT INTO user_cards (user_id, card_id, count) VALUES (?, ?, 1)").run(ps[1]!.profile.id, cardId);
    const bUnit = collections.units(ps[1]!.profile.id)[1]!;
    collections.equipCard(ps[1]!.profile.id, bUnit.unitId, cardId);
    for (const [i, p] of ps.entries()) {
      matchmaker!.handleMessage(p.client, {
        t: "queueRanked",
        authToken: p.token,
        format: "tonpuusen",
        // AはBのキャラを指定してみる（自分の手持ちに置き換わるはず）。
        unitId: i === 0 || i === 1 ? bUnit.unitId : null,
      });
    }
    const bRound = ps[1]!.client.view.match.round;
    expect(bRound.characterIds[0]).toBe(bUnit.characterId);
    expect(bRound.cardIds[0]).toBe(cardId);
    const aRound = ps[0]!.client.view.match.round;
    expect(collections.units(ps[0]!.profile.id).map((u) => u.characterId)).toContain(aRound.characterIds[0]);
    expect(aRound.cardIds[0]).toBeNull();
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
      expect(result.jadeReward).toBe([50, 30, 20, 10][result.place - 1]);
      expect(ranks.get(p.profile.id)).toMatchObject({
        tier: result.after.tier,
        level: result.after.level,
        points: result.after.points,
        gamesPlayed: 1,
      });
    }
    const rows = db.prepare("SELECT COUNT(*) AS n FROM ranked_results").get() as { n: number };
    expect(rows.n).toBe(2);

    // 戦績には卓の4人（CPUも）が順位順に、本人の名前・キャラ付きで残る。
    const history = ranks.history(a.profile.id);
    const result = a.client.last("rankResult")!.result;
    expect(history.total.games).toBe(1);
    expect(history.byFormat.tonpuusen.places[result.place - 1]).toBe(1);
    expect(history.byFormat.hanchan.games).toBe(0);
    const entry = history.recent[0]!;
    expect(entry).toMatchObject({ format: "tonpuusen", place: result.place, delta: result.delta, rankAfter: result.after.label });
    expect(entry.seats.map((s) => s.place)).toEqual([1, 2, 3, 4]);
    expect(entry.seats.filter((s) => s.isCpu)).toHaveLength(2);
    const you = entry.seats.find((s) => s.isYou)!;
    expect(you).toMatchObject({ name: "A", place: result.place, characterId: a.client.view.match.round.characterIds[0] });
    expect(entry.seats.find((s) => s.name === "B")?.isYou).toBe(false);

    // 牌譜を最初から当て直すと、実際の対局とまったく同じ最終結果になる。
    expect(entry.hasReplay).toBe(true);
    const replay = replays.load(entry.matchId, a.profile.id)!;
    expect(replay.yourSeat).toBe(entry.seats.find((s) => s.isYou) && replay.yourSeat);
    expect(replay.seats.filter((s) => s.isCpu)).toHaveLength(2);
    let last = null;
    for (const [i, round] of replay.rounds.entries()) {
      const frames = replayRoundFrames(round);
      expect(frames.states).toHaveLength(round.actions.length + 1); // 途中で記録と食い違わない
      expect(frames.settled).not.toBeNull();
      // 次の局の始まりの持ち点は、この局の精算後の持ち点と同じ。
      const next = replay.rounds[i + 1];
      if (next) expect(next.start.scores).toEqual(frames.settled!.match.scores);
      last = frames.settled!.match;
    }
    expect(last!.finished).toBe(true);
    const finalBySeat = db.prepare("SELECT seat, final_score FROM ranked_match_seats WHERE match_id = ? ORDER BY seat").all(entry.matchId) as {
      final_score: number;
    }[];
    expect(last!.scores).toEqual(finalBySeat.map((r) => r.final_score));
    // 対局に出ていない人には見せない。
    expect(replays.load(entry.matchId, player("部外者").profile.id)).toBeNull();
  });

  it("lets a player who dropped out return to the running match instead of queueing again", () => {
    setup();
    const ps = ["A", "B", "C", "D"].map(player);
    ps.forEach((p) => queue(p));
    const room = ps[0]!.client.last("matchFound")!.room;
    rooms.disconnect(ps[0]!.client);

    const back = new TestClient("A-again");
    matchmaker!.handleMessage(back, { t: "queueRanked", authToken: ps[0]!.token, format: "tonpuusen", unitId: null });
    expect(back.last("matchFound")?.room).toBe(room);
    rooms.handleMessage(back, { t: "join", room, authToken: ps[0]!.token, unitId: null });
    expect(back.view.seats[0]!.name).toBe("A");

    // 卓に座っていない人は、合言葉が分かっても入れない。
    const outsider = player("E");
    rooms.handleMessage(outsider.client, { t: "join", room, authToken: outsider.token, unitId: null });
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
