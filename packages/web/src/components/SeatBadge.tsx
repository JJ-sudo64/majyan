import type { PlayerIndex, RoundState } from "@majyan/core";

/**
 * 中央局面クラスタの座席バッジ。風・リーチ状態はCharacterPanel（画面外周の
 * キャラクターパネル）側にまとめたため、ここでは局情報を邪魔しない最小限の
 * 点数表示だけに簡略化する（同じ情報を画面内に二重表示しないため）。
 */
export function SeatBadge({ round, player, score }: { round: RoundState; player: PlayerIndex; score: number }) {
  const isCurrent = round.currentTurn === player;

  return (
    <div className={`seat-badge${isCurrent ? " seat-badge--active" : ""}`}>
      <span className="seat-badge__score">{score}</span>
    </div>
  );
}
