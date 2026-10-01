import { useState } from "react";
import {
  CHARACTERS,
  charactersOfRarity,
  GACHA_PRICE,
  GACHA_RARITY_RATES,
  TEN_PULL_GUARANTEED_RARITY,
  type GachaRollResponse,
  type Rarity,
} from "@majyan/core";
import { rollGacha, useAccountStore } from "../online/account.js";
import { GachaCard, RARITY_STARS } from "./GachaCard.js";

const RARITIES: Rarity[] = [3, 2, 1];

/** 確率の表示（小数第3位まで、末尾の0は省く）。 */
function percent(rate: number): string {
  return `${Number((rate * 100).toFixed(3))}%`;
}

/**
 * 雀玉で引く通常のガチャ。抽選はサーバーで行い、ここは結果を見せるだけ。
 * 提供割合（レア度ごと・キャラごとの確率）はガチャの画面から必ず見られるようにする
 * （ガチャの確率表示は業界の自主規制・各ストアの規約で求められている）。
 */
export function GachaScreen({ onClose }: { onClose: () => void }) {
  const jade = useAccountStore((s) => s.jade);
  const error = useAccountStore((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GachaRollResponse | null>(null);
  const [showRates, setShowRates] = useState(false);
  const total = jade ? jade.free + jade.paid : 0;

  async function roll(count: 1 | 10) {
    setBusy(true);
    useAccountStore.setState({ error: null });
    try {
      const res = await rollGacha(count);
      if (res) setResult(res);
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
            {result.results.map((id, i) => (
              <GachaCard key={`${i}-${id}-${result.me.jade.free}`} characterId={id} index={i} isNew={result.newCharacterIds.includes(id)} />
            ))}
          </div>
        )}

        {error && <p className="online-lobby__error">{error}</p>}

        <div className="setup-buttons">
          <button type="button" className="btn btn--large" disabled={busy || total < GACHA_PRICE.single} onClick={() => void roll(1)}>
            1回（雀玉{GACHA_PRICE.single}）
          </button>
          <button type="button" className="btn btn--primary btn--large" disabled={busy || total < GACHA_PRICE.ten} onClick={() => void roll(10)}>
            10連（雀玉{GACHA_PRICE.ten.toLocaleString()}）
          </button>
        </div>
        <p className="setup-lead">10連は★{TEN_PULL_GUARANTEED_RARITY}以上が1人確定。雀玉は段位戦の報酬とログインボーナスでもらえます。</p>

        <button type="button" className="btn gacha-screen__rates-toggle" onClick={() => setShowRates((v) => !v)}>
          提供割合{showRates ? "を閉じる" : "を見る"}
        </button>
        {showRates && (
          <div className="gacha-screen__rates">
            {RARITIES.map((r) => {
              const pool = charactersOfRarity(r);
              return (
                <div key={r} className="gacha-screen__rate-block">
                  <div className="gacha-screen__rate-head">
                    {RARITY_STARS[r]}　{percent(GACHA_RARITY_RATES[r])}（{pool.length}人、1人あたり{percent(GACHA_RARITY_RATES[r] / pool.length)}）
                  </div>
                  <div className="gacha-screen__rate-names">{pool.map((id) => CHARACTERS[id]?.name ?? id).join("、")}</div>
                </div>
              );
            })}
            <p className="gacha-screen__rate-note">
              10連で★{TEN_PULL_GUARANTEED_RARITY}以上が1人も出なかった場合、10枠目を★{TEN_PULL_GUARANTEED_RARITY}の中から引き直します。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
