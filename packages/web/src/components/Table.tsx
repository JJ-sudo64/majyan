import { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CHARACTERS, doraIndicators, nextTileForDora, type PlayerIndex, type TileCode } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";
import { useBackgroundDebugStore } from "../store/backgroundDebugStore.js";
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
import { Tile3DDebugPanel } from "./Tile3DDebugPanel.js";
import { BackgroundDebugPanel } from "./BackgroundDebugPanel.js";
import { MeldEditToolbar } from "./MeldEditToolbar.js";
import { HandEditToolbar } from "./HandEditToolbar.js";
import { SkillActivationOverlay } from "./SkillActivationOverlay.js";

/**
 * 画面全体のレイヤー構造（View再設計）:
 *
 *   .game-screen（画面全体）
 *   ├─ .game-background（部屋の背景。AI生成素材に差し替え可能なプレースホルダー）
 *   ├─ .table-surface（卓面画像。.tableのzoom/3D傾き演出の影響を受けない
 *   │    よう.game-screen直下に置く。詳細は下のJSX内コメント参照）
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
  // 下家(player 1)・上家(player 3)の立体牌(Tile3D)手牌を描画するPortal先。
  // .tableの外（祖先にperspective/rotateXを持たない.game-screen直下）に
  // 置くことで、3D形状のTile3Dが「傾いた卓」演出の影響でシアー変形する
  // 問題を回避する（詳細はstyles.cssの.tile3d-hand-layerコメント、
  // OpponentArea.tsx参照）。stateにしているのは、createPortalに渡すDOM
  // 要素の参照がマウント後でないと取れないため。
  const [tile3dLayer1, setTile3dLayer1] = useState<HTMLDivElement | null>(null);
  const [tile3dLayer3, setTile3dLayer3] = useState<HTMLDivElement | null>(null);
  // どちらの調整パネル（下家/上家）を開いているか。SettingsPanelの
  // 「下家の調整」「上家の調整」から開き、パネル自身の閉じるボタンで
  // nullに戻す。
  const activePanel = useTile3DDebugStore((s) => s.activePanel);
  const setActivePanel = useTile3DDebugStore((s) => s.setActivePanel);
  // 副露配置編集モード（MeldEditToolbar.tsx参照）。nullでなければ実際の
  // 卓上でその座席の副露をドラッグできる。
  const meldEditSeat = useTile3DDebugStore((s) => s.meldEditSeat);
  // 手牌配置編集モード（HandEditToolbar.tsx参照）。nullでなければ実際の
  // 卓上でその座席の手牌の塊をドラッグできる。
  const handEditSeat = useTile3DDebugStore((s) => s.handEditSeat);
  // 卓面背景画像(.table-surface)のサイズ・位置を実機で調整できるように
  // するためのCSS変数。BackgroundDebugPanel.tsx参照。
  const bgScale = useBackgroundDebugStore((s) => s.bgScale);
  const bgPosX = useBackgroundDebugStore((s) => s.bgPosX);
  const bgPosY = useBackgroundDebugStore((s) => s.bgPosY);
  const isBgPanelOpen = useBackgroundDebugStore((s) => s.isPanelOpen);
  const setIsBgPanelOpen = useBackgroundDebugStore((s) => s.setIsPanelOpen);
  const tableSurfaceStyle = {
    "--bg-scale": `${bgScale}%`,
    "--bg-pos-x": `${bgPosX}px`,
    "--bg-pos-y": `${bgPosY}px`,
  } as CSSProperties;
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
        {/* 卓面背景画像(.table-surface)は.tableの外、.game-screen直下に置く。
            .tableはzoom:1.46+grid内部座標という「実際の画面座標とは異なる
            拡大・オフセットされた座標系」を持つ（Hud/DebugPanel等が
            同じ理由で.game-screen直下へ避難しているのと同じ問題）。
            .game-content-plane(.tableのcontent領域全体)の実測box は
            zoom(1.46)×Stageのレターボックス倍率が掛かって画面より
            大幅に大きく・中心もずれた座標になり、そこにinset:0で背景
            画像を敷くと、原画の外周（今回のユーザー提供画像では両端の
            木枠）が実際の画面の外に出てしまい、常に見えない状態になる
            （指摘「木枠が極端に斜め」の後に実測で発覚。3D傾き演出内に
            置いていた時は逆にperspectiveの歪みでたまたま画面内に収まって
            見えていただけで、原画に忠実ではなかった）。
            .game-screen自体は3D変形もzoomも持たない「本物の画面座標」
            そのものなので、ここにinset:0で敷けば原画をそのままの縦横比・
            歪みなしで画面全体に正しく表示できる。 */}
        <div className="table-surface" style={tableSurfaceStyle}>
          <div className="table-surface__frame" />
          <div className="table-surface__felt" />
        </div>
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
        {/* 以前は常時左下に固定表示していたが、左側だと上家の手牌が
            隠れる・スライダーが多く画面の邪魔になるとの指摘のため、
            SettingsPanelの歯車メニューから開くモーダルに変更した
            （styles.cssの.tile3d-debug-overlay参照、画面中央付近に
            オーバーレイ表示、卓の内容を覆わない位置に配置）。
            document.body直下へPortalしているのは、.tile3d-hand-layer
            (z-index:20、同じくbody直下)より確実に手前に表示するため
            ——.game-screen内のスタッキングコンテキストに留めたままだと、
            z-indexをどれだけ上げてもbody直下にある.tile3d-hand-layerの
            奥に隠れてしまう。 */}
        {activePanel &&
          createPortal(
            <Tile3DDebugPanel
              player={activePanel === "kamicha" ? (3 as PlayerIndex) : (1 as PlayerIndex)}
              onClose={() => setActivePanel(null)}
            />,
            document.body,
          )}
        {/* 卓面背景画像（.table-surface）のサイズ・位置調整パネル。
            Tile3DDebugPanelと同じ理由でdocument.body直下へPortalし、
            同じモーダルスタイル(.tile3d-debug-overlay)を共有する。 */}
        {isBgPanelOpen && createPortal(<BackgroundDebugPanel onClose={() => setIsBgPanelOpen(false)} />, document.body)}
        {/* 副露配置編集モードのツールバー。Tile3DDebugPanel等と違い卓を
            暗転させない小さなバーで、卓を見ながら操作できる（.meld--
            editableのハイライトは.tile3d-hand-layerと同じ問題を持たない
            ——.meldは.opponent-area内、.tile3d-hand-layerとは別の要素）。
            document.body直下へPortalする理由はTile3DDebugPanelと同じ
            （.tile3d-hand-layerより手前に表示する必要があるため）。 */}
        {meldEditSeat && createPortal(<MeldEditToolbar />, document.body)}
        {handEditSeat && createPortal(<HandEditToolbar />, document.body)}

        <div className="table">
          {/* Step3/Phase C-2: 卓面（フェルト+木枠）と「ゲーム内容」を
              同一の3Dツリーに統合する。.game-content-planeがperspectiveを、
              その子.game-content-plane__innerがtransform-style:preserve-3d
              +rotateXを担当する（1要素に両方載せるとperspectiveが効かない
              ことをサンドボックスで確認済みのため2段構成にしている）。
              内側は.table本来のgrid（260px/1fr/260px列、auto/1fr/auto行）を
              そのまま再現しているだけなので、対面・上家・下家・自分の各
              要素の座標計算（position:absoluteのtop/left/right/bottom含む）
              は一切変更していない。 */}
          <div className="game-content-plane">
            <div className="game-content-plane__inner">
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
              <OpponentArea round={round} player={1 as PlayerIndex} tile3dPortalTarget={tile3dLayer1} />
              <OpponentArea round={round} player={3 as PlayerIndex} tile3dPortalTarget={tile3dLayer3} />

              <div className="human-area">
                <Hand round={round} />
              </div>
            </div>
          </div>
        </div>
        {/* 下家・上家のTile3D立体牌のPortal先。position:fixedで実際の画面
            座標に追従させる（OpponentArea.tsx側で各OpponentAreaの
            .opponent-hand-backの実際の画面位置を継続的に実測して反映する）
            ため、document.body直下へさらにPortalする——CSSのzoom
            （.stage__canvasが持つ、Stage.tsxのレターボックス用の拡大率）は、
            Chromiumではposition:fixedの子要素にとって新しいcontaining
            blockを形成してしまい、fixedがviewportではなくその祖先基準に
            なってしまう（実測で確認済み: 設定したtop/leftと実際の描画
            位置が大きく食い違っていた）。document.bodyにはzoom等の
            containing-block化要素が一切ないため、ここに置けば
            position:fixedが素直にviewport基準になる（styles.cssの
            .tile3d-hand-layerコメント参照）。 */}
        {createPortal(<div className="tile3d-hand-layer" ref={setTile3dLayer1} />, document.body)}
        {createPortal(<div className="tile3d-hand-layer" ref={setTile3dLayer3} />, document.body)}

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
            （斜め視点化を含め）このレイヤーは独立して流用できる。
            以前は.game-screen直下にそのまま置いていたが、これは.table等と
            同じスタッキングコンテキストに留まるため、CSS側でz-index:20を
            指定していても、document.body直下に別途Portalされている
            .tile3d-hand-layer（同じくz-index:20、Tile3D手牌）とは
            そもそも比較対象にならず、常に手牌の下に隠れてしまっていた
            （指摘により発覚。Tile3DDebugPanel等と同じ理由でPortal化して
            解決する）。 */}
        {createPortal(<SkillActivationOverlay round={round} />, document.body)}

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
