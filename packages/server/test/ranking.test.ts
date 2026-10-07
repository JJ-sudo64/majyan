import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { AccountService, DELETED_USER_NAME } from "../src/accounts.js";
import { RankService } from "../src/ranks.js";

function setup() {
  const db = openDatabase(":memory:");
  const accounts = new AccountService(db);
  const ranks = new RankService(db);
  const setRank = (userId: string, tier: number, level: number, points: number, games = 1) =>
    db
      .prepare(
        `INSERT INTO user_ranks (user_id, tier, level, points, games_played, updated_at) VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, level = excluded.level, points = excluded.points, games_played = excluded.games_played`,
      )
      .run(userId, tier, level, points, games);
  return { db, accounts, ranks, setRank };
}

describe("ranking", () => {
  it("orders by rank, shares a position on ties, and finds you outside the top", () => {
    const { accounts, ranks, setRank } = setup();
    const [a, b, c, d] = ["A", "B", "C", "D"].map((n) => accounts.createGuest(n).profile);
    const never = accounts.createGuest("未対局").profile;
    setRank(a!.id, 1, 0, 100);
    setRank(b!.id, 2, 1, 0);
    setRank(c!.id, 1, 0, 100);
    setRank(d!.id, 0, 0, 5);
    setRank(never.id, 4, 0, 0, 0); // 打っていない人は載らない

    const r = ranks.ranking(d!.id, 3);
    expect(r.top.map((e) => [e.displayName, e.position])).toEqual([
      ["B", 1],
      ["A", 2],
      ["C", 2],
    ]);
    expect(r.you).toMatchObject({ displayName: "D", position: 4, isYou: true });
    expect(r.totalPlayers).toBe(4);
    expect(ranks.ranking(never.id).you).toBeNull();
  });
});

describe("account deletion", () => {
  it("locks the account out, hides it from the ranking and renames it everywhere, but keeps its records", () => {
    const { db, accounts, ranks, setRank } = setup();
    const { profile, token } = accounts.createGuest("消える人");
    accounts.setTransferPassword(profile.id, "password123");
    const code = accounts.transferCode(profile.id)!;
    const other = accounts.createGuest("残る人").profile;
    setRank(profile.id, 3, 0, 0);
    setRank(other.id, 0, 0, 0);
    ranks.recordMatch("m1", "tonpuusen", [
      { userId: profile.id, seat: 0, place: 1, finalScore: 40000 },
      { userId: other.id, seat: 1, place: 2, finalScore: 30000 },
    ], [
      { seat: 0, userId: profile.id, name: "消える人", characterId: "masato", cardId: null, place: 1, finalScore: 40000 },
      { seat: 1, userId: other.id, name: "残る人", characterId: "zeno", cardId: null, place: 2, finalScore: 30000 },
    ]);

    accounts.deleteAccount(profile.id);

    expect(accounts.authenticate(token)).toBeNull();
    expect(accounts.loginWithTransfer(code, "password123")).toBeNull();
    expect(ranks.ranking(other.id).top.map((e) => e.displayName)).toEqual(["残る人"]);
    expect(ranks.history(other.id).recent[0]?.seats.map((s) => s.name)).toEqual([DELETED_USER_NAME, "残る人"]);
    // 記録そのものは残る。
    expect((db.prepare("SELECT COUNT(*) AS n FROM ranked_results WHERE user_id = ?").get(profile.id) as { n: number }).n).toBe(1);
  });
});
