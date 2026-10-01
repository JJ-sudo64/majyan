import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_LIMIT_RULES, type ServerMessage, type OnlineSeatView } from "@majyan/core";
import { RoomManager, type Client } from "../src/rooms.js";
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
    // サーバーは実際にはJSONで送るため、JSONにできない値が混ざっていないかも確かめる。
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

function join(rooms: RoomManager, client: TestClient, name: string, room = "abc") {
  rooms.handleMessage(client, { t: "join", room, name, characterId: null, cardId: null });
}

/** 対局が終わるまで（または上限まで）時間を進める。 */
function runUntilFinished(client: TestClient, limitMs = 60 * 60_000) {
  for (let t = 0; t < limitMs; t += 1000) {
    vi.advanceTimersByTime(1000);
    if (client.view.match.finished) return;
  }
  throw new Error("対局が終わりません");
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lobby", () => {
  it("gathers players under the same passphrase and makes the first one host", () => {
    const rooms = new RoomManager({ rng: makeRng(1), timing: FAST });
    const a = new TestClient("a");
    const b = new TestClient("b");
    const other = new TestClient("c");
    join(rooms, a, "あゆむ");
    join(rooms, b, "ともだち");
    join(rooms, other, "べつ", "xyz");
    const lobby = a.last("lobby")!;
    expect(lobby.members.map((m) => [m.name, m.isHost, m.isYou])).toEqual([
      ["あゆむ", true, true],
      ["ともだち", false, false],
    ]);
    expect(b.last("lobby")!.members[1]!.isYou).toBe(true);
    expect(other.last("lobby")!.members).toHaveLength(1);
  });

  it("rejects duplicate names and a fifth player", () => {
    const rooms = new RoomManager({ rng: makeRng(1), timing: FAST });
    const clients = [0, 1, 2, 3].map((i) => new TestClient(`c${i}`));
    clients.forEach((c, i) => join(rooms, c, `p${i}`));
    const dup = new TestClient("dup");
    join(rooms, dup, "p0");
    expect(dup.last("error")?.fatal).toBe(true);
    const fifth = new TestClient("fifth");
    join(rooms, fifth, "p4");
    expect(fifth.last("error")?.message).toContain("満員");
  });

  it("only lets the host start", () => {
    const rooms = new RoomManager({ rng: makeRng(1), timing: FAST });
    const a = new TestClient("a");
    const b = new TestClient("b");
    join(rooms, a, "A");
    join(rooms, b, "B");
    rooms.handleMessage(b, { t: "start", format: "tonpuusen", continueBelowZero: false });
    expect(b.last("state")).toBeUndefined();
    expect(b.last("error")).toBeDefined();
    rooms.handleMessage(a, { t: "start", format: "tonpuusen", continueBelowZero: false });
    expect(a.last("state")).toBeDefined();
    expect(b.last("state")).toBeDefined();
  });

  it("hands the host to the next member when the host leaves, and removes empty rooms", () => {
    const rooms = new RoomManager({ rng: makeRng(1), timing: FAST });
    const a = new TestClient("a");
    const b = new TestClient("b");
    join(rooms, a, "A");
    join(rooms, b, "B");
    rooms.disconnect(a);
    expect(b.last("lobby")!.members).toEqual([expect.objectContaining({ name: "B", isHost: true })]);
    rooms.disconnect(b);
    expect(rooms.roomCount).toBe(0);
  });
});

