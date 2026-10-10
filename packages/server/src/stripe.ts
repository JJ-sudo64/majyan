/**
 * Stripe（クレジットカード等の決済）とのやり取り。SDKは使わず、必要な2つだけを自分で書く:
 *   - 支払いページ（Checkout Session）を作る
 *   - Stripeからの通知（Webhook）の署名を確かめる
 *
 * カード番号はStripeのページで入力され、このサーバーには届かない。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";
/** 通知の時刻がこれ以上ずれていたら受け付けない（古い通知の使い回し対策）。 */
const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

export interface CheckoutRequest {
  purchaseId: string;
  userId: string;
  productName: string;
  priceYen: number;
  successUrl: string;
  cancelUrl: string;
  /** 支払いページの期限（ミリ秒の時刻）。Stripeの下限は30分後。 */
  expiresAt: number;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
}

export class StripeError extends Error {}

export class StripeProvider implements PaymentProvider {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const form = new URLSearchParams({
      mode: "payment",
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.purchaseId,
      expires_at: String(Math.floor(request.expiresAt / 1000)),
      locale: "ja",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "jpy",
      // 円は小数が無いので、そのままの額を渡す。
      "line_items[0][price_data][unit_amount]": String(request.priceYen),
      "line_items[0][price_data][product_data][name]": request.productName,
      "metadata[purchase_id]": request.purchaseId,
      "metadata[user_id]": request.userId,
      "payment_intent_data[metadata][purchase_id]": request.purchaseId,
    });
    const res = await this.fetchImpl(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // 同じ購入で2回送ってしまっても、支払いページは1つだけ作られる。
        "Idempotency-Key": `checkout-${request.purchaseId}`,
      },
      body: form.toString(),
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; url?: unknown; error?: { message?: unknown } } | null;
    if (!res.ok || typeof body?.id !== "string" || typeof body.url !== "string") {
      throw new StripeError(`Stripeで支払いページを作れませんでした（${res.status}）: ${String(body?.error?.message ?? "")}`);
    }
    return { sessionId: body.id, url: body.url };
  }
}

/** Stripeの通知のうち、ここで使うものだけ。 */
export type StripeEvent =
  | { kind: "paid"; purchaseId: string; sessionId: string; paymentId: string | null; amount: number; currency: string }
  | { kind: "expired"; purchaseId: string }
  | { kind: "refunded"; paymentId: string; full: boolean }
  | { kind: "ignored"; type: string };

/**
 * 通知の署名を確かめて中身を読む。署名が合わなければnull。
 * 署名は「時刻.本文」を通知用の秘密の鍵でHMAC-SHA256したもの（ヘッダー Stripe-Signature: t=…,v1=…）。
 */
export function parseStripeWebhook(rawBody: string, signatureHeader: string | undefined, secret: string, nowMs: number): StripeEvent | null {
  if (!signatureHeader) return null;
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) return null;
  if (Math.abs(nowMs - Number(timestamp) * 1000) > WEBHOOK_TOLERANCE_MS) return null;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const matches = signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) return null;

  let event: { type?: unknown; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return null;
  }
  const type = String(event.type ?? "");
  const object = event.data?.object ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const purchaseId = str(object.client_reference_id);
      const sessionId = str(object.id);
      // コンビニ払い等は「完了」の時点ではまだ払われていない（後からasync_payment_succeededが来る）。
      if (!purchaseId || !sessionId || object.payment_status !== "paid") return { kind: "ignored", type };
      return {
        kind: "paid",
        purchaseId,
        sessionId,
        paymentId: str(object.payment_intent),
        amount: Number(object.amount_total),
        currency: String(object.currency ?? ""),
      };
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const purchaseId = str(object.client_reference_id);
      return purchaseId ? { kind: "expired", purchaseId } : { kind: "ignored", type };
    }
    case "charge.refunded": {
      const paymentId = str(object.payment_intent);
      return paymentId ? { kind: "refunded", paymentId, full: object.refunded === true } : { kind: "ignored", type };
    }
    default:
      return { kind: "ignored", type };
  }
}

/** テスト用: parseStripeWebhookが受け付ける署名ヘッダーを作る。 */
export function signStripePayload(rawBody: string, secret: string, nowMs: number): string {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
