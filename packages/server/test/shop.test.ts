import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ageBracket, isValidBirthMonth, jadeProduct, STARTING_JADE, type CheckoutResponse, type ShopResponse } from "@majyan/core";
import { AccountService } from "../src/accounts.js";
import { CollectionService } from "../src/collection.js";
import { openDatabase } from "../src/db.js";
import { createApiHandler } from "../src/httpApi.js";
import { RankService } from "../src/ranks.js";
import { runAdmin } from "../src/admin.js";
import { ShopError, ShopService, type ShopOptions } from "../src/shop.js";
import { parseStripeWebhook, signStripePayload, StripeProvider, type CheckoutRequest, type PaymentProvider } from "../src/stripe.js";
import { WalletService } from "../src/wallet.js";

const NOW = Date.UTC(2026, 9, 10, 3, 0, 0); // 2026-10-10 12:00 JST

class FakeProvider implements PaymentProvider {
  requests: CheckoutRequest[] = [];
  fail = false;
  async createCheckout(request: CheckoutRequest) {
    if (this.fail) throw new Error("down");
    this.requests.push(request);
    return { sessionId: `cs_${this.requests.length}`, url: `https://pay.example/${request.purchaseId}` };
  }
}

function setup(options: Omit<ShopOptions, "now"> = { testMode: true }) {
  const db = openDatabase(":memory:");
  const clock = { t: NOW };
  const now = () => clock.t;
  const accounts = new AccountService(db, now);
  const wallet = new WalletService(db, now);
  const shop = new ShopService(db, wallet, { ...options, now });
  const { profile, token } = accounts.createGuest("A");
  return { db, clock, now, accounts, wallet, shop, userId: profile.id, token };
}

describe("age brackets", () => {
  it("treats the birthday as the end of the birth month", () => {
    expect(ageBracket("2010-10", NOW)).toBe("under16"); // 今月16歳になる → まだ15歳扱い
    expect(ageBracket("2010-09", NOW)).toBe("16to17");
    expect(ageBracket("2008-10", NOW)).toBe("16to17");
    expect(ageBracket("2008-09", NOW)).toBe("adult");
  });

  it("rejects malformed and future birth months", () => {
    expect(isValidBirthMonth("2000-01", NOW)).toBe(true);
    expect(isValidBirthMonth("2026-10", NOW)).toBe(true);
    expect(isValidBirthMonth("2026-11", NOW)).toBe(false);
    expect(isValidBirthMonth("2000-13", NOW)).toBe(false);
    expect(isValidBirthMonth("1899-12", NOW)).toBe(false);
    expect(isValidBirthMonth(200001, NOW)).toBe(false);
  });
});