describe("match over the network", () => {
  function startTwoPlayers(seed: number) {
    const rooms = new RoomManager({ rng: makeRng(seed), timing: FAST });
    const a = new TestClient("a");
    const b = new TestClient("b");
    join(rooms, a, "A");
    join(rooms, b, "B");
    rooms.handleMessage(a, { t: "start", format: "tonpuusen", continueBelowZero: false });
    return { rooms, a, b };
  }

  it("sends each player only their own hand, from their own seat", () => {
    const { a, b } = startTwoPlayers(2);
    for (const c of [a, b]) {
      const round = c.view.match.round;
      expect(round.players[0]!.hand.concealed.every((t) => !t.hidden)).toBe(true);
      for (const seat of [1, 2, 3]) {
        expect(round.players[seat]!.hand.concealed.every((t) => t.hidden)).toBe(true);
      }
      expect(round.wall.liveTiles.every((t) => t.hidden)).toBe(true);
    }
    // 2人の席は別々で、相手から見た自分の名前の位置が座席の差と一致する。
    const aNames = a.view.seats.map((s) => s.name);
    const bNames = b.view.seats.map((s) => s.name);
    expect(aNames[0]).toBe("A");
    expect(bNames[0]).toBe("B");
    const bFromA = aNames.indexOf("B");
    expect(bNames[(4 - bFromA) % 4]).toBe("A");
    expect(a.view.seats.filter((s) => s.isCpu)).toHaveLength(2);
  });

  it("finishes a whole match when the humans never act (timeouts + CPUs)", () => {
    const { a, b } = startTwoPlayers(3);
    runUntilFinished(a);
    expect(a.view.match.finished).toBe(true);
    expect(b.view.match.finished).toBe(true);
    expect(a.view.match.scores.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
  });

  it("accepts the player's own discard and rejects acting for another seat", () => {
    const { rooms, a } = startTwoPlayers(4);
    // 自分の手番が来るまで進める。
    for (let i = 0; i < 2000 && !a.view.options.turn; i++) vi.advanceTimersByTime(10);
    const view = a.view;
    expect(view.options.turn).not.toBeNull();
    const tile = view.match.round.players[0]!.hand.concealed[0]!;

    rooms.handleMessage(a, { t: "action", action: { type: "discard", player: 1, tileId: tile.id, tsumogiri: false } });
    expect(a.last("error")).toBeDefined();
    expect(a.view.options.turn).not.toBeNull();

    rooms.handleMessage(a, { t: "action", action: { type: "discard", player: 0, tileId: tile.id, tsumogiri: false } });
    const after = a.view.match.round.players[0]!;
    expect(after.discards.at(-1)?.tile.id).toBe(tile.id);
    expect(a.view.options.turn).toBeNull();
  });

  it("refuses draws from clients", () => {
    const { rooms, a } = startTwoPlayers(5);
    rooms.handleMessage(a, { t: "action", action: { type: "draw", player: 0 } });
    expect(a.last("error")?.message).toContain("送れません");
  });

  it("lets a disconnected player come back to the same seat with the same name", () => {
    const { rooms, a, b } = startTwoPlayers(6);
    const seatsBefore = a.view.seats.map((s) => s.name);
    rooms.disconnect(b);
    vi.advanceTimersByTime(50);
    expect(a.view.seats.find((s) => s.name === "B")?.disconnected).toBe(true);

    const intruder = new TestClient("x");
    join(rooms, intruder, "C");
    expect(intruder.last("error")?.fatal).toBe(true);

    const b2 = new TestClient("b2");
    join(rooms, b2, "B");
    expect(b2.view.seats[0]!.name).toBe("B");
    expect(a.view.seats.map((s) => s.name)).toEqual(seatsBefore);
    expect(a.view.seats.find((s) => s.name === "B")?.disconnected).toBe(false);
  });

  it("moves on from the result screen once every human pressed next", () => {
    const { rooms, a, b } = startTwoPlayers(7);
    for (let i = 0; i < 100000 && !a.view.pendingRoundEnd; i++) vi.advanceTimersByTime(10);
    expect(a.view.pendingRoundEnd).toBe(true);
    const roundBefore = a.view.match.round;
    rooms.handleMessage(a, { t: "nextRound" });
    expect(a.view.roundEndAcknowledged).toBe(true);
    expect(a.view.pendingRoundEnd).toBe(true);
    rooms.handleMessage(b, { t: "nextRound" });
    expect(a.view.pendingRoundEnd).toBe(false);
    expect(a.view.match.round).not.toEqual(roundBefore);
  });
});

describe("clock visibility", () => {
  it("never shows another player's call-decision clock", () => {
    const rooms = new RoomManager({ rng: makeRng(8), timing: FAST });
    const a = new TestClient("a");
    const b = new TestClient("b");
    join(rooms, a, "A");
    join(rooms, b, "B");
    rooms.handleMessage(a, { t: "start", format: "tonpuusen", continueBelowZero: false });
    for (let i = 0; i < 20000 && !a.view.match.finished; i++) vi.advanceTimersByTime(10);
    let ownCallClocks = 0;
    for (const c of [a, b]) {
      for (const m of c.received) {
        if (m.t !== "state" || !m.view.clock) continue;
        if (m.view.clock.kind === "call") {
          expect(m.view.clock.seat).toBe(0);
          ownCallClocks++;
        }
      }
    }
    expect(ownCallClocks).toBeGreaterThan(0);
  });
});

describe("taking over a seat", () => {
  it("moves the seat to a new connection with the same name and kicks the old one", () => {
    const rooms = new RoomManager({ rng: makeRng(9), timing: FAST });
    const a = new TestClient("a");
    join(rooms, a, "A");
    rooms.handleMessage(a, { t: "start", format: "tonpuusen", continueBelowZero: false });
    const a2 = new TestClient("a2");
    join(rooms, a2, "A");
    expect(a.last("error")?.fatal).toBe(true);
    expect(a2.view.seats[0]!.name).toBe("A");
    // 古い接続が後から切れても、新しい接続の席は切断扱いにならない。
    const before = a2.received.length;
    rooms.disconnect(a);
    vi.advanceTimersByTime(20);
    expect(a2.received.length).toBeGreaterThan(before);
    expect(a2.view.seats[0]!.disconnected).toBe(false);
  });
});
