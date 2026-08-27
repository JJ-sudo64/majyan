import type { MatchFormat, RoundState } from "@majyan/core";
import { doraIndicators } from "@majyan/core";
import { TileView } from "./TileView.js";

const FORMAT_LABEL: Record<MatchFormat, string> = { tonpuusen: "東風戦", hanchan: "半荘戦" };

export function Hud({ round, format }: { round: RoundState; format: MatchFormat }) {
  const dora = doraIndicators(round.wall);

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
    </div>
  );
}
