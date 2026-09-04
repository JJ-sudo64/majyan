import { useEffect } from "react";
import type { RoundState, TileCode } from "@majyan/core";
import { canDeclareRon } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { useSettingsStore } from "../store/settingsStore.js";
import { TILE_FRONT_SRC, tileImageSrc } from "../tileGlyph.js";

/** じゃんたま同様、ポン/チー/カンのボタンには実際に鳴く牌の絵を出す
    （牌コードのテキスト表記は直感的に分かりにくいとの指摘のため）。
    ボタン(<button>)の中に置くため、クリック挙動を持つTileViewは使わず
    見た目だけの牌（クラスはTileViewと共通のtile/tile--tinyを流用）にする。 */
function CallTileFace({ code, red }: { code: TileCode; red: boolean }) {
  return (
    <span className="tile tile--tiny">
      <img className="tile__img tile__img--base" src={TILE_FRONT_SRC} alt="" draggable={false} />
      <img className="tile__img tile__img--face" src={tileImageSrc(code, red)} alt={code} draggable={false} />
    </span>
  );
}

const HUMAN = 0 as const;

export function CallPrompt({ round, active }: { round: RoundState; active: boolean }) {
  const options = useGameStore((s) => s.humanCallOptions);
  const humanCall = useGameStore((s) => s.humanCall);
  const humanSkip = useGameStore((s) => s.humanSkip);
  const autoWin = useSettingsStore((s) => s.autoWin);

  const window = active ? round.pendingCallWindow : null;
  const show = active && !!options && !!window;
  const canRon = show && options!.canRon;

  // 自動和了: ロンできる瞬間、ボタンを押さず即座にロンする（じゃんたま等の
  // 「自動和了」相当）。showがfalseになる条件分岐より前にHooksを呼ぶ必要が
  // あるため、早期returnの手前でこの位置に置く。
  useEffect(() => {
    if (autoWin && canRon) humanCall({ type: "ron", player: HUMAN });
  }, [autoWin, canRon, humanCall]);

  if (!show) return null;

  const analysis = options!.canRon ? canDeclareRon(round, HUMAN, window!.discardTile.code, window!.discarderIndex, window!.isChankan) : null;

  return (
    <div className="call-actions">
      {options!.canRon && (
        <button className="btn btn--ron" onClick={() => humanCall({ type: "ron", player: HUMAN })}>
          ロン {analysis && (analysis.isYakuman ? "(役満)" : `(${analysis.han}翻${analysis.fu}符)`)}
        </button>
      )}
      {options!.canPon && (
        <button
          className="btn btn--call btn--call-tiles"
          onClick={() => humanCall({ type: "pon", player: HUMAN, usedHandTileIds: options!.canPon!.usedHandTileIds })}
        >
          ポン
          <span className="btn--call-tiles__tiles">
            {options!.canPon.redFlags.map((red, j) => (
              <CallTileFace key={j} code={options!.canPon!.tileCode} red={red} />
            ))}
          </span>
        </button>
      )}
      {options!.canMinkan && (
        <button
          className="btn btn--call btn--call-tiles"
          onClick={() => humanCall({ type: "minkan", player: HUMAN, usedHandTileIds: options!.canMinkan!.usedHandTileIds })}
        >
          カン
          <span className="btn--call-tiles__tiles">
            {options!.canMinkan.redFlags.map((red, j) => (
              <CallTileFace key={j} code={options!.canMinkan!.tileCode} red={red} />
            ))}
          </span>
        </button>
      )}
      {options!.chiOptions.map((c, i) => (
        <button
          key={i}
          className="btn btn--call btn--call-tiles"
          onClick={() => humanCall({ type: "chi", player: HUMAN, tileCodes: c.tileCodes, usedHandTileIds: c.usedHandTileIds })}
        >
          チー
          <span className="btn--call-tiles__tiles">
            {c.tileCodes.map((code, j) => (
              <CallTileFace key={j} code={code} red={c.redFlags[j]!} />
            ))}
          </span>
        </button>
      ))}
      <button className="btn btn--skip" onClick={() => humanSkip()}>
        スキップ
      </button>
    </div>
  );
}
