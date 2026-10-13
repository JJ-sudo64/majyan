import { useState } from "react";
import { CHARACTERS, FIRST_GACHA } from "@majyan/core";
import { confirmFirstGacha, rollFirstGacha, useAccountStore } from "../online/account.js";
import { GachaCard } from "./GachaCard.js";
import { GachaReveal } from "./GachaReveal.js";

/**
 * 最初の10連。何度でも引き直せて、「これで決定」を押すとその結果のキャラが
 * もらえる（マサトが必ず1枠入り、残りは完全ランダム）。抽選はサーバーで行い、ここは結果を見せるだけ。
 * 確定するまではネット対戦の画面の代わりにこれを出す。
 */
export function FirstGacha() {
  const firstGacha = useAccountStore((s) => s.firstGacha);
  const error = useAccountStore((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** 引いた直後の演出（GachaReveal）の最中か。画面を開き直した時の結果には出さない。 */
  const [revealing, setRevealing] = useState(false);
  const pending = firstGacha?.pending ?? null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function rollAndReveal() {
    const before = useAccountStore.getState().firstGacha?.rolls;
    await run(rollFirstGacha);
    // 引けなかった時（通信エラーなど）は、前の結果で演出をやり直さない。
    if (useAccountStore.getState().firstGacha?.rolls !== before) setRevealing(true);
  }

  return (
    <div className="first-gacha">
      <h2 className="first-gacha__title">はじめの{FIRST_GACHA.count}連</h2>
      <p className="setup-lead">
        最初の仲間を選ぶガチャです。キャラとカードが出ます。{CHARACTERS[FIRST_GACHA.fixed.id]?.name ?? ""}は必ず1枠入ります。納得いくまで何度でも引き直せます。「これで決定」を押すと、出たものがすべて手に入ります。
      </p>

      {pending && revealing && <GachaReveal key={firstGacha?.rolls} items={pending} onDone={() => setRevealing(false)} />}
      {pending && !revealing && (
        <div className="first-gacha__grid">
          {pending.map((item, i) => (
            <GachaCard key={`${firstGacha?.rolls}-${i}`} item={item} index={i} />
          ))}
        </div>
      )}

      {error && <p className="online-lobby__error">{error}</p>}

      {!confirming ? (
        <div className="setup-buttons">
          <button type="button" className="btn btn--primary btn--large" disabled={busy} onClick={() => void rollAndReveal()}>
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
