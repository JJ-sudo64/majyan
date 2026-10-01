import { useState } from "react";
import {
  CARDS,
  CHARACTERS,
  EXCHANGE_COST,
  EXCHANGE_RARITY,
  GACHA_PRICE,
  GACHA_RARITY_RATES,
  gachaPool,
  TEN_PULL_GUARANTEE,
  type GachaItem,
  type GachaRollResponse,
  type Rarity,
} from "@majyan/core";
import { exchangeItem, rollGacha, useAccountStore } from "../online/account.js";
import { GachaCard, RARITY_STARS } from "./GachaCard.js";

const RARITIES: Rarity[] = [3, 2, 1];

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
  const jade = useAccountStore((s) => s.jade);
  const error = useAccountStore((s) => s.error);
  const exchangePoints = useAccountStore((s) => s.exchangePoints);
  const units = useAccountStore((s) => s.units);
  const cards = useAccountStore((s) => s.cards);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GachaRollResponse | null>(null);
  const [showRates, setShowRates] = useState(false);
  const [showExchange, setShowExchange] = useState(false);
  const [exchangeTarget, setExchangeTarget] = useState<GachaItem | null>(null);
  const total = jade ? jade.free + jade.paid : 0;

  /** 交換の一覧に出す「いくつ持っているか」（キャラは体数、カードは付けていない枚数＋付けた枚数）。 */
  function ownedCount(item: GachaItem): number {
    if (item.kind === "character") return units.filter((u) => u.characterId === item.id).length;
    return (cards[item.id] ?? 0) + units.filter((u) => u.cardId === item.id).length;
  }

  async function run(fn: () => Promise<GachaRollResponse | null>, after?: () => void) {
    setBusy(true);
    useAccountStore.setState({ error: null });
    try {
      const res = await fn();
      if (res) {
        setResult(res);
        after?.();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">ガチャ</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="gacha-screen__jade">
          雀玉 <strong>{total.toLocaleString()}</strong>
          {jade && jade.paid > 0 && (
            <span className="gacha-screen__jade-detail">
              （無償 {jade.free.toLocaleString()} ／ 有償 {jade.paid.toLocaleString()}）
            </span>
          )}
        </div>

        {result && (
          <div className="first-gacha__grid">
            {result.results.map((item, i) => (
              <GachaCard key={`${i}-${item.kind}-${item.id}-${result.me.jade.free}`} item={item} index={i} isNew={result.isNew[i]} />
            ))}
          </div>
        )}
        {error && <p className="online-lobby__error">{error}</p>}

        <div className="setup-buttons">
          <button type="button" className="btn btn--large" disabled={busy || total < GACHA_PRICE.single} onClick={() => void run(() => rollGacha(1))}>
            1回（雀玉{GACHA_PRICE.single}）
          </button>
          <button
            type="button"
            className="btn btn--primary btn--large"
            disabled={busy || total < GACHA_PRICE.ten}
            onClick={() => void run(() => rollGacha(10))}
          >
            10連（雀玉{GACHA_PRICE.ten.toLocaleString()}）
          </button>
        </div>
        <p className="setup-lead">
          キャラとカードが出ます。10連は★{TEN_PULL_GUARANTEE.rarity}以上が1つ確定。同じキャラが出たら別々の仲間として増えます。
          雀玉は段位戦の報酬とログインボーナスでもらえます。
        </p>

        <div className="gacha-screen__exchange">
          <span>
            交換ポイント <strong>{exchangePoints}</strong> / {EXCHANGE_COST}（1回引くごとに1ポイント。{EXCHANGE_COST}で★{EXCHANGE_RARITY}
            のキャラかカードを1つ選んでもらえます）
          </span>
          <button type="button" className="btn" disabled={busy || exchangePoints < EXCHANGE_COST} onClick={() => setShowExchange((v) => !v)}>
            ★{EXCHANGE_RARITY}と交換
          </button>
        </div>
        {showExchange && (
          <div className="gacha-screen__exchange-list">
            {gachaPool(EXCHANGE_RARITY).map((item) => {
              const character = item.kind === "character" ? CHARACTERS[item.id] : undefined;
              const owned = ownedCount(item);
              return (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  className={`gacha-screen__exchange-item${sameItem(exchangeTarget, item) ? " gacha-screen__exchange-item--selected" : ""}`}
                  onClick={() => setExchangeTarget(item)}
                >
                  {character ? <img src={character.avatar} alt="" /> : <span className="gacha-card__card-icon">カード</span>}
                  <span>{fullName(item)}</span>
                  <span className="gacha-screen__exchange-owned">{owned > 0 ? `${owned}つ所持` : "未所持"}</span>
                </button>
              );
            })}
            {exchangeTarget && (
              <div className="first-gacha__confirm">
                <p>
                  {fullName(exchangeTarget)} と交換しますか？（交換ポイント {EXCHANGE_COST} を使います）
                </p>
                <div className="setup-buttons">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => exchangeItem(exchangeTarget),
                        () => {
                          setShowExchange(false);
                          setExchangeTarget(null);
                        },
                      )
                    }
                  >
                    交換する
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => setExchangeTarget(null)}>
                    やめる
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button type="button" className="btn gacha-screen__rates-toggle" onClick={() => setShowRates((v) => !v)}>
          提供割合{showRates ? "を閉じる" : "を見る"}
        </button>
        {showRates && (
          <div className="gacha-screen__rates">
            {RARITIES.map((r) => {
              const pool = gachaPool(r);
              const chars = pool.filter((i) => i.kind === "character");
              const cardItems = pool.filter((i) => i.kind === "card");
              return (
                <div key={r} className="gacha-screen__rate-block">
                  <div className="gacha-screen__rate-head">
                    {RARITY_STARS[r]}　{percent(GACHA_RARITY_RATES[r])}（キャラ{chars.length}人・カード{cardItems.length}枚、1つあたり
                    {percent(GACHA_RARITY_RATES[r] / pool.length)}）
                  </div>
                  <div className="gacha-screen__rate-names">キャラ：{chars.map(fullName).join("、")}</div>
                  <div className="gacha-screen__rate-names">カード：{cardItems.map(fullName).join("、")}</div>
                </div>
              );
            })}
            <p className="gacha-screen__rate-note">
              10連で★{TEN_PULL_GUARANTEE.rarity}以上が1つも出なかった場合、10枠目を★{TEN_PULL_GUARANTEE.rarity}のキャラ・カードの中から引き直します。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
