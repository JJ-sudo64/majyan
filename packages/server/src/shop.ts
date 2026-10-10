/**
 * 雀玉の販売。商品・上限の数値はcoreのshop.ts、決済会社とのやり取りはstripe.ts。
 *
 * 流れ: 画面が「買う」→ purchases に pending で記録して支払いページを作る → 支払いが済むと
 * 決済会社から通知が届く → paid にして雀玉を渡す。雀玉を渡すのは通知を受けた時だけで、
 * 画面からの「払いました」は信用しない。同じ通知が2回届いても1回しか渡さない。
 */
import { randomUUID } from "node:crypto";
import {
  ageBracket,
  isValidBirthMonth,
  JADE_PRODUCTS,
  jadeProduct,
  jadeProductLabel,
  jstDate,
  MONTHLY_LIMIT_YEN,
  type AgeBracket,
  type CheckoutResponse,
  type PurchaseStatus,
  type PurchaseView,
  type ShopMode,
  type ShopResponse,
} from "@majyan/core";
import { transaction, type Database } from "./db.js";
import type { PaymentProvider } from "./stripe.js";
import type { WalletService } from "./wallet.js";

/** 支払いページの期限（Stripeの下限が30分）。 */
const CHECKOUT_LIFETIME_MS = 30 * 60_000;
/** 支払い待ちを上限の計算に入れる時間（期限＋通知の遅れの分）。 */
const PENDING_COUNTS_FOR_MS = CHECKOUT_LIFETIME_MS + 5 * 60_000;
/** 同時に持てる支払い待ちの数（支払いページの作りすぎ対策）。 */
const MAX_PENDING = 5;

/** 利用者に見せてよい理由で断る時のエラー。 */
export class ShopError extends Error {}

interface PurchaseRow {
  id: string;
  user_id: string;
  product_id: string;
  price_yen: number;
  paid_jade: number;
  bonus_jade: number;
  status: PurchaseStatus;
  provider: string;
  created_at: number;
}

export interface ShopOptions {
  /** 本番の決済。無ければ売らない（testModeの時を除く）。 */
  provider?: PaymentProvider;
  /** 開発用のテスト購入（お金は動かない）を許すか。providerがあればそちらが優先。 */
  testMode?: boolean;
  now?: () => number;
}

export class ShopService {
  private readonly now: () => number;
  readonly mode: ShopMode;

  constructor(
    private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly options: ShopOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.mode = options.provider ? "live" : options.testMode ? "test" : "closed";
  }

  private birthMonth(userId: string): string | null {
    const row = this.db.prepare("SELECT birth_month FROM user_birth WHERE user_id = ?").get(userId) as { birth_month: string } | undefined;
    return row?.birth_month ?? null;
  }

  bracket(userId: string): AgeBracket | null {
    const birth = this.birthMonth(userId);
    return birth ? ageBracket(birth, this.now()) : null;
  }

  /** 生まれた年月を決める。一度決めたら本人は変えられない（上限を外すための言い直しを防ぐ）。 */
  declareBirthMonth(userId: string, birthMonth: unknown): void {
    if (!isValidBirthMonth(birthMonth, this.now())) throw new ShopError("生まれた年と月を正しく選んでください");
    const inserted = this.db
      .prepare("INSERT OR IGNORE INTO user_birth (user_id, birth_month, declared_at) VALUES (?, ?, ?)")
      .run(userId, birthMonth, this.now());
    if (inserted.changes === 0) throw new ShopError("生まれた年月はすでに登録されています（変える時はお問い合わせください）");
  }

  /** 運営用: 生まれた年月の登録を消す（本人が入れ間違えた時）。 */
  resetBirthMonth(userId: string): boolean {
    return this.db.prepare("DELETE FROM user_birth WHERE user_id = ?").run(userId).changes > 0;
  }

