import { useState } from "react";
import { FIRST_GACHA } from "@majyan/core";
import { confirmFirstGacha, rollFirstGacha, useAccountStore } from "../online/account.js";
import { GachaCard } from "./GachaCard.js";

/**
 * 最初の10連。何度でも引き直せて、「これで決定」を押すとその結果のキャラが
 * もらえる（確定枠なしの完全ランダム）。抽選はサーバーで行い、ここは結果を見せるだけ。
 * 確定するまではネット対戦の画面の代わりにこれを出す。
 */
export function FirstGacha() {
  const firstGacha = useAccountStore((s) => s.firstGacha);
  const error = useAccountStore((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pending = firstGacha?.pending ?? null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="first-gacha">
      <h2 className="first-gacha__title">はじめの{FIRST_GACHA.count}連</h2>
      <p className="setup-lead">
        最初の仲間を選ぶガチャです。キャラとカードが出ます。納得いくまで何度でも引き直せます。「これで決定」を押すと、出たものがすべて手に入ります。
      </p>

      {pending && (
        <div className="first-gacha__grid">
          {pending.map((item, i) => (
            <GachaCard key={`${firstGacha?.rolls}-${i}`} item={item} index={i} />
          ))}
        </div>
      )}

      {error && <p className="online-lobby__error">{error}</p>}

      {!confirming ? (
        <div className="setup-buttons">
          <button type="button" className="btn btn--primary btn--large" disabled={busy} onClick={() => void run(rollFirstGacha)}>
            {pending ? `引き直す（${firstGacha?.rolls ?? 0}回目）` : `${FIRST_GACHA.count}連を引く`}
          </button>
          {pending && (
            <button type="button" className="btn btn--large" disabled={busy} onClick={() => setConfirming(true)}>
              これで決定
            </button>
          )}
        </div>
      ) : (
        <div className="first-gacha__confirm">
          <p>この{FIRST_GACHA.count}連の結果で決定しますか？（決定した後は引き直せません）</p>
          <div className="setup-buttons">
            <button type="button" className="btn btn--primary btn--large" disabled={busy} onClick={() => void run(confirmFirstGacha)}>
              決定する
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setConfirming(false)}>
              もう少し引く
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
