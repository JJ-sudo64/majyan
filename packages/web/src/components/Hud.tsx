import type { MatchFormat, RoundState } from "@majyan/core";
import { doraIndicators } from "@majyan/core";
import { TileView } from "./TileView.js";
import { useSettingsStore } from "../store/settingsStore.js";

const FORMAT_LABEL: Record<MatchFormat, string> = { tonpuusen: "東風戦", hanchan: "半荘戦" };

export function Hud({ round, format }: { round: RoundState; format: MatchFormat }) {
  const dora = doraIndicators(round.wall);
  const bgmVolume = useSettingsStore((s) => s.bgmVolume);
  const setBgmVolume = useSettingsStore((s) => s.setBgmVolume);
  const autoTsumogiri = useSettingsStore((s) => s.autoTsumogiri);
  const setAutoTsumogiri = useSettingsStore((s) => s.setAutoTsumogiri);
  const autoWin = useSettingsStore((s) => s.autoWin);
  const setAutoWin = useSettingsStore((s) => s.setAutoWin);

  return (
    <div className="hud">
      <div className="hud__row">
        <div className="hud__label">{FORMAT_LABEL[format]}</div>
      </div>
      <div className="hud__row">
        <span className="hud__dora-label">ドラ表示</span>
        <div className="hud__dora">
          {dora.map((d, i) => (
            <TileView key={i} code={d} tiny />
          ))}
        </div>
      </div>
      {round.honba > 0 && <div className="hud__honba">{round.honba}本場</div>}
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
    </div>
  );
}