  /** 今月（日本時間）に買った額。支払いの途中のものも数える（並べて開いて上限を超える抜け道を防ぐ）。 */
  monthlySpentYen(userId: string): number {
    const t = this.now();
    const monthStart = Date.parse(`${jstDate(t).slice(0, 7)}-01T00:00:00+09:00`);
    const row = this.db
      .prepare(
        `SELECT SUM(price_yen) AS n FROM purchases WHERE user_id = ? AND created_at >= ?
         AND (status = 'paid' OR (status = 'pending' AND created_at > ?))`,
      )
      .get(userId, monthStart, t - PENDING_COUNTS_FOR_MS) as { n: number | null };
    return row.n ?? 0;
  }

  view(userId: string): ShopResponse {
    const bracket = this.bracket(userId);
    return {
      mode: this.mode,
      products: [...JADE_PRODUCTS],
      ageBracket: bracket,
      monthlyLimitYen: bracket ? MONTHLY_LIMIT_YEN[bracket] : null,
      monthlySpentYen: this.monthlySpentYen(userId),
      jade: this.wallet.balance(userId),
      purchases: this.purchases(userId),
    };
  }

  purchases(userId: string, limit = 50): PurchaseView[] {
    const rows = this.db
      .prepare("SELECT * FROM purchases WHERE user_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT ?")
      .all(userId, limit) as unknown as PurchaseRow[];
    return (
      rows
        .map((r) => ({
          id: r.id,
          productId: r.product_id,
          priceYen: r.price_yen,
          paidJade: r.paid_jade,
          bonusJade: r.bonus_jade,
          status: r.status,
          createdAt: r.created_at,
        }))
        // 期限の過ぎた支払い待ちは、取りやめの通知がまだ届いていなくても出さない。
        .filter((p) => p.status !== "pending" || p.createdAt > this.now() - PENDING_COUNTS_FOR_MS)
    );
  }

