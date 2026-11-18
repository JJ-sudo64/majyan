import { useEffect, useState } from "react";
import {
  CARDS,
  CHARACTERS,
  EXCHANGE_COST,
  EXCHANGE_RARITY,
  GACHA_PRICE,
  GACHA_RARITY_RATES,
  gachaPool,
  itemRate,
  pickupItemsOf,
  TEN_PULL_GUARANTEE,
  type GachaItem,
  rarityOf,
  type GachaRollResponse,
  type Rarity,
} from "@majyan/core";
import { exchangeItem, rollGacha, useAccountStore } from "../online/account.js";
import { GachaCard, RARITY_STARS } from "./GachaCard.js";
import { GachaReveal } from "./GachaReveal.js";
import { RecordsScreen } from "./RecordsScreen.js";
import { preloadGachaSounds } from "../sound.js";
import { shareToX } from "../share.js";
import { useT, useTn, type Translate } from "../i18n/index.js";

const RARITIES: Rarity[] = [3, 2, 1];

/** ★3が出た回だけシェア文面を返す（出ていなければ null でボタンを出さない）。 */
function shareText(items: GachaItem[], t: Translate): string | null {
  const stars = items.filter((it) => rarityOf(it) === 3);
  if (stars.length === 0) return null;
  const names = stars.map((it) => (it.kind === "character" ? CHARACTERS[it.id]?.name : CARDS[it.id]?.name)).filter(Boolean);
  return t("gacha.share", { names: names.join(t("gacha.shareJoin")) });
}

/** 確率の表示（小数第3位まで、末尾の0は省く）。 */
function percent(rate: number): string {
  return `${Number((rate * 100).toFixed(3))}%`;
}

const fullName = (item: GachaItem) => (item.kind === "character" ? CHARACTERS[item.id]?.name : CARDS[item.id]?.name) ?? item.id;
const sameItem = (a: GachaItem | null, b: GachaItem) => !!a && a.kind === b.kind && a.id === b.id;

/**
 * 雀玉で引く通常のガチャ（キャラとカードが混ざって出る）。抽選はサーバーで行い、
 * ここは結果を見せるだけ。提供割合（レア度ごと・1つごとの確率）はガチャの画面から
 * 必ず見られるようにする（ガチャの確率表示は業界の自主規制・各ストアの規約で求められている）。
 */
