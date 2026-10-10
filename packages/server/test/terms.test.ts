import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { TERMS_VERSION, type GuestAccountResponse, type MeResponse } from "@majyan/core";
import { AccountService } from "../src/accounts.js";
import { CollectionService } from "../src/collection.js";
import { MIGRATIONS, openDatabase } from "../src/db.js";
import { createApiHandler } from "../src/httpApi.js";
import { RankService } from "../src/ranks.js";
import { WalletService } from "../src/wallet.js";

describe("terms consent", () => {
  it("records consent at sign-up and asks older accounts to agree once", async () => {
    const db = openDatabase(":memory:");
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(16);
    const accounts = new AccountService(db);
    const wallet = new WalletService(db);
    const handleApi = createApiHandler({ accounts, ranks: new RankService(db), collections: new CollectionService(db, Math.random, Date.now, wallet), wallet });
    const server = createServer(async (req, res) => {
      if (!(await handleApi(req, res))) res.writeHead(418).end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const call = (path: string, token: string | null, body?: unknown) =>
      fetch(`${origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    try {
      const made = (await (await call("/guest", null, { displayName: "新しい人", termsVersion: TERMS_VERSION })).json()) as GuestAccountResponse;
      expect(((await (await call("/me", made.token)).json()) as MeResponse).termsAccepted).toBe(true);

      // 同意の記録を始める前からあるアカウント（＝サーバーが直接作ったもの）は、まだ同意していない扱い。
      const old = accounts.createGuest("前からの人");
      expect(((await (await call("/me", old.token)).json()) as MeResponse).termsAccepted).toBe(false);
      expect((await call("/me/terms", old.token, { version: "1999-01-01" })).status).toBe(400);
      expect(((await (await call("/me/terms", old.token, { version: TERMS_VERSION })).json()) as MeResponse).termsAccepted).toBe(true);
      expect(((await (await call("/me", old.token)).json()) as MeResponse).termsAccepted).toBe(true);
    } finally {
      server.close();
    }
  });
});