describe("ShopService", () => {
  it("sells nothing when closed and asks for the birth month first", async () => {
    const closed = setup({});
    expect(closed.shop.mode).toBe("closed");
    await expect(closed.shop.startCheckout(closed.userId, "jade-160", "http://x/")).rejects.toThrow(ShopError);

    const { shop, userId } = setup();
    await expect(shop.startCheckout(userId, "jade-160", "http://x/")).rejects.toThrow("生まれた年月");
    shop.declareBirthMonth(userId, "1990-01");
    expect(() => shop.declareBirthMonth(userId, "2012-01")).toThrow(ShopError);
    expect(shop.view(userId)).toMatchObject({ mode: "test", ageBracket: "adult", monthlyLimitYen: null, monthlySpentYen: 0 });
    await expect(shop.startCheckout(userId, "no-such", "http://x/")).rejects.toThrow("商品");
  });

  it("grants paid jade and the free bonus exactly once", async () => {
    const { shop, userId, wallet, db } = setup();
    shop.declareBirthMonth(userId, "1990-01");
    const product = jadeProduct("jade-1600")!;
    const { purchaseId, url } = await shop.startCheckout(userId, product.id, "http://x/");
    expect(url).toBeNull();
    expect(wallet.balance(userId)).toEqual({ free: STARTING_JADE, paid: 0 });

    shop.completeTestPurchase(userId, purchaseId);
    expect(wallet.balance(userId)).toEqual({ free: STARTING_JADE + product.bonusJade, paid: product.paidJade });
    expect(shop.complete(purchaseId)).toBe(false);
    expect(() => shop.completeTestPurchase(userId, purchaseId)).toThrow(ShopError);
    expect(wallet.balance(userId).paid).toBe(product.paidJade);
    expect(db.prepare("SELECT reason, ref FROM jade_ledger WHERE reason = 'purchase'").all()).toEqual([{ reason: "purchase", ref: purchaseId }]);
    expect(shop.view(userId).purchases).toMatchObject([{ id: purchaseId, status: "paid", priceYen: 1600 }]);
  });

  it("does not let someone else finish a test purchase", async () => {
    const { shop, userId, accounts } = setup();
    shop.declareBirthMonth(userId, "1990-01");
    const { purchaseId } = await shop.startCheckout(userId, "jade-160", "http://x/");
    const other = accounts.createGuest("B").profile.id;
    expect(() => shop.completeTestPurchase(other, purchaseId)).toThrow(ShopError);
  });

  it("holds minors to the monthly limit, counting checkouts still open", async () => {
    const { shop, userId, clock } = setup();
    shop.declareBirthMonth(userId, "2012-05"); // 14歳 → 月5000円
    expect(shop.view(userId)).toMatchObject({ ageBracket: "under16", monthlyLimitYen: 5000 });
    await expect(shop.startCheckout(userId, "jade-10000", "http://x/")).rejects.toThrow("上限");

    const first = await shop.startCheckout(userId, "jade-3200", "http://x/");
    // 支払いの途中でも、もう1つ開いて上限を超えることはできない。
    await expect(shop.startCheckout(userId, "jade-3200", "http://x/")).rejects.toThrow("上限");
    shop.completeTestPurchase(userId, first.purchaseId);
    await shop.startCheckout(userId, "jade-1600", "http://x/");
    expect(shop.monthlySpentYen(userId)).toBe(4800);
    await expect(shop.startCheckout(userId, "jade-490", "http://x/")).rejects.toThrow("上限");

    // 払われなかった支払い待ちは、期限が過ぎれば数えない。
    clock.t += 40 * 60_000;
    expect(shop.monthlySpentYen(userId)).toBe(3200);
    // 月が変われば、また買える。
    clock.t = Date.UTC(2026, 9, 31, 15, 0, 0); // 11月1日 0:00 JST
    expect(shop.monthlySpentYen(userId)).toBe(0);
    await shop.startCheckout(userId, "jade-4900", "http://x/");
  });

  it("limits how many checkouts can be open at once", async () => {
    const { shop, userId } = setup();
    shop.declareBirthMonth(userId, "1990-01");
    for (let i = 0; i < 5; i++) await shop.startCheckout(userId, "jade-160", "http://x/");
    await expect(shop.startCheckout(userId, "jade-160", "http://x/")).rejects.toThrow("多すぎ");
  });

  it("takes jade back on a refund without going below zero", async () => {
    const { shop, userId, wallet } = setup();
    shop.declareBirthMonth(userId, "1990-01");
    const product = jadeProduct("jade-1600")!;
    const { purchaseId } = await shop.startCheckout(userId, product.id, "http://x/");
    shop.completeTestPurchase(userId, purchaseId);
    // 無償を全部と、有償を500使う。
    wallet.spend(userId, STARTING_JADE + product.bonusJade + 500, "test");
    expect(wallet.balance(userId)).toEqual({ free: 0, paid: product.paidJade - 500 });

    expect(shop.refund(purchaseId)).toBe(true);
    expect(wallet.balance(userId)).toEqual({ free: 0, paid: 0 });
    expect(shop.refund(purchaseId)).toBe(false);
    expect(shop.view(userId).purchases[0]!.status).toBe("refunded");
    // 返金した分は今月の額から外れる。
    expect(shop.monthlySpentYen(userId)).toBe(0);
  });

  it("drops the purchase when the payment page cannot be created", async () => {
    const provider = new FakeProvider();
    const { shop, userId } = setup({ provider });
    shop.declareBirthMonth(userId, "1990-01");
    provider.fail = true;
    await expect(shop.startCheckout(userId, "jade-160", "http://x/")).rejects.toThrow(ShopError);
    expect(shop.monthlySpentYen(userId)).toBe(0);
    expect(shop.view(userId).purchases).toEqual([]);
  });

  it("is reachable from the admin command", async () => {
    const { shop, userId, db, now, wallet } = setup();
    shop.declareBirthMonth(userId, "1990-01");
    const { purchaseId } = await shop.startCheckout(userId, "jade-160", "http://x/");
    shop.completeTestPurchase(userId, purchaseId);
    expect(runAdmin(db, ["purchase", "list"], now)[0]).toContain("購入済み");
    expect(runAdmin(db, ["purchase", "refund", purchaseId], now)[0]).toContain("取り上げました");
    expect(wallet.balance(userId).paid).toBe(0);
    expect(runAdmin(db, ["age", "reset", "--to", userId], now)[0]).toContain("消しました");
    expect(shop.bracket(userId)).toBeNull();
  });
});

