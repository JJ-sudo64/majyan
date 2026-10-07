import { describe, expect, it } from "vitest";
import { MAX_PENDING_FRIEND_REQUESTS, formatFriendCode, normalizeFriendCode, type ServerMessage } from "@majyan/core";
import { openDatabase } from "../src/db.js";
import { AccountService } from "../src/accounts.js";
import { RankService } from "../src/ranks.js";
import { FriendError, FriendService } from "../src/friends.js";
import { RoomManager, type Client } from "../src/rooms.js";

function setup() {
  const db = openDatabase(":memory:");
  const accounts = new AccountService(db);
  const ranks = new RankService(db);
  const rooms = new RoomManager({ authenticate: (t) => accounts.authenticate(t), ranks });
  const friends = new FriendService(db, { ranks, presenceOf: (id) => rooms.presenceOf(id) });
  const person = (name: string) => {
    const { profile, token } = accounts.createGuest(name);
    return { id: profile.id, token, code: friends.codeOf(profile.id) };
  };
  return { db, accounts, rooms, friends, person };
}

describe("friends", () => {
  it("needs the other side's approval, and a crossed request makes friends right away", () => {
    const { friends, person } = setup();
    const a = person("A");
    const b = person("B");
    const c = person("C");
    expect(a.code).toMatch(/^[1-9]\d{9}$/);
    expect(friends.codeOf(a.id)).toBe(a.code);

    friends.request(a.id, formatFriendCode(b.code)); // ハイフン入りでもよい
    expect(friends.list(a.id).outgoing.map((r) => r.displayName)).toEqual(["B"]);
    expect(friends.incomingCount(b.id)).toBe(1);
    expect(friends.list(a.id).friends).toEqual([]);
    expect(() => friends.request(a.id, b.code)).toThrow("すでに申請しています");

    friends.respond(b.id, a.code, true);
    expect(friends.list(a.id).friends.map((f) => f.displayName)).toEqual(["B"]);
    expect(friends.list(b.id).friends.map((f) => f.displayName)).toEqual(["A"]);
    expect(friends.incomingCount(b.id)).toBe(0);
    expect(() => friends.request(b.id, a.code)).toThrow("すでにフレンドです");

    // お互いに申請し合ったら、その場で成立。
    friends.request(c.id, a.code);
    friends.request(a.id, c.code);
    expect(friends.list(c.id).friends.map((f) => f.displayName)).toEqual(["A"]);

    // やめると両方の一覧から消える。
    friends.remove(b.id, a.code);
    expect(friends.list(a.id).friends.map((f) => f.displayName)).toEqual(["C"]);
  });

  it("declines, rejects bad codes and limits pending requests", () => {
    const { friends, person } = setup();
    const a = person("A");
    const b = person("B");
    friends.request(a.id, b.code);
    friends.respond(b.id, a.code, false);
    expect(friends.list(a.id).outgoing).toEqual([]);
    expect(friends.list(b.id).friends).toEqual([]);
    expect(() => friends.respond(b.id, a.code, true)).toThrow(FriendError);
    expect(() => friends.request(a.id, a.code)).toThrow("自分には");
    expect(() => friends.request(a.id, "123")).toThrow("見つかりません");
    for (let i = 0; i < MAX_PENDING_FRIEND_REQUESTS; i++) friends.request(a.id, person(`P${i}`).code);
    expect(() => friends.request(a.id, person("over").code)).toThrow("まで");
  });

  it("drops a withdrawn account from friends and requests", () => {
    const { friends, accounts, person } = setup();
    const a = person("A");
    const b = person("B");
    const c = person("C");
    friends.request(a.id, b.code);
    friends.respond(b.id, a.code, true);
    friends.request(c.id, a.code);
    accounts.deleteAccount(a.id);
    expect(friends.list(b.id).friends).toEqual([]);
    expect(friends.list(c.id).outgoing).toEqual([]);
    expect(() => friends.request(b.id, a.code)).toThrow("見つかりません");
  });

  it("shows a friend waiting in a friend room so you can join it", () => {
    const { friends, rooms, person } = setup();
    const a = person("A");
    const b = person("B");
    friends.request(a.id, b.code);
    friends.respond(b.id, a.code, true);
    expect(friends.list(a.id).friends[0]!.presence).toBeNull();

    const client: Client = { id: "b-client", send: (_m: ServerMessage) => {} };
    rooms.handleMessage(client, { t: "join", room: "あいことば", authToken: b.token, unitId: null });
    expect(friends.list(a.id).friends[0]!.presence).toEqual({ room: "あいことば" });
    rooms.disconnect(client);
    expect(friends.list(a.id).friends[0]!.presence).toBeNull();
  });

  it("normalizes typed codes", () => {
    expect(normalizeFriendCode("１２３４５-67890 ")).toBe("1234567890");
    expect(formatFriendCode("1234567890")).toBe("12345-67890");
  });
});
