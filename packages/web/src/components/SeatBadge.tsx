import type { PlayerIndex, RoundState } from "@majyan/core";
import { WIND_NAMES, seatWindOf } from "@majyan/core";

export function SeatBadge({ round, player, score }: { round: RoundState; player: PlayerIndex; score: number }) {
  const wind = seatWindOf(round.dealerSeat, player);
  const isDealer = player === round.dealerSeat;
  const isCurrent = round.currentTurn === player;
  const riichi = round.players[player].riichi;

  return (
    <div className={`seat-badge${isCurrent ? " seat-badge--active" : ""}`}>
      <span className="wind-badge">
        {WIND_NAMES[wind]}
        {isDealer ? "(親)" : ""}
      </span>
      <span className="seat-badge__score">{score}点</span>
      {riichi && <span className="riichi-badge">リーチ</span>}
    </div>
  );
}
