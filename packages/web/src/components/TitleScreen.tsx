import { useEffect, useState } from "react";
import { useSettingsStore } from "../store/settingsStore.js";
import { useFitScale } from "../hooks/useFitScale.js";
import { playUiClickFor } from "../sound.js";
import { RulesGuide } from "./RulesGuide.js";
import { useT } from "../i18n/index.js";

/** タイトル背景画像(1672x940)の実ピクセルサイズ。画像内に描かれたボタン絵の
    座標にそのまま合わせて実ボタンを重ねるため、Stageと同様に
    この解像度を基準にしたレターボックス表示にする。 */
const TITLE_WIDTH = 1672;
const TITLE_HEIGHT = 940;

/** タイトル背景画像の上に、画像内に描かれたボタンの位置へ実際にクリックできる
    透明ボタンを重ねるレイアウト。画像自体は静止画のため見た目のボタンは
    押せず、その代わりにこのコンポーネントが座標を合わせた実ボタンを提供する。 */
export function TitleScreen({ onPlay }: { onPlay: () => void }) {
  const t = useT();
  const { containerRef, scale } = useFitScale(TITLE_WIDTH, TITLE_HEIGHT);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPv, setShowPv] = useState(false);
  // 背景画像が上から順に描かれる様子を見せないよう、読み込み終わりまで隠して、終わったらふわっと出す。
  const [bgReady, setBgReady] = useState(false);
  useEffect(() => {
    if (!showPv) return undefined;
    window.dispatchEvent(new CustomEvent("pv-playing", { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent("pv-playing", { detail: false }));
    };
  }, [showPv]);
  const bgmVolume = useSettingsStore((s) => s.bgmVolume);
  const setBgmVolume = useSettingsStore((s) => s.setBgmVolume);
  const seVolume = useSettingsStore((s) => s.seVolume);
  const setSeVolume = useSettingsStore((s) => s.setSeVolume);

  function handleExit() {
    if (window.confirm(t("title.exitConfirm"))) {
      window.close();
    }
  }

  return (
    <div className="title-screen" ref={containerRef} onClickCapture={playUiClickFor}>
      <div className="title-screen__canvas" style={{ width: TITLE_WIDTH, height: TITLE_HEIGHT, zoom: scale }}>
        <img
          className={`title-screen__bg${bgReady ? " title-screen__bg--ready" : ""}`}
          src="/title/title-bg.webp"
          alt={t("title.logoAlt")}
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0) setBgReady(true);
          }}
          onLoad={() => setBgReady(true)}
          onError={() => setBgReady(true)}
        />

        <div className="title-screen__menu">
          <button type="button" className="title-screen__menu-btn" aria-label={t("title.play")} onClick={onPlay} />
          <button type="button" className="title-screen__menu-btn" aria-label={t("title.rules")} onClick={() => setShowRules(true)} />
          <button type="button" className="title-screen__menu-btn" aria-label={t("title.settings")} onClick={() => setShowSettings(true)} />
          <button type="button" className="title-screen__menu-btn" aria-label={t("title.exit")} onClick={handleExit} />
        </div>

        <button type="button" className="title-screen__pv-btn" onClick={() => setShowPv(true)}>
          <span className="title-screen__pv-btn__icon">▶</span>PV
        </button>
      </div>

      {showPv && (
        <div className="modal-overlay" onClick={() => setShowPv(false)}>
          <div className="pv-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="pv-modal__close" aria-label={t("common.close")} onClick={() => setShowPv(false)}>
              ×
            </button>
            <video className="pv-modal__video" src="/about/pv.mp4" poster="/about/img/pv-poster.webp" controls autoPlay playsInline />
          </div>
        </div>
      )}

      {showRules && <RulesGuide onClose={() => setShowRules(false)} />}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="title-modal" onClick={(e) => e.stopPropagation()}>
            <div className="setup-picker-modal__header">
              <div className="setup-character-select__label">{t("settings.title")}</div>
              <button type="button" className="setup-picker-modal__close" onClick={() => setShowSettings(false)}>
                ×
              </button>
            </div>
            <div className="title-modal__body">
              <div className="hud__row hud__bgm-volume">
                <span className="hud__dora-label">{t("settings.bgmVolume")}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={bgmVolume}
                  onChange={(e) => setBgmVolume(Number(e.target.value))}
                />
                <span className="hud__bgm-volume__value">{Math.round(bgmVolume * 100)}%</span>
              </div>
              <div className="hud__row hud__bgm-volume">
                <span className="hud__dora-label">{t("settings.seVolume")}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={seVolume}
                  onChange={(e) => setSeVolume(Number(e.target.value))}
                />
                <span className="hud__bgm-volume__value">{Math.round(seVolume * 100)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
