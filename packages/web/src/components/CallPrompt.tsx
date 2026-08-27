import type { RoundState } from "@majyan/core";
import { canDeclareRon } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { tileLabel } from "../tileGlyph.js";

const HUMAN = 0 as const;

export function CallPrompt({ round, active }: { round: RoundState; active: boolean }) {
  const options = useGameStore((s) => s.humanCallOptions);
  const humanCall = useGameStore((s) => s.humanCall);
  const humanSkip = useGameStore((s) => s.humanSkip);

  const window = active ? round.pendingCallWindow : null;
  const show = active && !!options && !!window;
  if (!show) return null;

  const analysis = options!.canRon ? canDeclareRon(round, HUMAN, window!.discardTile.code, window!.isChankan) : null;

  return (
    <div className="call-actions">
      {options!.canRon && (
        <button className="btn btn--ron" onClick={() => humanCall({ type: "ron", player: HUMAN })}>
          ロン {analysis && (analysis.isYakuman ? "(役満)" : `(${analysis.han}翻${analysis.fu}符)`)}
        </button>
      )}
      {options!.canPon && (
        <button className="btn btn--call" onClick={() => humanCall({ type: "pon", player: HUMAN, usedHandTileIds: options!.canPon! })}>
          ポン
        </button>
      )}
      {options!.canMinkan && (
        <button className="btn btn--call" onClick={() => humanCall({ type: "minkan", player: HUMAN, usedHandTileIds: options!.canMinkan! })}>
          カン
        </button>
      )}
      {options!.chiOptions.map((c, i) => (
        <button
          key={i}
          className="btn btn--call"
          onClick={() => humanCall({ type: "chi", player: HUMAN, tileCodes: c.tileCodes, usedHandTileIds: c.usedHandTileIds })}
        >
          チー ({c.tileCodes.map(tileLabel).join(" ")})
        </button>
      ))}
      <button className="btn btn--skip" onClick={() => humanSkip()}>
        スキップ
      </button>
    </div>
  );
}