export function GachaScreen({ onClose }: { onClose: () => void }) {
  const tn = useTn();
  const t = useT();
  // 引いた直後の演出の音が最初の1回から遅れず鳴るよう、画面を開いた時に読み込んでおく。
  useEffect(preloadGachaSounds, []);
  const jade = useAccountStore((s) => s.jade);
  const error = useAccountStore((s) => s.error);
  const exchangePoints = useAccountStore((s) => s.exchangePoints);
  const pickup = useAccountStore((s) => s.pickup);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GachaRollResponse | null>(null);
  /** 引いた直後の演出（GachaReveal）の最中か。終わるまで結果の一覧は出さない。 */
  const [revealing, setRevealing] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const total = jade ? jade.free + jade.paid : 0;

  async function run(fn: () => Promise<GachaRollResponse | null>, after?: () => void, reveal = false) {
    setBusy(true);
    useAccountStore.setState({ error: null });
    try {
      const res = await fn();
      if (res) {
        setResult(res);
        setRevealing(reveal);
        after?.();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      {/* 10連の結果を出している間は、説明文などを畳んで、10枚とボタンが1画面に収まるようにする（--result）。 */}
      <div className={`gacha-screen${result && !revealing ? " gacha-screen--result" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">{t("gachaScreen.t1")}</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="gacha-screen__jade">{tn("gachaScreen.t23", { strong: <strong>{total.toLocaleString()}</strong>, v1: jade && jade.paid > 0 && (
            <span className="gacha-screen__jade-detail">{t("gachaScreen.t6", { v1: jade.free.toLocaleString(), v2: jade.paid.toLocaleString() })}</span>
          ) })}</div>

        {pickup && (
          <div className="gacha-screen__pickup">
            <div className="gacha-screen__pickup-title">{tn("gachaScreen.t24", { title: pickup.title, span: <span className="gacha-screen__pickup-until">{t("gachaScreen.t7", { v1: new Date(pickup.endsAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}</span> })}</div>
            <div className="gacha-screen__pickup-items">
              {pickup.items.map((item) => {
                const character = item.kind === "character" ? CHARACTERS[item.id] : undefined;
                return (
                  <span key={`${item.kind}-${item.id}`} className="gacha-screen__pickup-item">
                    {character ? <img src={character.avatar} alt="" /> : <span className="gacha-card__card-icon">{t("gachaScreen.t2")}</span>}
                    <span>
                      {RARITY_STARS[rarityOf(item)]} {fullName(item)}
                      <small>{t("gachaScreen.t8", { v1: percent(itemRate(item, pickup)), v2: percent(itemRate(item)) })}</small>
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {result && revealing && <GachaReveal items={result.results} onDone={() => setRevealing(false)} />}
        {result && !revealing && (
          <div className="first-gacha__grid">
            {result.results.map((item, i) => (
              <GachaCard key={`${i}-${item.kind}-${item.id}-${result.me.jade.free}`} item={item} index={i} isNew={result.isNew[i]} />
            ))}
          </div>
        )}
        {result && !revealing && shareText(result.results, t) && (
          <div className="setup-buttons">
            <button type="button" className="btn" onClick={() => shareToX(shareText(result.results, t)!)}>
              {t("gachaScreen.t3")}
            </button>
          </div>
        )}
        {error && <p className="online-lobby__error">{error}</p>}

        <div className="setup-buttons gacha-screen__pulls">
          <button type="button" className="btn btn--large" disabled={busy || total < GACHA_PRICE.single} onClick={() => void run(() => rollGacha(1), undefined, true)}>{tn("gachaScreen.t25", { span: <span className="gacha-screen__price">{t("gachaScreen.t9", { single: GACHA_PRICE.single })}</span> })}</button>
          <button
            type="button"
            className="btn btn--primary btn--large"
            disabled={busy || total < GACHA_PRICE.ten}
            onClick={() => void run(() => rollGacha(10), undefined, true)}
          >{tn("gachaScreen.t26", { span: <span className="gacha-screen__price">{t("gachaScreen.t10", { v1: GACHA_PRICE.ten.toLocaleString() })}</span> })}</button>
        </div>
        <p className="setup-lead">{t("gachaScreen.t11", { rarity: TEN_PULL_GUARANTEE.rarity })}</p>

        <div className="gacha-screen__exchange">
          <span>{tn("gachaScreen.t27", { strong: <strong>{exchangePoints}</strong>, EXCHANGE_COST, EXCHANGE_COST1: EXCHANGE_COST, EXCHANGE_RARITY })}</span>
          <button type="button" className="btn" disabled={busy || exchangePoints < EXCHANGE_COST} onClick={() => void run(() => exchangeItem(), undefined, true)}>{t("gachaScreen.t12", { EXCHANGE_RARITY })}</button>
        </div>
        <div className="setup-buttons gacha-screen__links">
          <button type="button" className="btn gacha-screen__rates-toggle" onClick={() => setShowRates((v) => !v)}>{t("gachaScreen.t13", { v1: showRates ? t("gachaScreen.t19") : t("gachaScreen.t20") })}</button>
          <button type="button" className="btn gacha-screen__rates-toggle" onClick={() => setShowRecords(true)}>
            {t("gachaScreen.t4")}
          </button>
        </div>
        {showRecords && <RecordsScreen onClose={() => setShowRecords(false)} />}
        {showRates && (
          <div className="modal-overlay" onClick={() => setShowRates(false)}>
            <div className="gacha-screen gacha-rates-modal" onClick={(e) => e.stopPropagation()}>
              <div className="setup-picker-modal__header">
                <div className="setup-character-select__label">{t("gachaScreen.t5")}</div>
                <button type="button" className="setup-picker-modal__close" onClick={() => setShowRates(false)}>
                  ×
                </button>
              </div>
              <div className="gacha-screen__rates">
                {RARITIES.map((r) => {
                  const pool = gachaPool(r);
                  const chars = pool.filter((i) => i.kind === "character");
                  const cardItems = pool.filter((i) => i.kind === "card");
                  const featured = pickupItemsOf(pickup, r);
                  const others = pool.filter((i) => !featured.some((f) => sameItem(f, i)));
                  return (
                    <div key={r} className="gacha-screen__rate-block">
                      <div className="gacha-screen__rate-head">{t("gachaScreen.t14", { v1: RARITY_STARS[r], v2: percent(GACHA_RARITY_RATES[r]), length: chars.length, v3: cardItems.length, v4: featured.length > 0
                          ? t("gachaScreen.t21", { v1: percent(itemRate(featured[0]!, pickup)), v2: others[0] ? percent(itemRate(others[0], pickup)) : "-" })
                          : t("gachaScreen.t22", { v1: percent(GACHA_RARITY_RATES[r] / pool.length) }) })}</div>
                      {featured.length > 0 && <div className="gacha-screen__rate-names">{t("gachaScreen.t15", { v1: featured.map(fullName).join("、") })}</div>}
                      <div className="gacha-screen__rate-names">{t("gachaScreen.t16", { v1: chars.map(fullName).join("、") })}</div>
                      <div className="gacha-screen__rate-names">{t("gachaScreen.t17", { v1: cardItems.map(fullName).join("、") })}</div>
                    </div>
                  );
                })}
                <p className="gacha-screen__rate-note">{t("gachaScreen.t18", { rarity: TEN_PULL_GUARANTEE.rarity, v1: TEN_PULL_GUARANTEE.rarity })}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
