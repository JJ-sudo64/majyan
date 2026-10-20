import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { AccountService } from "../src/accounts.js";
import { RankService } from "../src/ranks.js";
import { WalletService } from "../src/wallet.js";
import { jstDayStart, jstWeekStart, MissionError, MissionService } from "../src/missions.js";

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
    const view = () => Object.fromEntries(missions.list(id).filter((m) => m.period === "daily").map((m) => [m.id, [m.progress, m.claimed]]));

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

  it("counts the Monday-to-Sunday week for weekly missions and pays each once", () => {
    let t = Date.parse("2026-10-07T12:00:00+09:00"); // 水曜
    const now = () => t;
    const db = openDatabase(":memory:");
    const accounts = new AccountService(db, now);
    const ranks = new RankService(db, now);
    const wallet = new WalletService(db, now);
    const missions = new MissionService(db, wallet, now);
    const id = accounts.createGuest("A").profile.id;
    const play = (matchId: string, place: 1 | 2 | 3 | 4) => ranks.recordMatch(matchId, "tonpuusen", [{ userId: id, seat: 0, place, finalScore: 25000 }]);
    const weekly = () => Object.fromEntries(missions.list(id).filter((m) => m.period === "weekly").map((m) => [m.id, [m.progress, m.claimed]]));

    expect(missions.weeklyResetsAt()).toBe(Date.parse("2026-10-12T00:00:00+09:00"));
    play("w1", 1);
    t = Date.parse("2026-10-09T12:00:00+09:00"); // 金曜、同じ週
    play("w2", 1);
    play("w3", 3);
    expect(weekly()).toEqual({ "weekly-ranked-10": [3, false], "weekly-top2-5": [2, false], "weekly-first-2": [2, false] });
    expect(missions.claim(id, "weekly-first-2")).toBe(150);
    expect(weekly()["weekly-first-2"]).toEqual([2, true]);
    // 同じ週のうちは受け取り直せず、翌日になっても受け取り済みのまま。
    t = Date.parse("2026-10-11T23:00:00+09:00"); // 日曜
    expect(weekly()["weekly-first-2"]).toEqual([2, true]);
    expect(() => missions.claim(id, "weekly-first-2")).toThrow(MissionError);
    // 月曜0時で新しい週: 進み具合も受け取りもリセット。
    t = Date.parse("2026-10-12T00:10:00+09:00");
    expect(weekly()).toEqual({ "weekly-ranked-10": [0, false], "weekly-top2-5": [0, false], "weekly-first-2": [0, false] });
  });

  it("finds the JST week start", () => {
    expect(jstWeekStart(Date.parse("2026-10-11T23:59:00+09:00"))).toBe(Date.parse("2026-10-05T00:00:00+09:00")); // 日曜→その週の月曜
    expect(jstWeekStart(Date.parse("2026-10-12T00:00:00+09:00"))).toBe(Date.parse("2026-10-12T00:00:00+09:00"));
  });

  it("finds the JST day start", () => {
    expect(jstDayStart(Date.parse("2026-10-07T15:30:00Z"))).toBe(Date.parse("2026-10-08T00:00:00+09:00"));
  });
});
