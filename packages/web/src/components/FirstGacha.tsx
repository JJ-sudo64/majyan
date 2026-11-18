import { useEffect, useState } from "react";
import { CHARACTERS, FIRST_GACHA } from "@majyan/core";
import { confirmFirstGacha, rollFirstGacha, useAccountStore } from "../online/account.js";
import { GachaCard } from "./GachaCard.js";
import { GachaReveal } from "./GachaReveal.js";
import { preloadGachaSounds } from "../sound.js";
import { useT } from "../i18n/index.js";

/**
 * 最初の10連。何度でも引き直せて、「これで決定」を押すとその結果のキャラが
 * もらえる（マサキが必ず1枠入り、残りは完全ランダム）。抽選はサーバーで行い、ここは結果を見せるだけ。
 * 確定するまではネット対戦の画面の代わりにこれを出す。
 */
export function FirstGacha() {
  const t = useT();
  // 引いた直後の演出の音が最初の1回から遅れず鳴るよう、画面を開いた時に読み込んでおく。
  useEffect(preloadGachaSounds, []);
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
      <h2 className="first-gacha__title">{t("firstGacha.t4", { count: FIRST_GACHA.count })}</h2>
      <p className="setup-lead">{t("firstGacha.t5", { v1: CHARACTERS[FIRST_GACHA.fixed.id]?.name ?? "" })}</p>

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
            {pending ? t("firstGacha.t6", { v1: firstGacha?.rolls ?? 0 }) : t("firstGacha.t7", { count: FIRST_GACHA.count })}
          </button>
          {pending && (
            <button type="button" className="btn btn--large" disabled={busy} onClick={() => setConfirming(true)}>
              {t("firstGacha.t1")}
            </button>
          )}
        </div>
      ) : (
        <div className="first-gacha__confirm">
          <p>{t("firstGacha.t8", { count: FIRST_GACHA.count })}</p>
          <div className="setup-buttons">
            <button type="button" className="btn btn--primary btn--large" disabled={busy} onClick={() => void run(confirmFirstGacha)}>
              {t("firstGacha.t2")}
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setConfirming(false)}>
              {t("firstGacha.t3")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
