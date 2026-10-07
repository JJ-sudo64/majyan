import { useGameStore } from "../store/gameStore.js";

/** 観戦中、画面の上に出す帯（誰の後ろから見ているかと、観戦をやめるボタン）。 */
export function SpectatorBanner() {
  const seats = useGameStore((s) => s.onlineSeats);
  const backToTitle = useGameStore((s) => s.backToTitle);
  return (
    <div className="replay-controls spectator-banner">
      <div className="replay-controls__info">
        <strong>観戦中</strong>
        <span>{seats?.[0]?.name ?? ""} さんの後ろから（手牌は見えません）</span>
      </div>
      <button type="button" className="btn btn--secondary" onClick={backToTitle}>
        観戦をやめる
      </button>
    </div>
  );
}
