import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { AccountService } from "../src/accounts.js";
import { RankService } from "../src/ranks.js";
import { WalletService } from "../src/wallet.js";
import { jstDayStart, MissionError, MissionService } from "../src/missions.js";

describe("daily missions", () => {
  it("counts today's ranked games, pays each reward once and resets at midnight JST", () => {
    let t = Date.parse("2026-10-07T23:00:00+09:00");
    const now = () => t;
    const db = openDatabase(":memory:");
    const accounts = new AccountService(db, now);
    const ranks = new RankService(db, now);
    const wallet = new WalletService(db, now);
    const missions = new MissionService(db, wallet, now);
    const id = accounts.createGuest("A").profile.id;
    const play = (matchId: string, place: 1 | 2 | 3 | 4) => ranks.recordMatch(matchId, "tonpuusen", [{ userId: id, seat: 0, place, finalScore: 25000 }]);
    const view = () => Object.fromEntries(missions.list(id).map((m) => [m.id, [m.progress, m.claimed]]));

    expect(view()).toEqual({ "daily-ranked-1": [0, false], "daily-top2-1": [0, false], "daily-ranked-3": [0, false] });
    expect(() => missions.claim(id, "daily-ranked-1")).toThrow(MissionError);

    play("m1", 3);
    play("m2", 2);
    expect(view()).toEqual({ "daily-ranked-1": [1, false], "daily-top2-1": [1, false], "daily-ranked-3": [2, false] });
    expect(missions.claimableCount(id)).toBe(2);
    const before = wallet.balance(id).free;
    expect(missions.claim(id, null)).toBe(60);
    expect(wallet.balance(id).free).toBe(before + 60);
    expect(missions.claim(id, null)).toBe(0);
    expect(wallet.history(id)[0]).toMatchObject({ reason: "mission" });

    // 日付が変わるとリセット（前日の対局は数えない）。
    t = Date.parse("2026-10-08T00:30:00+09:00");
    expect(missions.resetsAt()).toBe(Date.parse("2026-10-09T00:00:00+09:00"));
    expect(view()).toEqual({ "daily-ranked-1": [0, false], "daily-top2-1": [0, false], "daily-ranked-3": [0, false] });
    for (const m of ["m3", "m4", "m5", "m6"]) play(m, 4);
    expect(view()["daily-ranked-3"]).toEqual([3, false]); // 目標で止まる
    expect(missions.claim(id, "daily-ranked-3")).toBe(50);
  });

  it("finds the JST day start", () => {
    expect(jstDayStart(Date.parse("2026-10-07T15:30:00Z"))).toBe(Date.parse("2026-10-08T00:00:00+09:00"));
  });
});
