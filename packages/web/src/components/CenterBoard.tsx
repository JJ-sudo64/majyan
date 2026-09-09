import { useEffect, useRef, useState } from "react";
import type { PlayerIndex, RoundState } from "@majyan/core";
import { WIND_NAMES } from "@majyan/core";
import { SeatBadge } from "./SeatBadge.js";
import { useGameStore } from "../store/gameStore.js";

/** カード「点棒吸収」等の即時点数増減演出を表示しておく時間。 */
const SCORE_ADJUSTMENT_DISPLAY_MS = 1800;

function ScoreDeltaPop({ delta }: { delta: number }) {
  if (delta === 0) return null;
  return (
    <div className={`score-delta-pop${delta > 0 ? " score-delta-pop--gain" : " score-delta-pop--loss"}`}>
      {delta > 0 ? `+${delta}` : delta}
    </div>
  );
}

export function CenterBoard({ round, scores }: { round: RoundState; scores: [number, number, number, number] }) {
  // 必殺技「時間停止」発動中は発動者の手牌・河・副露以外の画面全体をグレー
  // アウトする演出の一部。中央の点数表示・局情報は誰の持ち物でもないため、
  // 発動中は誰が発動者かに関わらず一律でグレーアウトする。
  const frozen = round.players.some((p) => p.timeStopTurnsRemaining > 0);
  const frozenClass = frozen ? " table__frozen" : "";

  // カード「点棒吸収」等、RoundState側から即座の点数増減が起きた瞬間だけ
  // 「吸収した」演出を出す。gameStore.tsのlastScoreAdjustment.keyが増える
  // たびに（＝実際に増減が発生するたびに）一時的にactiveDeltaを立て、
  // 一定時間後に自動で消す（SkillActivationOverlay.tsxと同じ「keyの差分で
  // 一発イベントを検知する」パターン）。
  const lastScoreAdjustment = useGameStore((s) => s.lastScoreAdjustment);
  const prevKeyRef = useRef(lastScoreAdjustment?.key ?? 0);
  const [activeDelta, setActiveDelta] = useState<[number, number, number, number] | null>(null);
  useEffect(() => {
    const prevKey = prevKeyRef.current;
    const key = lastScoreAdjustment?.key ?? 0;
    prevKeyRef.current = key;
    if (!lastScoreAdjustment || key === prevKey) return undefined;
    setActiveDelta(lastScoreAdjustment.delta);
    const timer = setTimeout(() => setActiveDelta(null), SCORE_ADJUSTMENT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [lastScoreAdjustment]);
  const deltaFor = (player: PlayerIndex) => activeDelta?.[player] ?? 0;

  return (
    <div className={`center-board${frozenClass}`}>
      <div className="center-board__round">
        {WIND_NAMES[round.roundWind]}
        {round.roundNumber}局
      </div>
      {/* 供託表示はHUD左上（Hud.tsx、本場と並べて常時表示）に統合したため、
          ここでの重複表示は廃止した。 */}
      <div className="center-board__wall-group">
        <div className="center-board__wall">残り {round.wall.liveTiles.length}枚</div>
      </div>
      {activeDelta && <div className="center-board__absorb-banner">点棒吸収！</div>}

      {/* 参考画像を丸ごと切り出した中央パネル(center-cluster.png)には、
          中央の局情報2段に加えて上下左右4方向の枠がすでに絵として
          含まれている。4人分の点数はその4つの枠の位置（実測した%座標）に
          重ねて表示する。以前のように河との間に別枠として離して置く
          のではなく、この1枚の画像の中に収める。 */}
      <div className={`center-board__seat center-board__seat--top${frozenClass}`}>
        <SeatBadge round={round} player={2} score={scores[2]} />
        <ScoreDeltaPop delta={deltaFor(2)} />
      </div>
      <div className={`center-board__seat center-board__seat--bottom${frozenClass}`}>
        <SeatBadge round={round} player={0} score={scores[0]} />
        <ScoreDeltaPop delta={deltaFor(0)} />
      </div>
      <div className={`center-board__seat center-board__seat--left${frozenClass}`}>
        <SeatBadge round={round} player={3} score={scores[3]} />
        <ScoreDeltaPop delta={deltaFor(3)} />
      </div>
      <div className={`center-board__seat center-board__seat--right${frozenClass}`}>
        <SeatBadge round={round} player={1} score={scores[1]} />
        <ScoreDeltaPop delta={deltaFor(1)} />
      </div>
    </div>
  );
}