  /** 購入を始める。returnBaseは支払いの後に戻ってくるページ（このゲームのURL）。 */
  async startCheckout(userId: string, productId: unknown, returnBase: string): Promise<CheckoutResponse> {
    if (this.mode === "closed") throw new ShopError("ただいま雀玉の販売は行っていません");
    const product = jadeProduct(productId);
    if (!product) throw new ShopError("商品が見つかりません");
    const bracket = this.bracket(userId);
    if (!bracket) throw new ShopError("先に生まれた年月を登録してください");

    const t = this.now();
    const purchaseId = randomUUID();
    transaction(this.db, () => {
      const limit = MONTHLY_LIMIT_YEN[bracket];
      if (limit !== null && this.monthlySpentYen(userId) + product.priceYen > limit) {
        throw new ShopError(`今月の購入の上限（${limit.toLocaleString("ja-JP")}円）を超えるため購入できません`);
      }
      const pending = this.db
        .prepare("SELECT COUNT(*) AS n FROM purchases WHERE user_id = ? AND status = 'pending' AND created_at > ?")
        .get(userId, t - PENDING_COUNTS_FOR_MS) as { n: number };
      if (pending.n >= MAX_PENDING) throw new ShopError("支払いの途中の購入が多すぎます。しばらくしてからお試しください");
      this.db
        .prepare(
          `INSERT INTO purchases (id, user_id, product_id, price_yen, paid_jade, bonus_jade, status, provider, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(purchaseId, userId, product.id, product.priceYen, product.paidJade, product.bonusJade, this.options.provider ? "stripe" : "test", t);
    });
    if (!this.options.provider) return { purchaseId, url: null };

    try {
      const session = await this.options.provider.createCheckout({
        purchaseId,
        userId,
        productName: jadeProductLabel(product),
        priceYen: product.priceYen,
        successUrl: `${returnBase}?shop=done`,
        cancelUrl: `${returnBase}?shop=cancel`,
        expiresAt: t + CHECKOUT_LIFETIME_MS,
      });
      this.db.prepare("UPDATE purchases SET provider_session = ? WHERE id = ?").run(session.sessionId, purchaseId);
      return { purchaseId, url: session.url };
    } catch (err) {
      // 支払いページを作れなかった購入は残さない（上限の計算に入ってしまうため）。
      this.cancel(purchaseId);
      console.error("[majyan-server] 支払いページを作れませんでした:", err);
      throw new ShopError("支払いのページを開けませんでした。しばらくしてからお試しください");
    }
  }

  /**
   * 支払いが済んだ購入に雀玉を渡す。渡したらtrue（すでに渡してあればfalse）。
   * amountYenを渡した時は、額が購入の記録と合っていることも確かめる。
   */
  complete(purchaseId: string, payment: { sessionId?: string | null; paymentId?: string | null; amountYen?: number } = {}): boolean {
    return transaction(this.db, () => {
      const row = this.db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchaseId) as PurchaseRow | undefined;
      if (!row) throw new Error(`購入の記録がありません: ${purchaseId}`);
      // 支払いページの期限の後に払われることもある（コンビニ払い等）ので、取りやめにしたものでも払われたら渡す。
      if (row.status !== "pending" && row.status !== "cancelled") return false;
      if (payment.amountYen !== undefined && payment.amountYen !== row.price_yen) {
        throw new Error(`支払われた額が購入の記録と合いません: ${purchaseId}（${payment.amountYen}円 / ${row.price_yen}円）`);
      }
      this.db
        .prepare(
          `UPDATE purchases SET status = 'paid', paid_at = ?, provider_session = COALESCE(?, provider_session), provider_payment = ?
           WHERE id = ?`,
        )
        .run(this.now(), payment.sessionId ?? null, payment.paymentId ?? null, purchaseId);
      this.wallet.grantPurchase(row.user_id, row.paid_jade, row.bonus_jade, purchaseId);
      return true;
    });
  }

  /** 開発用のテスト購入を、払ったことにする。本人のテスト購入でなければShopError。 */
  completeTestPurchase(userId: string, purchaseId: unknown): void {
    if (this.mode !== "test") throw new ShopError("テスト購入は使えません");
    const row =
      typeof purchaseId === "string"
        ? (this.db.prepare("SELECT * FROM purchases WHERE id = ? AND user_id = ? AND provider = 'test'").get(purchaseId, userId) as PurchaseRow | undefined)
        : undefined;
    if (!row || row.status !== "pending") throw new ShopError("購入が見つかりません");
    this.complete(row.id);
  }

  /** 払われなかった購入を取りやめにする（支払い待ちのものだけ）。 */
  cancel(purchaseId: string): boolean {
    return this.db.prepare("UPDATE purchases SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(purchaseId).changes > 0;
  }

  /** 返金された購入の雀玉を取り上げる。取り上げたらtrue。 */
  refund(purchaseId: string): boolean {
    return transaction(this.db, () => {
      const row = this.db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchaseId) as PurchaseRow | undefined;
      if (!row || row.status !== "paid") return false;
      this.db.prepare("UPDATE purchases SET status = 'refunded', refunded_at = ? WHERE id = ?").run(this.now(), purchaseId);
      this.wallet.revokePurchase(row.user_id, row.paid_jade, row.bonus_jade, purchaseId);
      return true;
    });
  }

  /** 決済会社の支払い番号から返金を反映する。 */
  refundByPayment(paymentId: string): boolean {
    const row = this.db.prepare("SELECT id FROM purchases WHERE provider_payment = ?").get(paymentId) as { id: string } | undefined;
    return row ? this.refund(row.id) : false;
  }

  /** 運営用: 購入の記録（新しい順）。userIdを渡せばその人の分だけ。 */
  adminList(userId: string | null, limit = 50): (PurchaseView & { userId: string; provider: string })[] {
    const rows = this.db
      .prepare(`SELECT * FROM purchases ${userId ? "WHERE user_id = ?" : ""} ORDER BY created_at DESC LIMIT ?`)
      .all(...(userId ? [userId, limit] : [limit])) as unknown as PurchaseRow[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      provider: r.provider,
      productId: r.product_id,
      priceYen: r.price_yen,
      paidJade: r.paid_jade,
      bonusJade: r.bonus_jade,
      status: r.status,
      createdAt: r.created_at,
    }));
  }
}
