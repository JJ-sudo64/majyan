import { useEffect, useState } from "react";
import {
  AGE_BRACKET_LABELS,
  MONTHLY_LIMIT_YEN,
  PURCHASE_STATUS_LABELS,
  jadeProduct,
  legalNoticeRows,
  type JadeProduct,
  type ShopResponse,
} from "@majyan/core";
import { declareBirthMonth, fetchShop, payTestPurchase, startCheckout } from "../online/account.js";
import { useT, useTn } from "../i18n/index.js";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const dateTime = (ms: number) => new Date(ms).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });

/** 支払いのページから戻ってきた直後は、決済会社からの通知が少し遅れて届くことがあるので、何度か読み直す。 */
const RETURN_RELOAD_DELAYS_MS = [2000, 5000, 10000];

/** 生まれた年月を聞く（未成年の買いすぎを防ぐ上限を決めるため）。 */
function AgeGate({ onSubmit, busy }: { onSubmit: (birthMonth: string) => void; busy: boolean }) {
  const t = useT();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [confirming, setConfirming] = useState(false);
  const birthMonth = year && month ? `${year}-${month.padStart(2, "0")}` : null;

  return (
    <div className="shop-screen__age">
      <p className="setup-lead">{t("shopScreen.t13", { under16: AGE_BRACKET_LABELS.under16, v1: yen(MONTHLY_LIMIT_YEN.under16!), v2: AGE_BRACKET_LABELS["16to17"], v3: yen(MONTHLY_LIMIT_YEN["16to17"]!) })}</p>
      <div className="shop-screen__age-inputs">
        <select value={year} onChange={(e) => (setYear(e.target.value), setConfirming(false))} aria-label={t("shopScreen.t1")}>
          <option value="">{t("shopScreen.t2")}</option>
          {Array.from({ length: 100 }, (_, i) => thisYear - i).map((y) => (
            <option key={y} value={y}>{t("shopScreen.t14", { y })}</option>
          ))}
        </select>
        <select value={month} onChange={(e) => (setMonth(e.target.value), setConfirming(false))} aria-label={t("shopScreen.t3")}>
          <option value="">{t("shopScreen.t4")}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{t("shopScreen.t15", { m })}</option>
          ))}
        </select>
        {!confirming && (
          <button type="button" className="btn" disabled={!birthMonth} onClick={() => setConfirming(true)}>
            {t("shopScreen.t5")}
          </button>
        )}
      </div>
      {confirming && birthMonth && (
        <div className="first-gacha__confirm">
          <p>{t("shopScreen.t16", { year, month })}</p>
          <div className="setup-buttons">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onSubmit(birthMonth)}>
              {t("shopScreen.t6")}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)}>
              {t("shopScreen.t7")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 特定商取引法に基づく表記と、資金決済法に基づく表示。 */
function LegalNotes() {
  const t = useT();
  const { commerce: rows, commerceNote, prepaid } = legalNoticeRows();
  const table = (items: [string, string][]) => (
    <table className="shop-screen__legal-table">
      <tbody>
        {items.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td style={{ whiteSpace: "pre-line" }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="shop-screen__legal">
      <div className="online-lobby__section-title">{t("shopScreen.t8")}</div>
      {table(rows)}
      <p>{commerceNote}</p>
      <div className="online-lobby__section-title">{t("shopScreen.t9")}</div>
      {table(prepaid)}
    </div>
  );
}

/**
 * 雀玉を買う画面。returned は支払いのページから戻ってきた時の印（"done" / "cancel"）。
 * 雀玉が増えるのは、サーバーが決済会社から支払いの通知を受けた時（この画面からは増やせない）。
 */
export function ShopScreen({ onClose, returned }: { onClose: () => void; returned?: string | null }) {
  const tn = useTn();
  const t = useT();
  const [shop, setShop] = useState<ShopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    returned === "done" ? t("shopScreen.t17") : returned === "cancel" ? t("shopScreen.t18") : null,
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
      setNotice(t("shopScreen.t19", { v1: product.paidJade + product.bonusJade }));
      return next;
    });

  const remaining = shop && shop.monthlyLimitYen !== null ? Math.max(0, shop.monthlyLimitYen - shop.monthlySpentYen) : null;
  const minor = shop?.ageBracket === "under16" || shop?.ageBracket === "16to17";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen shop-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">{t("onlineLobby.t13")}</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        {!shop && !error && <p className="setup-lead">{t("friendsScreen.t2")}</p>}
        {error && <p className="online-lobby__error">{error}</p>}
        {notice && (
          <div className="online-lobby__notice" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
        {shop && (
          <>
            <div className="gacha-screen__jade">{tn("shopScreen.t32", { strong: <strong>{(shop.jade.free + shop.jade.paid).toLocaleString()}</strong>, span: <span className="gacha-screen__jade-detail">{t("gachaScreen.t6", { v1: shop.jade.free.toLocaleString(), v2: shop.jade.paid.toLocaleString() })}</span> })}</div>
            {shop.mode === "closed" && <p className="setup-lead">{t("shopScreen.t10")}</p>}
            {shop.mode === "test" && <p className="shop-screen__test">{t("shopScreen.t11")}</p>}
            {shop.mode !== "closed" && !shop.ageBracket && <AgeGate busy={busy} onSubmit={(m) => void run(() => declareBirthMonth(m))} />}
            {shop.mode !== "closed" && shop.ageBracket && (
              <>
                {remaining !== null && (
                  <p className="setup-lead">{t("shopScreen.t20", { v1: AGE_BRACKET_LABELS[shop.ageBracket], v2: yen(shop.monthlyLimitYen!), v3: yen(remaining) })}</p>
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
                      <span className="shop-screen__product-jade">{t("shopScreen.t21", { v1: p.paidJade.toLocaleString() })}</span>
                      <span className="shop-screen__product-bonus">{p.bonusJade > 0 ? t("shopScreen.t22", { v1: p.bonusJade.toLocaleString() }) : " "}</span>
                      <span className="shop-screen__product-price">{yen(p.priceYen)}</span>
                    </button>
                  ))}
                </div>
                {choice && (
                  <div className="first-gacha__confirm">
                    <p>{t("shopScreen.t23", { v1: choice.paidJade.toLocaleString(), v2: choice.bonusJade > 0 ? t("shopScreen.t29", { v1: choice.bonusJade.toLocaleString() }) : "", v3: yen(choice.priceYen), v4: minor ? t("shopScreen.t30") : "" })}</p>
                    <div className="setup-buttons">
                      <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void buy(choice)}>
                        {shop.mode === "test" ? t("shopScreen.t24") : t("shopScreen.t25")}
                      </button>
                      <button type="button" className="btn btn--secondary" onClick={() => setChoice(null)}>
                        {t("cardSlot.t7")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {shop.purchases.length > 0 && (
              <>
                <div className="online-lobby__section-title">{t("shopScreen.t12")}</div>
                <ul className="inbox-screen__list">
                  {shop.purchases.map((p) => (
                    <li key={p.id} className="inbox-screen__gift">
                      <div className="inbox-screen__gift-main">
                        <div className="inbox-screen__news-title">{t("shopScreen.t26", { v1: p.paidJade.toLocaleString(), v2: p.bonusJade > 0 ? t("shopScreen.t29", { v1: p.bonusJade.toLocaleString() }) : "" })}</div>
                        <div className="inbox-screen__date">{t("shopScreen.t27", { v1: dateTime(p.createdAt), v2: yen(p.priceYen), v3: !jadeProduct(p.productId) ? t("shopScreen.t31") : "" })}</div>
                      </div>
                      <span className={`shop-screen__status shop-screen__status--${p.status}`}>{PURCHASE_STATUS_LABELS[p.status]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="setup-buttons">
              <button type="button" className="btn gacha-screen__rates-toggle" onClick={() => setShowLegal((v) => !v)}>{t("shopScreen.t28", { v1: showLegal ? t("gachaScreen.t19") : t("gachaScreen.t20") })}</button>
            </div>
            {showLegal && <LegalNotes />}
          </>
        )}
      </div>
    </div>
  );
}
