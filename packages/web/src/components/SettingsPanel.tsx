import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../store/settingsStore.js";

/** 自動ツモ切り/自動和了トグルを、対局情報(Hud.tsx)とは切り離して画面左下に
    常設する設定パネル。以前はHudパネル(左上)に同居していたが、対局情報と
    設定操作は役割が異なるため分離した。BGM音量は画面右端の歯車アイコンを
    押した時だけ出るポップオーバーに移した（指摘により）。 */
export function SettingsPanel() {
  const bgmVolume = useSettingsStore((s) => s.bgmVolume);
  const setBgmVolume = useSettingsStore((s) => s.setBgmVolume);
  const seVolume = useSettingsStore((s) => s.seVolume);
  const setSeVolume = useSettingsStore((s) => s.setSeVolume);
  const autoTsumogiri = useSettingsStore((s) => s.autoTsumogiri);
  const setAutoTsumogiri = useSettingsStore((s) => s.setAutoTsumogiri);
  const autoWin = useSettingsStore((s) => s.autoWin);
  const setAutoWin = useSettingsStore((s) => s.setAutoWin);

  const [volumeOpen, setVolumeOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // ポップオーバーの外側をクリックしたら閉じる（歯車自体の再クリックは
  // トグルのままにしたいので、ここではrefの外側かどうかだけ見る）。
  useEffect(() => {
    if (!volumeOpen) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setVolumeOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [volumeOpen]);

  return (
    <>
      <div className="settings-panel">
        <div className="hud__row hud__auto-toggles">
          <button
            type="button"
            className={`hud__toggle-btn${autoTsumogiri ? " hud__toggle-btn--on" : ""}`}
            onClick={() => setAutoTsumogiri(!autoTsumogiri)}
          >
            自動ツモ切り{autoTsumogiri ? " ON" : " OFF"}
          </button>
          <button
            type="button"
            className={`hud__toggle-btn${autoWin ? " hud__toggle-btn--on" : ""}`}
            onClick={() => setAutoWin(!autoWin)}
          >
            自動和了{autoWin ? " ON" : " OFF"}
          </button>
        </div>
      </div>

      <div className="volume-gear-wrap" ref={wrapRef}>
        <button
          type="button"
          className="volume-gear"
          aria-label="音量設定"
          aria-expanded={volumeOpen}
          onClick={() => setVolumeOpen((v) => !v)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.14 12.94a7.14 7.14 0 0 0 .06-.94 7.14 7.14 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.32.66.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.1.52.02.66-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7"
            />
          </svg>
        </button>
        {volumeOpen && (
          <div className="volume-popover">
            <div className="hud__row hud__bgm-volume">
              <span className="hud__dora-label">BGM音量</span>
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
              <span className="hud__dora-label">SE音量</span>
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
        )}
      </div>
    </>
  );
}
