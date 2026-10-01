import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { GuestAccountResponse, MeResponse } from "@majyan/core";
import { AccountService, normalizeDisplayName } from "../src/accounts.js";
import { openDatabase } from "../src/db.js";
import { createApiHandler } from "../src/httpApi.js";

describe("AccountService", () => {
  it("creates a guest and finds it again by its token", () => {
    const accounts = new AccountService(openDatabase(":memory:"));
    const { profile, token } = accounts.createGuest("  あゆむ ");
    expect(profile.displayName).toBe("あゆむ");
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(accounts.authenticate(token)).toEqual(profile);
    expect(accounts.authenticate(token + "x")).toBeNull();
    expect(accounts.authenticate(undefined)).toBeNull();
  });

  it("stores only a hash of the token", () => {
    const db = openDatabase(":memory:");
    const { token } = new AccountService(db).createGuest("A");
    const rows = db.prepare("SELECT token_hash FROM auth_tokens").all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(token);
  });

  it("renames, rejecting empty, too long or control-character names", () => {
    const accounts = new AccountService(openDatabase(":memory:"));
    const { profile, token } = accounts.createGuest("A");
    expect(accounts.rename(profile.id, "びー").displayName).toBe("びー");
    expect(accounts.authenticate(token)?.displayName).toBe("びー");
    expect(() => accounts.rename(profile.id, "   ")).toThrow();
    expect(normalizeDisplayName("あ".repeat(12))).toBe("あ".repeat(12));
    expect(normalizeDisplayName("あ".repeat(13))).toBeNull();
    expect(normalizeDisplayName("a\nb")).toBe("ab");
    expect(normalizeDisplayName(42)).toBeNull();
    expect(normalizeDisplayName("�{�b�g")).toBeNull();
  });

  it("keeps accounts in the database file across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "majyan-db-"));
    try {
      const path = join(dir, "sub", "test.db");
      const db1 = openDatabase(path);
      const { token, profile } = new AccountService(db1).createGuest("A");
      db1.close();
      const db2 = openDatabase(path); // マイグレーションは2回目には何もしない
      expect(new AccountService(db2).authenticate(token)).toEqual(profile);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("account HTTP API", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const accounts = new AccountService(openDatabase(":memory:"));
    const handleApi = createApiHandler({ accounts, guestsPerHourPerIp: 3 });
    server = createServer(async (req, res) => {
      if (!(await handleApi(req, res))) res.writeHead(418).end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("creates a guest, reads it back and renames it", async () => {
    const created = await post("/api/guest", { displayName: "ゲスト" });
    expect(created.status).toBe(200);
    const { token, profile } = (await created.json()) as GuestAccountResponse;

    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(((await me.json()) as MeResponse).profile).toEqual(profile);

    const renamed = await post("/api/me/name", { displayName: "新しい名前" }, token);
    expect(((await renamed.json()) as MeResponse).profile.displayName).toBe("新しい名前");
  });

  it("rejects missing/unknown tokens, bad input and unknown routes", async () => {
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
    expect((await fetch(`${base}/api/me`, { headers: { Authorization: "Bearer nope-nope-nope-nope-nope" } })).status).toBe(401);
    expect((await post("/api/guest", { displayName: "" })).status).toBe(400);
    expect((await post("/api/guest", "{broken")).status).toBe(400);
    expect((await post("/api/guest", { displayName: "x".repeat(10_000) })).status).toBe(413);
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
    expect((await fetch(`${base}/other`)).status).toBe(418); // /api以外は素通し
  });

  it("limits how many guests one address can create", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post("/api/guest", { displayName: `g${i}` })).status);
    // 上の1件目のテストで1つ作っているので、上限3の残りは2。
    expect(statuses).toEqual([200, 200, 429, 429]);
  });
});
