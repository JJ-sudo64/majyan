import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { AdminGift, AdminStats, AdminUser, GachaPickup } from "@majyan/core";
import { openDatabase } from "../src/db.js";
import { AccountService } from "../src/accounts.js";
import { RankService } from "../src/ranks.js";
import { CollectionService } from "../src/collection.js";
import { WalletService } from "../src/wallet.js";
import { InboxService } from "../src/inbox.js";
import { createApiHandler } from "../src/httpApi.js";

async function serve(token: string | undefined) {
  const db = openDatabase(":memory:");
  const accounts = new AccountService(db);
  const ranks = new RankService(db);
  const wallet = new WalletService(db);
  const collections = new CollectionService(db, Math.random, Date.now, wallet);
  const inbox = new InboxService(db, collections, wallet);
  const handleApi = createApiHandler({ accounts, ranks, collections, wallet, inbox, admin: { db, inbox, ranks, wallet, collections, token } });
  const server = createServer(async (req, res) => {
    if (!(await handleApi(req, res))) res.writeHead(418).end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  const call = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(init.token !== undefined ? { "X-Admin-Token": init.token } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  return { db, accounts, inbox, wallet, server, call };
}

describe("admin API", () => {
  it("is disabled without ADMIN_TOKEN", async () => {
    const { server, call } = await serve(undefined);
    try {
      expect((await call("/stats", { token: "anything" })).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("checks the token, locks out guessing, and runs news, gifts and user search", async () => {
    const TOKEN = "correct-horse-battery-staple";
    const { accounts, inbox, wallet, server, call } = await serve(TOKEN);
    try {
      const { profile } = accounts.createGuest("問い合わせ太郎");
      expect((await call("/stats")).status).toBe(401);
      expect((await call("/stats", { token: "wrong" })).status).toBe(401);

      const stats = (await (await call("/stats", { token: TOKEN })).json()) as AdminStats;
      expect(stats).toMatchObject({ users: 1, newUsersToday: 1 });

      expect((await call("/news", { method: "POST", token: TOKEN, body: { title: "メンテ", body: "明日です" } })).status).toBe(200);
      expect(inbox.announcements().map((a) => a.title)).toEqual(["メンテ"]);

      const found = (await (await call(`/users?q=${encodeURIComponent("問い合わせ")}`, { token: TOKEN })).json()) as AdminUser[];
      expect(found.map((u) => u.id)).toEqual([profile.id]);

      const bad = await call("/gifts", { method: "POST", token: TOKEN, body: { title: "x", jade: 10, to: "abc" } });
      expect(bad.status).toBe(400);
      const gifts = (await (
        await call("/gifts", { method: "POST", token: TOKEN, body: { title: "個別", jade: 50, cards: "point-drain", to: profile.id.slice(0, 8) } })
      ).json()) as AdminGift[];
      expect(gifts[0]).toMatchObject({ title: "個別", jade: 50, targetUserId: profile.id, items: [{ kind: "card", id: "point-drain" }] });
      const before = wallet.balance(profile.id).free;
      inbox.claim(profile.id, null);
      expect(wallet.balance(profile.id).free).toBe(before + 50);

      // ピックアップ: 入れる→一覧→終わらせる。中身の無い・知らない対象は400。
      expect((await call("/pickups", { method: "POST", token: TOKEN, body: { title: "空", cards: [] } })).status).toBe(400);
      expect((await call("/pickups", { method: "POST", token: TOKEN, body: { title: "不明", cards: ["nope"] } })).status).toBe(400);
      expect((await call("/pickups", { method: "POST", token: TOKEN, body: { title: "日数", cards: ["point-drain"], days: 0 } })).status).toBe(400);
      const pickups = (await (await call("/pickups", { method: "POST", token: TOKEN, body: { title: "開幕", cards: ["point-drain"], days: 7 } })).json()) as GachaPickup[];
      expect(pickups[0]).toMatchObject({ title: "開幕", items: [{ kind: "card", id: "point-drain" }] });
      expect(pickups[0]!.endsAt - pickups[0]!.startsAt).toBe(7 * 24 * 60 * 60_000);
      const ended = (await (await call("/pickups/end", { method: "POST", token: TOKEN, body: { id: pickups[0]!.id } })).json()) as GachaPickup[];
      expect(ended[0]!.endsAt).toBeLessThanOrEqual(Date.now());

      // 間違いが続くと、正しい合言葉でもしばらく締め出す。
      for (let i = 0; i < 10; i++) await call("/stats", { token: "guess" });
      expect((await call("/stats", { token: TOKEN })).status).toBe(429);
    } finally {
      server.close();
    }
  });
});
