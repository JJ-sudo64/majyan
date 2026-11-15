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
  name: "マックスプラント",
  /** 運営統括責任者。 */
  responsible: "飯塚歩",
  /** 所在地。公開したくないので、請求があった時に開示する旨の文言にしてある（実際の住所はリポジトリに入れない）。 */
  address: "請求があった場合には、遅滞なく開示いたします。",
  /** 電話番号。所在地と同じ扱い（実際の番号はリポジトリに入れない）。 */
  phone: "請求があった場合には、遅滞なく開示いたします。",
  /** 問い合わせ先のメールアドレス。 */
  email: "support@maxplantlabs.com",
} as const satisfies Record<string, string>;

export const SELLER_INFO_LABELS: Record<keyof typeof SELLER_INFO, string> = {
  name: "販売事業者",
  responsible: "運営統括責任者",
  address: "所在地",
  phone: "電話番号",
  email: "お問い合わせ",
};

/**
 * 特定商取引法に基づく表記と、資金決済法に基づく表示の中身（ゲーム内のショップ画面と、公式サイトの
 * 特商法ページの両方がこれを使う。文言を変える時はここだけ）。販売者の項目が空なら「（公開前に記入）」。
 */
export function legalNoticeRows(): {
  commerce: [string, string][];
  /** 特商法の表の下に出す但し書き。 */
  commerceNote: string;
  prepaid: [string, string][];
} {
  const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
  const blank = (v: string) => v || "（公開前に記入）";
  const commerce: [string, string][] = [
    ["販売事業者", blank(SELLER_INFO.name)],
    ["運営統括責任者", blank(SELLER_INFO.responsible)],
    ["所在地", blank(SELLER_INFO.address)],
    ["電話番号", blank(SELLER_INFO.phone)],
    ["お問い合わせ", blank(SELLER_INFO.email)],
    ["販売価格", "各商品の購入画面に表示した金額（税込）"],
    ["代金以外に必要な費用", "インターネット接続に必要な通信料等は利用者の負担となります。"],
    ["支払い方法・時期", "クレジットカード等、購入画面に表示する決済方法によります。購入手続き時に決済されます。"],
    ["引き渡しの時期", "決済完了後、直ちにゲーム内通貨「雀玉」を付与します。"],
    [
      "返品・キャンセル",
      "デジタル商品の性質上、利用者の都合による購入後の返品・キャンセルおよび返金は原則としてお受けしておりません。ただし、二重決済、商品が正常に付与されない場合、その他運営者の責任による不具合がある場合、または法令上必要な場合はこの限りではありません。",
    ],
  ];
  const commerceNote = "※所在地・電話番号の省略は、請求があった場合に購入者が購入を決める前に十分な時間的余裕をもって開示できる体制を整えていることが前提です。";
  const prepaid: [string, string][] = [
    ["名称", "雀玉（有償）"],
    ["発行者", `${blank(SELLER_INFO.name)}（${blank(SELLER_INFO.responsible)}）`],
    ["支払可能金額等", "各購入プランの雀玉数および販売価格は、購入画面に表示します。"],
    ["有効期限", "ありません。"],
    ["利用可能場所", "オンライン麻雀ゲーム「雀杯」内"],
    ["利用可能なサービス", "ガチャおよび運営者が指定するゲーム内アイテム等の購入"],
    ["残高の確認方法", "ゲーム内の残高表示画面およびガチャ画面で確認できます。"],
    ["お問い合わせ", blank(SELLER_INFO.email)],
    ["発行業務の内容", "本サービス内で使用するゲーム内通貨「雀玉」の発行および管理"],
    ["払い戻し", "法令に定める場合を除き、原則として払い戻しは行いません。"],
    [
      "注意事項",
      [
        "・雀玉には有償分と無償分があります。",
        "・雀玉は原則として無償分から優先的に消費されます。",
        "・キャンペーン等で付与されるおまけの雀玉は無償分として扱います。",
        "・有償分と無償分の残高は区別して管理されます。",
        "・雀玉は本サービス内でのみ利用できます。",
        "・現金への換金および第三者への譲渡はできません。",
      ].join("\n"),
    ],
    [
      "未成年者の購入制限",
      [
        `・16歳未満：月額${yen(MONTHLY_LIMIT_YEN.under16!)}まで`,
        `・16歳以上18歳未満：月額${yen(MONTHLY_LIMIT_YEN["16to17"]!)}まで`,
        "月間購入額は毎月1日から末日までの購入額を合算して計算します。",
      ].join("\n"),
    ],
  ];
  return { commerce, commerceNote, prepaid };
}

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