describe("Stripe", () => {
  const SECRET = "whsec_test";
  const event = (type: string, object: Record<string, unknown>) => JSON.stringify({ type, data: { object } });

  it("accepts only correctly signed, recent webhooks", () => {
    const body = event("checkout.session.completed", {
      id: "cs_1",
      client_reference_id: "p1",
      payment_status: "paid",
      payment_intent: "pi_1",
      amount_total: 160,
      currency: "jpy",
    });
    const header = signStripePayload(body, SECRET, NOW);
    expect(parseStripeWebhook(body, header, SECRET, NOW)).toEqual({
      kind: "paid",
      purchaseId: "p1",
      sessionId: "cs_1",
      paymentId: "pi_1",
      amount: 160,
      currency: "jpy",
    });
    expect(parseStripeWebhook(body, header, "whsec_other", NOW)).toBeNull();
    expect(parseStripeWebhook(body.replace("160", "1"), header, SECRET, NOW)).toBeNull();
    expect(parseStripeWebhook(body, header, SECRET, NOW + 6 * 60_000)).toBeNull();
    expect(parseStripeWebhook(body, undefined, SECRET, NOW)).toBeNull();
    expect(parseStripeWebhook(body, "t=abc,v1=zz", SECRET, NOW)).toBeNull();
  });

  it("does not treat an unpaid completed session as paid", () => {
    const body = event("checkout.session.completed", { id: "cs_1", client_reference_id: "p1", payment_status: "unpaid" });
    expect(parseStripeWebhook(body, signStripePayload(body, SECRET, NOW), SECRET, NOW)).toMatchObject({ kind: "ignored" });
  });

  it("sends the checkout request Stripe expects", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "cs_9", url: "https://checkout.stripe.com/x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const session = await new StripeProvider("sk_test_x", fakeFetch).createCheckout({
      purchaseId: "p1",
      userId: "u1",
      productName: "雀玉 150",
      priceYen: 160,
      successUrl: "https://g.example/?shop=done",
      cancelUrl: "https://g.example/?shop=cancel",
      expiresAt: NOW + 30 * 60_000,
    });
    expect(session).toEqual({ sessionId: "cs_9", url: "https://checkout.stripe.com/x" });
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_x");
    expect(headers["Idempotency-Key"]).toBe("checkout-p1");
    const form = new URLSearchParams(calls[0]!.init.body as string);
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("160");
    expect(form.get("line_items[0][price_data][currency]")).toBe("jpy");
    expect(form.get("client_reference_id")).toBe("p1");
  });
});

