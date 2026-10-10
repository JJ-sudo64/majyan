import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { AdminReport, AdminStats, AdminUser, RankedHistoryResponse } from "@majyan/core";
import { AccountService } from "../src/accounts.js";
import { runAdmin } from "../src/admin.js";
import { CollectionService } from "../src/collection.js";
import { openDatabase } from "../src/db.js";
import { createApiHandler } from "../src/httpApi.js";
import { InboxService } from "../src/inbox.js";
import { isNameBlocked, ModerationService, ReportError } from "../src/moderation.js";
import { RankService } from "../src/ranks.js";
import { WalletService } from "../src/wallet.js";

describe("isNameBlocked", () => {
  it("blocks impersonation and abuse however it is written", () => {
    for (const name of ["運営", "公式サポート", "ＡＤＭＩＮ", "a.d.m.i.n", "アドミン管理者", "死ね", "ｆｕｃｋ", "F U C K", "チンコ", "スタッフ"]) {
      expect(isNameBlocked(name), name).toBe(true);
    }
  });

  it("lets ordinary names through", () => {
    for (const name of ["たろう", "麻雀大好き", "Alice", "かすみ", "くずは", "シネマ好き", "よしこ", "ぶどうgrape", "A", "東風太郎"]) {
      expect(isNameBlocked(name), name).toBe(false);
    }
  });
});

function setup() {
  const db = openDatabase(":memory:");
  const clock = { t: Date.UTC(2026, 9, 10, 3, 0, 0) };
  const now = () => clock.t;
  const accounts = new AccountService(db, now);
  const moderation = new ModerationService(db, now);
  const a = accounts.createGuest("A");
  const b = accounts.createGuest("わるい名前");
  const c = accounts.createGuest("C");
  /** A・B・CPU・CPU の卓の記録を作る（Cは出ていない）。 */
  function match(id: string) {
    db.prepare("INSERT INTO ranked_matches (id, format, finished_at) VALUES (?, 'tonpuusen', ?)").run(id, now());
    const seat = db.prepare(
      "INSERT INTO ranked_match_seats (match_id, seat, user_id, name, character_id, card_id, place, final_score) VALUES (?, ?, ?, ?, 'masato', NULL, ?, 25000)",
    );
    seat.run(id, 0, a.profile.id, "A", 1);
    seat.run(id, 1, b.profile.id, "わるい名前", 2);
    seat.run(id, 2, null, "CPU-A", 3);
    seat.run(id, 3, null, "CPU-B", 4);
  }
  match("m1");
  return { db, clock, now, accounts, moderation, a, b, c, match };
}

describe("ModerationService", () => {
  it("accepts a report only against a human from a match the reporter played, once", () => {
    const { moderation, a, b, c } = setup();
    expect(() => moderation.report(c.profile.id, "m1", 1, "name")).toThrow(ReportError); // 出ていない対局
    expect(() => moderation.report(a.profile.id, "m1", 2, "name")).toThrow(ReportError); // CPU
    expect(() => moderation.report(a.profile.id, "m1", 0, "name")).toThrow(ReportError); // 自分
    expect(() => moderation.report(a.profile.id, "m1", 1, "made-up")).toThrow(ReportError);
    expect(() => moderation.report(a.profile.id, "no-such", 1, "name")).toThrow(ReportError);
    expect(moderation.openCount()).toBe(0);

    moderation.report(a.profile.id, "m1", 1, "name");
    expect(() => moderation.report(a.profile.id, "m1", 1, "stalling")).toThrow("すでに通報");
    expect(moderation.list(true)).toMatchObject([
      { targetId: b.profile.id, reporterId: a.profile.id, reason: "name", targetNameThen: "わるい名前", targetReporters: 1, handled: false },
    ]);
  });

  it("caps reports per day", () => {
    const { moderation, a, match, clock } = setup();
    for (let i = 0; i < 10; i++) {
      match(`x${i}`);
      moderation.report(a.profile.id, `x${i}`, 1, "other");
    }
    expect(() => moderation.report(a.profile.id, "m1", 1, "other")).toThrow("多すぎ");
    clock.t += 25 * 60 * 60_000;
    moderation.report(a.profile.id, "m1", 1, "other");
  });

  it("is handled from the admin command, including renaming the reported player", () => {
    const { db, now, moderation, accounts, a, b } = setup();
    moderation.report(a.profile.id, "m1", 1, "name");
    const listed = runAdmin(db, ["report", "list"], now);
    expect(listed[0]).toContain("不適切な名前");
    expect(listed[0]).toContain("わるい名前");

    expect(runAdmin(db, ["user", "rename", "--to", b.profile.id], now)[0]).toMatch(/プレイヤー\d{4}/);
    const renamed = accounts.getProfile(b.profile.id)!.displayName;
    expect(renamed).toMatch(/^プレイヤー\d{4}$/);
    // 戦績に残っている名前も変わる。
    expect(db.prepare("SELECT name FROM ranked_match_seats WHERE match_id = 'm1' AND seat = 1").get()).toEqual({ name: renamed });
    expect(runAdmin(db, ["report", "list"], now)[0]).toContain(`今の名前: ${renamed}`);

    expect(runAdmin(db, ["report", "done", "1"], now)[0]).toContain("対応済みにしました");
    expect(runAdmin(db, ["report", "list"], now)[0]).toContain("ありません");
    expect(runAdmin(db, ["report", "list", "--all"], now)[0]).toContain("対応済み");
  });
});

