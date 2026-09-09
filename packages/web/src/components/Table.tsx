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
import { CharacterPanel } from "./CharacterPanel.js";
import { Hud } from "./Hud.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { DebugPanel } from "./DebugPanel.js";
import { SkillActivationOverlay } from "./SkillActivationOverlay.js";

/**
 * 画面全体のレイヤー構造（View再設計）:
 *
 *   .game-screen（画面全体）
 *   ├─ .game-background（部屋の背景。AI生成素材に差し替え可能なプレースホルダー）
 *   ├─ .table（麻雀卓そのもの。河・手牌・中央局面のみを内包する）
 *   ├─ .character-panel × 4（卓の外に独立した、座席ごとのキャラクター
 *   │    パネル。以前はOpponentArea/Hand内部のネームプレートが河・手牌と
 *   │    同じ箱の中で高さ/クリック優先度を奪い合っていたが、卓の外の
 *   │    独立レイヤーにすることでその競合そのものを解消する）
 *   ├─ .hud / デバッグパネル
 *   └─ 全画面演出レイヤー（必殺技カットイン・局終了結果・自キャラ確認）
 *
 * ゲームロジック（packages/core、gameStore.ts）は一切変更していない。
 */
export function Table() {
  const match = useGameStore((s) => s.match);
  const pendingRoundEnd = useGameStore((s) => s.pendingRoundEnd);
  const lastRoundOutcome = useGameStore((s) => s.lastRoundOutcome);
  useGameSounds(match?.round);
  useBgm(match?.round);

  // 対局中に自キャラの必殺技を確認するポップアップ。画面全体を覆う
  // 演出レイヤー側（.game-screen直下）に置き、確実に画面内に収まるようにする。
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

  const selfCharacter = CHARACTERS[round.characterIds[0]];

  return (
    <DoraProvider doraCodes={doraCodes}>
      <div className="game-screen">
        <div className="game-background" />
        {/* HUD(ドラ表示等)は.tableの内側(zoom:1.46+top:52.9%で拡大・下方に
            ずらされた座標系)に置くと、top:12px/left:12pxのような小さな
            絶対配置が画面の実際の左上ではなく卓の論理座標上の左上を指す
            ことになり、結果として画面の外（見えない位置）に出てしまって
            いた。.game-screen直下（拡大・オフセットされていない実座標）に
            移すことで、常に画面の実際の左上付近に表示されるようにする。 */}
        <Hud round={round} format={match.format} />
        <SettingsPanel />
        {/* DebugPanelもHud等と同じ理由（.tableはzoom:1.46+top:52.9%で
            拡大・中央配置されており、game-screenの実表示領域を縦に大きく
            はみ出す）で、.table内部に置くと画面の外（見えない位置）に
            出てしまっていた。同じく.game-screen直下へ移す。 */}
        <DebugPanel />

        <div className="table">
          {/* Step3/Phase C-2: 卓面（フェルト+木枠）と「ゲーム内容」を
              同一の3Dツリーに統合する。.game-content-planeがperspectiveを、
              その子.game-content-plane__innerがtransform-style:preserve-3d
              +rotateXを担当する（1要素に両方載せるとperspectiveが効かない
              ことをサンドボックスで確認済みのため2段構成にしている）。
              以前は卓面(.table-surface-stage)を兄弟要素として別ツリーに
              分離していたが、2つの箱のサイズを常に一致させ続ける必要が
              あり実測でズレが繰り返し発覚したため廃止し、.table-surfaceを
              この中の最初の子要素として統合した（同じ3D空間にあることが
              構造上保証される）。内側は.table本来のgrid（260px/1fr/260px列、
              auto/1fr/auto行）をそのまま再現しているだけなので、対面・
              上家・下家・自分の各要素の座標計算（position:absoluteの
              top/left/right/bottom含む）は一切変更していない。 */}
          <div className="game-content-plane">
            <div className="game-content-plane__inner">
              <div className="table-surface">
                <div className="table-surface__frame" />
                <div className="table-surface__felt" />
              </div>
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
                  {/* リーチ棒（1000点棒）。点数バッジ（外側）と中央の局情報
                      「東◯局」「残りN枚」（内側）の隙間に置く（位置の詳細は
                      styles.cssの.riichi-stick--*参照）。 */}
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
                <Hand round={round} />
              </div>
            </div>
          </div>
        </div>

        {/* キャラクターレイヤー: 卓の外に独立した4枚のパネル。河・手牌の
            伸縮とは一切連動しない固定位置のため、以前のようなクリック
            優先度の奪い合いが起きない。 */}
        <CharacterPanel round={round} player={2 as PlayerIndex} score={match.scores[2]} corner="top" />
        <CharacterPanel round={round} player={1 as PlayerIndex} score={match.scores[1]} corner="right" />
        <CharacterPanel round={round} player={3 as PlayerIndex} score={match.scores[3]} corner="left" />
        <CharacterPanel
          round={round}
          player={0 as PlayerIndex}
          score={match.scores[0]}
          corner="bottom"
          isSelf
          onShowSkillInfo={() => setShowOwnSkillInfo(true)}
        />

        {/* 全画面演出レイヤー。卓・キャラパネルのレイアウトが今後変わっても
            （斜め視点化を含め）このレイヤーは独立して流用できる。 */}
        <SkillActivationOverlay round={round} />

        {showOwnSkillInfo && selfCharacter && (
          <div className="modal-overlay" onClick={() => setShowOwnSkillInfo(false)}>
            <div className="skill-info-card" onClick={(e) => e.stopPropagation()}>
              <img className="skill-info-card__avatar" src={selfCharacter.avatar} alt="" />
              <div className="skill-info-card__name">{selfCharacter.name}</div>
              <div className="skill-info-card__skill">
                必殺技「{selfCharacter.skill.name}」: {selfCharacter.skill.description}
              </div>
              <button className="btn btn--primary" onClick={() => setShowOwnSkillInfo(false)}>
                閉じる
              </button>
            </div>
          </div>
        )}

        {pendingRoundEnd && lastRoundOutcome && <ScoreResult round={round} outcome={lastRoundOutcome} />}
      </div>
    </DoraProvider>
  );
}