describe("shop API", () => {
  const SECRET = "whsec_api";

  async function serve(options: { provider?: PaymentProvider; devTools?: boolean; publicUrl?: string }) {
    const base = setup({ provider: options.provider, testMode: options.devTools });
    const { db, accounts, wallet, shop, now } = base;
    const handleApi = createApiHandler({
      accounts,
      ranks: new RankService(db),
      collections: new CollectionService(db, Math.random, now, wallet),
      wallet,
      shop,
      stripeWebhookSecret: options.provider ? SECRET : undefined,
      publicUrl: options.publicUrl,
      devTools: options.devTools,
      now,
    });
    const server = createServer(async (req, res) => {
      if (!(await handleApi(req, res))) res.writeHead(418).end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`${origin}/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${base.token}`, Origin: origin, ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
    return { ...base, server, call, origin };
  }

  it("runs a test purchase end to end with dev tools, and hides it without", async () => {
    const dev = await serve({ devTools: true });
    try {
      expect(((await (await dev.call("/shop")).json()) as ShopResponse).mode).toBe("test");
      expect((await dev.call("/shop/age", { birthMonth: "nope" })).status).toBe(409);
      expect((await dev.call("/shop/age", { birthMonth: "1990-01" })).status).toBe(200);
      const checkout = (await (await dev.call("/shop/checkout", { productId: "jade-160" })).json()) as CheckoutResponse;
      expect(checkout.url).toBeNull();
      const after = (await (await dev.call("/dev/shop/pay", { purchaseId: checkout.purchaseId })).json()) as ShopResponse;
      expect(after.jade.paid).toBe(150);
      expect(after.monthlySpentYen).toBe(160);
    } finally {
      dev.server.close();
    }
    const prod = await serve({});
    try {
      expect(((await (await prod.call("/shop")).json()) as ShopResponse).mode).toBe("closed");
      expect((await prod.call("/dev/shop/pay", { purchaseId: "x" })).status).toBe(404);
      expect((await prod.call("/shop/stripe-webhook", "{}")).status).toBe(404);
    } finally {
      prod.server.close();
    }
  });

  it("grants jade only from a signed webhook, once, and reverses it on a full refund", async () => {
    const provider = new FakeProvider();
    const live = await serve({ provider, publicUrl: "https://game.example/" });
    const { call, wallet, userId, now, server } = live;
    try {
      await call("/shop/age", { birthMonth: "1990-01" });
      const checkout = (await (await call("/shop/checkout", { productId: "jade-490" })).json()) as CheckoutResponse;
      expect(checkout.url).toBe(`https://pay.example/${checkout.purchaseId}`);
      expect(provider.requests[0]).toMatchObject({ priceYen: 490, successUrl: "https://game.example/?shop=done" });
      // 本番の販売中は、テスト購入の抜け道は無い。
      expect((await call("/dev/shop/pay", { purchaseId: checkout.purchaseId })).status).toBe(404);

      const paid = (amount: number) =>
        JSON.stringify({
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_1",
              client_reference_id: checkout.purchaseId,
              payment_status: "paid",
              payment_intent: "pi_1",
              amount_total: amount,
              currency: "jpy",
            },
          },
        });
      const send = (body: string, signature = signStripePayload(body, SECRET, now())) =>
        call("/shop/stripe-webhook", body, { "Stripe-Signature": signature });

      expect((await send(paid(490), "t=1,v1=00")).status).toBe(400);
      expect((await send(paid(1))).status).toBe(500); // 額が合わない
      expect(wallet.balance(userId).paid).toBe(0);
      expect((await send(paid(490))).status).toBe(200);
      expect((await send(paid(490))).status).toBe(200);
      expect(wallet.balance(userId)).toEqual({ free: STARTING_JADE + 20, paid: 480 });

      const refund = JSON.stringify({ type: "charge.refunded", data: { object: { payment_intent: "pi_1", refunded: true } } });
      expect((await send(refund)).status).toBe(200);
      expect(wallet.balance(userId)).toEqual({ free: STARTING_JADE, paid: 0 });
    } finally {
      server.close();
    }
  });
});