describe("moderation over HTTP", () => {
  it("rejects blocked names, takes a report from the history screen's seat number, and shows it to the admin", async () => {
    const base = setup();
    const { db, accounts, moderation, a, b, now } = base;
    const ranks = new RankService(db);
    const wallet = new WalletService(db, now);
    const collections = new CollectionService(db, Math.random, now, wallet);
    const inbox = new InboxService(db, collections, wallet, now);
    const TOKEN = "admin-token-for-tests";
    const handleApi = createApiHandler({
      accounts,
      ranks,
      collections,
      wallet,
      moderation,
      admin: { db, inbox, ranks, wallet, accounts, moderation, token: TOKEN },
      now,
    });
    const server = createServer(async (req, res) => {
      if (!(await handleApi(req, res))) res.writeHead(418).end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const call = (path: string, body?: unknown, headers: Record<string, string> = { Authorization: `Bearer ${a.token}` }) =>
      fetch(`${origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const admin = { "X-Admin-Token": TOKEN };
    try {
      expect((await call("/guest", { displayName: "運営チーム" }, {})).status).toBe(400);
      expect((await call("/me/name", { displayName: "公式" })).status).toBe(400);
      expect((await call("/me/name", { displayName: "A2" })).status).toBe(200);

      // 戦績はranked_resultsから引くので、Aの結果も入れておく。
      db.prepare(
        `INSERT INTO ranked_results (match_id, user_id, seat, place, final_score, delta, tier_before, level_before, points_before, tier_after, level_after, points_after)
         VALUES ('m1', ?, 0, 1, 25000, 10, 0, 1, 0, 0, 1, 10)`,
      ).run(a.profile.id);
      const history = (await (await call("/me/history")).json()) as RankedHistoryResponse;
      const target = history.recent[0]!.seats.find((s) => s.name === "わるい名前")!;
      expect(target.seat).toBe(1);

      expect((await call("/reports", { matchId: "m1", seat: target.seat, reason: "name" })).status).toBe(200);
      expect((await call("/reports", { matchId: "m1", seat: target.seat, reason: "name" })).status).toBe(409);

      expect(((await (await call("/admin/stats", undefined, admin)).json()) as AdminStats).openReports).toBe(1);
      const reports = (await (await call("/admin/reports", undefined, admin)).json()) as AdminReport[];
      expect(reports).toMatchObject([{ targetId: b.profile.id, reason: "name" }]);
      const users = (await (await call("/admin/users/rename", { id: b.profile.id }, admin)).json()) as AdminUser[];
      expect(users[0]!.displayName).toMatch(/^プレイヤー\d{4}$/);
      expect((await (await call("/admin/reports/done", { id: reports[0]!.id }, admin)).json()) as AdminReport[]).toEqual([]);
      expect(((await (await call("/admin/reports?all=1", undefined, admin)).json()) as AdminReport[])[0]!.handled).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe("suspension", () => {
  it("keeps a suspended account out of rooms, the ranked queue and the shop until it ends", async () => {
    const { db, clock, now, accounts, a } = setup();
    const { RoomManager } = await import("../src/rooms.js");
    const { Matchmaker } = await import("../src/matchmaking.js");
    const { ShopService } = await import("../src/shop.js");
    const { SUSPENDED_FOREVER } = await import("@majyan/core");
    const ranks = new RankService(db);
    const rooms = new RoomManager({ authenticate: (token) => accounts.authenticate(token), ranks });
    const matchmaker = new Matchmaker({ rooms, ranks, authenticate: (token) => accounts.authenticate(token), cpuFillMs: 60_000 });
    const messages: { t: string; message?: string; fatal?: boolean }[] = [];
    const client = { id: "c1", send: (m: { t: string }) => void messages.push(m) };
    try {
      expect(runAdmin(db, ["user", "suspend", "--to", a.profile.id, "--days", "3", "--reason", "テスト"], now)[0]).toContain("利用停止にしました");
      expect(accounts.authenticate(a.token)!.suspendedUntil).toBe(clock.t + 3 * 24 * 60 * 60_000);

      rooms.handleMessage(client, { t: "join", room: "abc", authToken: a.token, unitId: null });
      expect(messages.at(-1)).toMatchObject({ t: "error", fatal: true });
      expect(messages.at(-1)!.message).toContain("利用を停止されています");
      matchmaker.handleMessage(client, { t: "queueRanked", authToken: a.token, format: "tonpuusen", unitId: null });
      expect(messages).toHaveLength(2);
      expect(messages.at(-1)!.message).toContain("利用を停止されています");

      // 期限が過ぎれば、何もしなくても戻る。
      clock.t += 3 * 24 * 60 * 60_000 + 1;
      expect(accounts.authenticate(a.token)!.suspendedUntil).toBeNull();
      rooms.handleMessage(client, { t: "join", room: "abc", authToken: a.token, unitId: null });
      expect(messages.at(-1)!.t).toBe("lobby");

      // 無期限と解除。
      runAdmin(db, ["user", "suspend", "--to", a.profile.id], now);
      expect(accounts.authenticate(a.token)!.suspendedUntil).toBe(SUSPENDED_FOREVER);
      const wallet = new WalletService(db, now);
      const shop = new ShopService(db, wallet, { testMode: true, now });
      const handleApi = createApiHandler({ accounts, ranks, collections: new CollectionService(db, Math.random, now, wallet), wallet, shop, now });
      const server = createServer(async (req, res) => void (await handleApi(req, res)));
      await new Promise<void>((r) => server.listen(0, r));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const checkout = () =>
        fetch(`${origin}/api/shop/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}`, Origin: origin },
          body: JSON.stringify({ productId: "jade-160" }),
        });
      try {
        shop.declareBirthMonth(a.profile.id, "1990-01");
        expect((await checkout()).status).toBe(403);
        expect(runAdmin(db, ["user", "unsuspend", "--to", a.profile.id], now)[0]).toContain("解きました");
        expect((await checkout()).status).toBe(200);
      } finally {
        server.close();
      }
    } finally {
      matchmaker.dispose();
    }
  });
});
