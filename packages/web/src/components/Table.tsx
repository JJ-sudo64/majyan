import { useMemo, useState } from "react";
import { CHARACTERS, doraIndicators, nextTileForDora, type PlayerIndex, type TileCode } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { useRetrieveDiscardStore } from "../store/retrieveDiscardStore.js";
import { useGameSounds } from "../hooks/useGameSounds.js";
import { useBgm } from "../hooks/useBgm.js";
import { DoraProvider } from "../doraContext.js";
import { OpponentArea } from "./OpponentArea.js";
import { Hand } from "./Hand.js";
import { DiscardPile } from "./DiscardPile.js";
import { ScoreResult } from "./ScoreResult.js";
import { CenterBoard } from "./CenterBoard.js";
import { Hud } from "./Hud.js";
import { DebugPanel } from "./DebugPanel.js";
import { SkillActivationOverlay } from "./SkillActivationOverlay.js";

export function Table() {
  const match = useGameStore((s) => s.match);
  const pendingRoundEnd = useGameStore((s) => s.pendingRoundEnd);
  const lastRoundOutcome = useGameStore((s) => s.lastRoundOutcome);
  useGameSounds(match?.round);
  useBgm(match?.round);

  // 対局中に自キャラの必殺技を確認するポップアップ。Hand.tsx内の小さい
  // position:absoluteの箱（.hand-left-status）にモーダルを置くと、
  // inset:0の基準がその小さい箱になってしまい下側が見切れて閉じるボタン
  // にも届かない不具合になっていた。ScoreResultと同じく.table直下
  // （卓全体＝.tableのposition:relative基準）に置き、確実に画面内に
  // 収まるようにする。
  const [showOwnSkillInfo, setShowOwnSkillInfo] = useState(false);

  // ドラ表示牌そのものではなく「実際にドラとして数えられる牌」の集合。
  // TileView側でこの集合に含まれる牌を点滅させ、どれがドラか一目で
  // わかるようにする。
  const doraCodes = useMemo<ReadonlySet<TileCode>>(() => {
    if (!match) return new Set();
    return new Set(doraIndicators(match.round.wall).map(nextTileForDora));
  }, [match]);

  if (!match) return null;
  const round = match.round;

  // ロン/チー/ポン/カンの対象がどの牌か一目でわかるよう、河の中の該当牌を
  // 光らせる（じゃんたま同様）。加槓に対する槍槓（isChankan）は河ではなく
  // 既存の副露の牌が対象になるため、河側のハイライトはここでは対象外。
  const callTargetTileId =
    round.phase === "awaiting-calls" && round.pendingCallWindow && !round.pendingCallWindow.isChankan
      ? round.pendingCallWindow.discardTile.id
      : undefined;

  // 必殺技「時間停止」発動中は、発動者本人の河以外をグレーアウトする
  // （OpponentArea.tsx/Hand.tsxが自分自身の手牌・副露側は自前で判定する
  // ため、ここでは河ぶんだけ座席ごとに渡す）。
  const timeStopSource = ([0, 1, 2, 3] as PlayerIndex[]).find((seat) => round.players[seat].timeStopTurnsRemaining > 0);
  const riverFrozen = (seat: PlayerIndex) => timeStopSource !== undefined && seat !== timeStopSource;

  // ミオの必殺技「取り返し」選択中: 自分の河から取り返す1枚を選ぶ段階
  // （reclaimTileIdがまだnull）の間だけ、自分の河をクリック可能にする。
  const retrieveActive = useRetrieveDiscardStore((s) => s.active);
  const retrieveReclaimTileId = useRetrieveDiscardStore((s) => s.reclaimTileId);
  const selectRetrieveReclaimTile = useRetrieveDiscardStore((s) => s.selectReclaimTile);
  const humanRiverClickable = retrieveActive && !retrieveReclaimTileId;

  return (
    <DoraProvider doraCodes={doraCodes}>
      <div className="table">
        <div className="table__felt" />
        <Hud round={round} format={match.format} />
        <DebugPanel />

        <div className="table__center">
          <div className="table-cluster">
            <div className="river river--top">
              <DiscardPile discards={round.players[2].discards} direction="top" callTargetTileId={callTargetTileId} frozen={riverFrozen(2)} />
            </div>
            <div className="river river--left">
              <DiscardPile discards={round.players[3].discards} direction="left" callTargetTileId={callTargetTileId} frozen={riverFrozen(3)} />
            </div>
            <div className="river river--right">
              <DiscardPile discards={round.players[1].discards} direction="right" callTargetTileId={callTargetTileId} frozen={riverFrozen(1)} />
            </div>
            <div className="river river--human">
              <DiscardPile
                discards={round.players[0].discards}
                direction="human"
                callTargetTileId={callTargetTileId}
                frozen={riverFrozen(0)}
                onTileClick={humanRiverClickable ? selectRetrieveReclaimTile : undefined}
                selectedTileId={retrieveReclaimTileId ?? undefined}
              />
            </div>
            <CenterBoard round={round} scores={match.scores} />
            {/* リーチ棒（1000点棒）。実際の卓と同じく、リーチした本人の河と
                中央スコアボードの間（ここでは40px強の隙間がある）に置く。 */}
            {round.players[2].riichi && <div className={`riichi-stick riichi-stick--top${riverFrozen(2) ? " table__frozen" : ""}`} />}
            {round.players[3].riichi && <div className={`riichi-stick riichi-stick--left${riverFrozen(3) ? " table__frozen" : ""}`} />}
            {round.players[1].riichi && <div className={`riichi-stick riichi-stick--right${riverFrozen(1) ? " table__frozen" : ""}`} />}
            {round.players[0].riichi && <div className={`riichi-stick riichi-stick--human${riverFrozen(0) ? " table__frozen" : ""}`} />}
          </div>
        </div>

        <OpponentArea round={round} player={2 as PlayerIndex} />
        <OpponentArea round={round} player={1 as PlayerIndex} />
        <OpponentArea round={round} player={3 as PlayerIndex} />

        <div className="human-area">
          <Hand round={round} onShowSkillInfo={() => setShowOwnSkillInfo(true)} />
        </div>

        <SkillActivationOverlay round={round} />

        {showOwnSkillInfo &&
          (() => {
            const character = CHARACTERS[round.characterIds[0]];
            if (!character) return null;
            return (
              <div className="modal-overlay" onClick={() => setShowOwnSkillInfo(false)}>
                <div className="skill-info-card" onClick={(e) => e.stopPropagation()}>
                  <img className="skill-info-card__avatar" src={character.avatar} alt="" />
                  <div className="skill-info-card__name">{character.name}</div>
                  <div className="skill-info-card__skill">
                    必殺技「{character.skill.name}」: {character.skill.description}
                  </div>
                  <button className="btn btn--primary" onClick={() => setShowOwnSkillInfo(false)}>
                    閉じる
                  </button>
                </div>
              </div>
            );
          })()}

        {pendingRoundEnd && lastRoundOutcome && <ScoreResult round={round} outcome={lastRoundOutcome} />}
      </div>
    </DoraProvider>
  );
}
