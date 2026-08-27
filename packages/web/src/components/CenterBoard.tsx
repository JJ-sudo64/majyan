import type { RoundState } from "@majyan/core";
import { WIND_NAMES } from "@majyan/core";
import { SeatBadge } from "./SeatBadge.js";

export function CenterBoard({ round, scores }: { round: RoundState; scores: [number, number, number, number] }) {
  return (
    <>
      <div className="center-board">
        <div className="center-board__core">
          <div className="center-board__round">
            {WIND_NAMES[round.roundWind]}
            {round.roundNumber}局
          </div>
          <div className="center-board__wall">残り {round.wall.liveTiles.length}枚</div>
          {round.kyotaku > 0 && <div className="center-board__kyotaku">供託 {round.kyotaku}本</div>}
        </div>
      </div>

      {/* 4人分の点数は全員同じ扱いにする：八角形の中に押し込めると窮屈になるため、
          全席とも八角形の外（河との間の余白）に離して配置する。 */}
      <div className="cluster-seat cluster-seat--top">
        <SeatBadge round={round} player={2} score={scores[2]} />
      </div>
      <div className="cluster-seat cluster-seat--bottom">
        <SeatBadge round={round} player={0} score={scores[0]} />
      </div>
      <div className="cluster-seat cluster-seat--left">
        <SeatBadge round={round} player={3} score={scores[3]} />
      </div>
      <div className="cluster-seat cluster-seat--right">
        <SeatBadge round={round} player={1} score={scores[1]} />
      </div>
    </>
  );
}
