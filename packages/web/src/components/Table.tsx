import { useMemo } from "react";
import { doraIndicators, nextTileForDora, type PlayerIndex, type TileCode } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { useGameSounds } from "../hooks/useGameSounds.js";
import { DoraProvider } from "../doraContext.js";
import { OpponentArea } from "./OpponentArea.js";
import { Hand } from "./Hand.js";
import { DiscardPile } from "./DiscardPile.js";
import { ScoreResult } from "./ScoreResult.js";
import { CenterBoard } from "./CenterBoard.js";
import { Hud } from "./Hud.js";
import { DebugPanel } from "./DebugPanel.js";

export function Table() {
  const match = useGameStore((s) => s.match);
  const pendingRoundEnd = useGameStore((s) => s.pendingRoundEnd);
  const lastRoundOutcome = useGameStore((s) => s.lastRoundOutcome);
  useGameSounds(match?.round);

  // ドラ表示牌そのものではなく「実際にドラとして数えられる牌」の集合。
  // TileView側でこの集合に含まれる牌を点滅させ、どれがドラか一目で
  // わかるようにする。
  const doraCodes = useMemo<ReadonlySet<TileCode>>(() => {
    if (!match) return new Set();
    return new Set(doraIndicators(match.round.wall).map(nextTileForDora));
  }, [match]);

  if (!match) return null;
  const round = match.round;

  return (
    <DoraProvider doraCodes={doraCodes}>
      <div className="table">
        <div className="table__felt" />
        <Hud round={round} format={match.format} />
        <DebugPanel />

        <div className="table__center">
          <div className="table-cluster">
            <div className="river river--top">
              <DiscardPile discards={round.players[2].discards} direction="top" />
            </div>
            <div className="river river--left">
              <DiscardPile discards={round.players[3].discards} direction="left" />
            </div>
            <div className="river river--right">
              <DiscardPile discards={round.players[1].discards} direction="right" />
            </div>
            <div className="river river--human">
              <DiscardPile discards={round.players[0].discards} direction="human" />
            </div>
            <CenterBoard round={round} scores={match.scores} />
          </div>
        </div>

        <OpponentArea round={round} player={2 as PlayerIndex} />
        <OpponentArea round={round} player={1 as PlayerIndex} />
        <OpponentArea round={round} player={3 as PlayerIndex} />

        <div className="human-area">
          <Hand round={round} />
        </div>

        {pendingRoundEnd && lastRoundOutcome && <ScoreResult round={round} outcome={lastRoundOutcome} />}
      </div>
    </DoraProvider>
  );
}
