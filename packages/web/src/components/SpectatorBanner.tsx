import { useGameStore } from "../store/gameStore.js";
import { useT } from "../i18n/index.js";

/** 観戦中、画面の上に出す帯（誰の後ろから見ているかと、観戦をやめるボタン）。 */
export function SpectatorBanner() {
  const t = useT();
  const seats = useGameStore((s) => s.onlineSeats);
  const backToTitle = useGameStore((s) => s.backToTitle);
  return (
    <div className="replay-controls spectator-banner">
      <div className="replay-controls__info">
        <strong>{t("spectatorBanner.t1")}</strong>
        <span>{t("spectatorBanner.t3", { v1: seats?.[0]?.name ?? "" })}</span>
      </div>
      <button type="button" className="btn btn--secondary" onClick={backToTitle}>
        {t("spectatorBanner.t2")}
      </button>
    </div>
  );
}
