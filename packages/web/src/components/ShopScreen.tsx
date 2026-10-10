import { useEffect, useState } from "react";
import {
  AGE_BRACKET_LABELS,
  MONTHLY_LIMIT_YEN,
  PURCHASE_STATUS_LABELS,
  SELLER_INFO,
  SELLER_INFO_LABELS,
  jadeProduct,
  type JadeProduct,
  type ShopResponse,
} from "@majyan/core";
import { declareBirthMonth, fetchShop, payTestPurchase, startCheckout } from "../online/account.js";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const dateTime = (ms: number) => new Date(ms).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });

/** 支払いのページから戻ってきた直後は、決済会社からの通知が少し遅れて届くことがあるので、何度か読み直す。 */
const RETURN_RELOAD_DELAYS_MS = [2000, 5000, 10000];

/** 生まれた年月を聞く（未成年の買いすぎを防ぐ上限を決めるため）。 */
function AgeGate({ onSubmit, busy }: { onSubmit: (birthMonth: string) => void; busy: boolean }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [confirming, setConfirming] = useState(false);
  const birthMonth = year && month ? `${year}-${month.padStart(2, "0")}` : null;

  return (
    <div className="shop-screen__age">
      <p className="setup-lead">
        雀玉を買う前に、生まれた年と月を教えてください。年齢によって1か月に買える額に上限があります（
        {AGE_BRACKET_LABELS.under16}：{yen(MONTHLY_LIMIT_YEN.under16!)}、{AGE_BRACKET_LABELS["16to17"]}：{yen(MONTHLY_LIMIT_YEN["16to17"]!)}）。
      </p>
      <div className="shop-screen__age-inputs">
        <select value={year} onChange={(e) => (setYear(e.target.value), setConfirming(false))} aria-label="生まれた年">
          <option value="">年</option>
          {Array.from({ length: 100 }, (_, i) => thisYear - i).map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select value={month} onChange={(e) => (setMonth(e.target.value), setConfirming(false))} aria-label="生まれた月">
          <option value="">月</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        {!confirming && (
          <button type="button" className="btn" disabled={!birthMonth} onClick={() => setConfirming(true)}>
            次へ
          </button>
        )}
      </div>
      {confirming && birthMonth && (
        <div className="first-gacha__confirm">
          <p>
            {year}年{month}月生まれで登録します。一度登録すると自分では変えられません。よろしいですか？
          </p>
          <div className="setup-buttons">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onSubmit(birthMonth)}>
              登録する
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)}>
              直す
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 特定商取引法に基づく表記と、資金決済法に基づく表示。 */
function LegalNotes() {
  const rows: [string, string][] = [
    ...(Object.keys(SELLER_INFO) as (keyof typeof SELLER_INFO)[]).map((k): [string, string] => [SELLER_INFO_LABELS[k], SELLER_INFO[k] || "（公開前に記入）"]),
    ["販売価格", "各商品のボタンに表示した額（税込み）"],
    ["代金以外に必要な費用", "インターネットの通信料"],
    ["支払い方法・時期", "クレジットカード等（購入の手続きの時に支払い）"],
    ["引き渡しの時期", "支払いの確認後、すぐに雀玉を付与します"],
    ["返品・キャンセル", "商品の性質上、購入後の返品・キャンセルはできません"],
  ];
  const prepaid: [string, string][] = [
    ["名称", "雀玉（有償）"],
    ["発行者", SELLER_INFO.name || "（公開前に記入）"],
    ["買える額の上限", `${AGE_BRACKET_LABELS.under16}は月${yen(MONTHLY_LIMIT_YEN.under16!)}、${AGE_BRACKET_LABELS["16to17"]}は月${yen(MONTHLY_LIMIT_YEN["16to17"]!)}まで`],
    ["有効期限", "なし"],
    ["使える場所", "このゲームの中だけ（ガチャ等）"],
    ["残高の確認", "この画面とガチャの画面に表示します"],
    ["払い戻し", "法令で定められた場合を除き、払い戻しはできません"],
    ["注意", "雀玉は無償の分から先に使われます。おまけの雀玉は無償の雀玉です。退会すると残りの雀玉は使えなくなります"],
  ];
  const table = (items: [string, string][]) => (
    <table className="shop-screen__legal-table">
      <tbody>
        {items.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="shop-screen__legal">
      <div className="online-lobby__section-title">特定商取引法に基づく表記</div>
      {table(rows)}
      <div className="online-lobby__section-title">資金決済法に基づく表示</div>
      {table(prepaid)}
    </div>
  );
}

/**
 * 雀玉を買う画面。returned は支払いのページから戻ってきた時の印（"done" / "cancel"）。
 * 雀玉が増えるのは、サーバーが決済会社から支払いの通知を受けた時（この画面からは増やせない）。
 */
export function ShopScreen({ onClose, returned }: { onClose: () => void; returned?: string | null }) {
  const [shop, setShop] = useState<ShopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    returned === "done" ? "お支払いありがとうございます。雀玉の反映まで少しかかることがあります。" : returned === "cancel" ? "購入を取りやめました。" : null,
  );
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<JadeProduct | null>(null);
  const [showLegal, setShowLegal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchShop()
        .then((s) => !cancelled && setShop(s))
        .catch((err: Error) => !cancelled && setError(err.message));
    void load();
    const timers = returned === "done" ? RETURN_RELOAD_DELAYS_MS.map((ms) => window.setTimeout(load, ms)) : [];
    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [returned]);

  async function run(action: () => Promise<ShopResponse | void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setShop(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const buy = (product: JadeProduct) =>
    run(async () => {
      const checkout = await startCheckout(product.id);
      if (checkout.url) {
        // 支払いのページへ移る（戻ってくると ?shop=done が付いている）。
        window.location.assign(checkout.url);
        return;
      }
      const next = await payTestPurchase(checkout.purchaseId);
      setChoice(null);
      setNotice(`テスト購入：雀玉 ${product.paidJade + product.bonusJade} を受け取りました`);
      return next;
    });

  const remaining = shop && shop.monthlyLimitYen !== null ? Math.max(0, shop.monthlyLimitYen - shop.monthlySpentYen) : null;
  const minor = shop?.ageBracket === "under16" || shop?.ageBracket === "16to17";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen shop-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">雀玉を買う</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        {!shop && !error && <p className="setup-lead">読み込んでいます…</p>}
        {error && <p className="online-lobby__error">{error}</p>}
        {notice && (
          <div className="online-lobby__notice" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
        {shop && (
          <>
            <div className="gacha-screen__jade">
              雀玉 <strong>{(shop.jade.free + shop.jade.paid).toLocaleString()}</strong>
              <span className="gacha-screen__jade-detail">
                （無償 {shop.jade.free.toLocaleString()} ／ 有償 {shop.jade.paid.toLocaleString()}）
              </span>
            </div>
            {shop.mode === "closed" && <p className="setup-lead">雀玉の販売は準備中です。雀玉は段位戦の報酬・ログインボーナス・ミッションでもらえます。</p>}
            {shop.mode === "test" && <p className="shop-screen__test">開発用のテスト購入です。お金は動かず、押すだけで雀玉が増えます。</p>}
            {shop.mode !== "closed" && !shop.ageBracket && <AgeGate busy={busy} onSubmit={(m) => void run(() => declareBirthMonth(m))} />}
            {shop.mode !== "closed" && shop.ageBracket && (
              <>
                {remaining !== null && (
                  <p className="setup-lead">
                    {AGE_BRACKET_LABELS[shop.ageBracket]}の方は月{yen(shop.monthlyLimitYen!)}まで購入できます（今月はあと{yen(remaining)}）。
                    購入の前に、必ず保護者の方の同意を得てください。
                  </p>
                )}
                <div className="shop-screen__products">
                  {shop.products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`shop-screen__product${choice?.id === p.id ? " is-selected" : ""}`}
                      disabled={busy || (remaining !== null && p.priceYen > remaining)}
                      onClick={() => setChoice(p)}
                    >
                      <span className="shop-screen__product-jade">雀玉 {p.paidJade.toLocaleString()}</span>
                      <span className="shop-screen__product-bonus">{p.bonusJade > 0 ? `+おまけ ${p.bonusJade.toLocaleString()}` : " "}</span>
                      <span className="shop-screen__product-price">{yen(p.priceYen)}</span>
                    </button>
                  ))}
                </div>
                {choice && (
                  <div className="first-gacha__confirm">
                    <p>
                      雀玉 {choice.paidJade.toLocaleString()}
                      {choice.bonusJade > 0 && `（+おまけ ${choice.bonusJade.toLocaleString()}）`}を{yen(choice.priceYen)}で購入しますか？
                      購入後の返品・キャンセルはできません。
                      {minor && "保護者の方の同意を得ていることを確認してください。"}
                    </p>
                    <div className="setup-buttons">
                      <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void buy(choice)}>
                        {shop.mode === "test" ? "テスト購入する" : "支払いへ進む"}
                      </button>
                      <button type="button" className="btn btn--secondary" onClick={() => setChoice(null)}>
                        やめる
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {shop.purchases.length > 0 && (
              <>
                <div className="online-lobby__section-title">購入の記録</div>
                <ul className="inbox-screen__list">
                  {shop.purchases.map((p) => (
                    <li key={p.id} className="inbox-screen__gift">
                      <div className="inbox-screen__gift-main">
                        <div className="inbox-screen__news-title">
                          雀玉 {p.paidJade.toLocaleString()}
                          {p.bonusJade > 0 && `（+おまけ ${p.bonusJade.toLocaleString()}）`}
                        </div>
                        <div className="inbox-screen__date">
                          {dateTime(p.createdAt)}・{yen(p.priceYen)}
                          {!jadeProduct(p.productId) && "・販売終了の商品"}
                        </div>
                      </div>
                      <span className={`shop-screen__status shop-screen__status--${p.status}`}>{PURCHASE_STATUS_LABELS[p.status]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="setup-buttons">
              <button type="button" className="btn gacha-screen__rates-toggle" onClick={() => setShowLegal((v) => !v)}>
                特定商取引法・資金決済法の表示{showLegal ? "を閉じる" : "を見る"}
              </button>
            </div>
            {showLegal && <LegalNotes />}
          </>
        )}
      </div>
    </div>
  );
}
