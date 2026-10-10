/**
 * 雀玉の販売（課金）。商品・年齢ごとの上限・販売者の表示を1か所にまとめる。
 *
 * 数値（値段・雀玉の数・おまけ・上限）はすべて仮の値。公開する前に決め直すこと。
 * 買った分は「有償」の雀玉、おまけ分は「無償」の雀玉として渡す（有償だけが資金決済法の
 * 前払式支払手段の残高に数えられるため、おまけを有償に混ぜない）。
 *
 * 実際に公開する前に、表示の内容（特定商取引法・資金決済法）と未成年の扱いは専門家に確認する。
 */
import { jstDate } from "./gacha.js";
import type { JadeBalance } from "./onlineProtocol.js";

export interface JadeProduct {
  id: string;
  /** 税込みの値段（円）。 */
  priceYen: number;
  /** 有償の雀玉。 */
  paidJade: number;
  /** おまけ（無償の雀玉）。 */
  bonusJade: number;
}

export const JADE_PRODUCTS: readonly JadeProduct[] = [
  { id: "jade-160", priceYen: 160, paidJade: 150, bonusJade: 0 },
  { id: "jade-490", priceYen: 490, paidJade: 480, bonusJade: 20 },
  { id: "jade-1600", priceYen: 1600, paidJade: 1500, bonusJade: 150 },
  { id: "jade-3200", priceYen: 3200, paidJade: 3000, bonusJade: 450 },
  { id: "jade-4900", priceYen: 4900, paidJade: 4800, bonusJade: 900 },
  { id: "jade-10000", priceYen: 10000, paidJade: 9800, bonusJade: 2200 },
];

export function jadeProduct(id: unknown): JadeProduct | null {
  return JADE_PRODUCTS.find((p) => p.id === id) ?? null;
}

export function jadeProductLabel(product: JadeProduct): string {
  return product.bonusJade > 0 ? `雀玉 ${product.paidJade}（+おまけ ${product.bonusJade}）` : `雀玉 ${product.paidJade}`;
}

// ---------------------------------------------------------------------------
// 年齢と1か月の上限
// ---------------------------------------------------------------------------

export type AgeBracket = "under16" | "16to17" | "adult";

/** 1か月（日本時間の暦月）に買える上限（円）。nullは上限なし。 */
export const MONTHLY_LIMIT_YEN: Record<AgeBracket, number | null> = {
  under16: 5000,
  "16to17": 10000,
  adult: null,
};

export const AGE_BRACKET_LABELS: Record<AgeBracket, string> = {
  under16: "16歳未満",
  "16to17": "16〜17歳",
  adult: "18歳以上",
};

/** 生まれた年月の形（"2008-04"）。 */
export const BIRTH_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 生まれた年月として受け付けられるか（未来や古すぎる年は不可）。 */
export function isValidBirthMonth(value: unknown, nowMs: number): value is string {
  if (typeof value !== "string" || !BIRTH_MONTH_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return value <= jstDate(nowMs).slice(0, 7) && year >= 1900;
}

/**
 * 生まれた年月から今の年齢の区分を出す。日までは聞かないので、誕生日はその月の末日と
 * みなす（＝生まれた月が過ぎるまでは年を取らない。若い側に倒す）。
 */
export function ageBracket(birthMonth: string, nowMs: number): AgeBracket {
  const [nowYear, nowMonth] = jstDate(nowMs).split("-").map(Number) as [number, number];
  const birthYear = Number(birthMonth.slice(0, 4));
  const birthMon = Number(birthMonth.slice(5, 7));
  const age = nowYear - birthYear - (nowMonth > birthMon ? 0 : 1);
  if (age < 16) return "under16";
  return age < 18 ? "16to17" : "adult";
}

// ---------------------------------------------------------------------------
// 販売者の表示（特定商取引法に基づく表記）
// ---------------------------------------------------------------------------

/**
 * 販売者の情報。公開する前に必ず埋める。空の項目が残っている間、サーバーは
 * 本番の販売を始めない（開発用の「テスト購入」は動く）。
 */
export const SELLER_INFO = {
  /** 販売事業者（個人なら氏名、法人なら会社名）。 */
  name: "",
  /** 運営統括責任者。 */
  responsible: "",
  /** 所在地。 */
  address: "",
  /** 電話番号。 */
  phone: "",
  /** 問い合わせ先のメールアドレス。 */
  email: "",
} as const satisfies Record<string, string>;

export const SELLER_INFO_LABELS: Record<keyof typeof SELLER_INFO, string> = {
  name: "販売事業者",
  responsible: "運営統括責任者",
  address: "所在地",
  phone: "電話番号",
  email: "お問い合わせ",
};

export function sellerInfoComplete(): boolean {
  return Object.values(SELLER_INFO).every((v) => v.trim() !== "");
}

// ---------------------------------------------------------------------------
// API（/api/shop/...）
//   GET  /api/shop                       → ShopResponse
//   POST /api/shop/age {birthMonth}      → ShopResponse      （一度決めたら本人は変えられない）
//   POST /api/shop/checkout {productId}  → CheckoutResponse  （返ってきたurlへ移動して支払う）
//   POST /api/shop/stripe-webhook        … Stripeからの通知（署名を確かめる）
//   POST /api/dev/shop/pay {purchaseId}  → ShopResponse      （開発用のテスト購入。--dev-tools の時だけ）
// ---------------------------------------------------------------------------

export type ShopMode =
  /** 売っていない（決済の設定が無い・販売者の表示が未記入）。 */
  | "closed"
  /** 開発用。お金は動かず、押すだけで買ったことになる。 */
  | "test"
  | "live";

export interface ShopResponse {
  mode: ShopMode;
  products: JadeProduct[];
  /** 生まれた年月をまだ聞いていなければnull。 */
  ageBracket: AgeBracket | null;
  /** 今月の上限（円）。上限なし・年齢を聞く前はnull。 */
  monthlyLimitYen: number | null;
  /** 今月すでに買った額（円。支払いの途中のものも含む）。 */
  monthlySpentYen: number;
  jade: JadeBalance;
  /** 購入の記録（新しい順）。 */
  purchases: PurchaseView[];
}

export type PurchaseStatus = "pending" | "paid" | "refunded" | "cancelled";

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "支払い待ち",
  paid: "購入済み",
  refunded: "返金済み",
  cancelled: "取りやめ",
};

export interface PurchaseView {
  id: string;
  productId: string;
  priceYen: number;
  paidJade: number;
  bonusJade: number;
  status: PurchaseStatus;
  /** 時刻（ミリ秒）。 */
  createdAt: number;
}

export interface CheckoutResponse {
  purchaseId: string;
  /** 支払いのページ。テスト購入の時はnull（/api/dev/shop/pay を呼ぶ）。 */
  url: string | null;
}

/** 支払いのページから戻ってきた時にURLへ付く印（?shop=done / ?shop=cancel）。 */
export const SHOP_RETURN_PARAM = "shop";
