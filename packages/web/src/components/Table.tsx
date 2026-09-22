import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { CHARACTERS, doraIndicators, nextTileForDora, type PlayerIndex, type TileCode } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";
import { useBackgroundDebugStore } from "../store/backgroundDebugStore.js";
import { tableBackgroundPath, useTableBackgroundStore } from "../store/tableBackgroundStore.js";
import { useRetrieveDiscardStore } from "../store/retrieveDiscardStore.js";
import { useGameSounds } from "../hooks/useGameSounds.js";
import { useBgm } from "../hooks/useBgm.js";
import { DoraProvider } from "../doraContext.js";
import { OpponentArea, getTableZoomRatio } from "./OpponentArea.js";
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
import { AnkanPreviewPanel } from "./AnkanPreviewPanel.js";
import { HandEditToolbar } from "./HandEditToolbar.js";
import { RiverEditToolbar } from "./RiverEditToolbar.js";
import { NameplateEditToolbar } from "./NameplateEditToolbar.js";
import { ToimenEditToolbar } from "./ToimenEditToolbar.js";
import { RiichiStickEditToolbar } from "./RiichiStickEditToolbar.js";
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
  // 暗槓表示確認モード（AnkanPreviewPanel.tsx参照）。
  const ankanPreviewPanelOpen = useTile3DDebugStore((s) => s.ankanPreviewPanelOpen);
  // 河・ネームプレートの配置編集モード（RiverEditToolbar/
  // NameplateEditToolbar.tsx参照）。座席ごとの位置・角度はriverSlots/
  // nameplateSlotsにpersistされ、編集モードOFF中もその値がそのまま
  // 表示に使われる（副露/手牌と同じ考え方）。
  const riverEditOpen = useTile3DDebugStore((s) => s.riverEditOpen);
  const riverEditActiveSeat = useTile3DDebugStore((s) => s.riverEditActiveSeat);
  const setRiverEditActiveSeat = useTile3DDebugStore((s) => s.setRiverEditActiveSeat);
  const riverSlots = useTile3DDebugStore((s) => s.riverSlots);
  const setRiverSlotStore = useTile3DDebugStore((s) => s.setRiverSlot);
  const nameplateEditOpen = useTile3DDebugStore((s) => s.nameplateEditOpen);
  const nameplateEditActiveSeat = useTile3DDebugStore((s) => s.nameplateEditActiveSeat);
  const setNameplateEditActiveSeat = useTile3DDebugStore((s) => s.setNameplateEditActiveSeat);
  const nameplateSlots = useTile3DDebugStore((s) => s.nameplateSlots);
  const setNameplateSlotStore = useTile3DDebugStore((s) => s.setNameplateSlot);
  // リーチ棒の配置編集モード（RiichiStickEditToolbar.tsx参照）。河・
  // ネームプレートと全く同じ考え方。
  const riichiStickEditOpen = useTile3DDebugStore((s) => s.riichiStickEditOpen);
  const riichiStickEditActiveSeat = useTile3DDebugStore((s) => s.riichiStickEditActiveSeat);
  const setRiichiStickEditActiveSeat = useTile3DDebugStore((s) => s.setRiichiStickEditActiveSeat);
  const riichiStickSlots = useTile3DDebugStore((s) => s.riichiStickSlots);
  const setRiichiStickSlotStore = useTile3DDebugStore((s) => s.setRiichiStickSlot);
  // 対面の手牌・副露の配置編集モード（ToimenEditToolbar.tsx参照）。
  // ドラッグそのものはOpponentArea.tsx側（対面自身のコンポーネント）で
  // 完結しており、Table.tsxはツールバーの開閉状態を読んでPortalするだけ。
  const toimenEditTarget = useTile3DDebugStore((s) => s.toimenEditTarget);
  // 河・ネームプレートいずれも「今どの座席をドラッグ中か」だけを覚えれば
  // 十分（同時に複数はドラッグできない）。ポインタが離れた要素からでも
  // 追従できるよう、pointermoveはdocument.body相当にせず各要素自身の
  // イベントで受け、setPointerCaptureで捕捉する（副露/手牌編集と同じ方式）。
  const riverDragRef = useRef<{ player: 0 | 1 | 2 | 3; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const nameplateDragRef = useRef<{ player: 0 | 1 | 2 | 3; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const riichiStickDragRef = useRef<{ player: 0 | 1 | 2 | 3; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const isPrimaryButtonDown = (e: ReactPointerEvent<HTMLElement>) => (e.buttons & 1) === 1;
  const handleRiverPointerDown = (player: 0 | 1 | 2 | 3) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setRiverEditActiveSeat(player);
    riverDragRef.current = { player, startX: e.clientX, startY: e.clientY, baseX: riverSlots[player].offsetX, baseY: riverSlots[player].offsetY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleRiverPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = riverDragRef.current;
    if (!drag) return;
    if (!isPrimaryButtonDown(e)) {
      riverDragRef.current = null;
      return;
    }
    const zoom = getTableZoomRatio(e.currentTarget);
    const dx = (e.clientX - drag.startX) / zoom;
    const dy = (e.clientY - drag.startY) / zoom;
    setRiverSlotStore(drag.player, { offsetX: Math.round(drag.baseX + dx), offsetY: Math.round(drag.baseY + dy) });
  };
  const handleRiverPointerUp = () => {
    riverDragRef.current = null;
  };
  const handleNameplatePointerDown = (player: 0 | 1 | 2 | 3) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setNameplateEditActiveSeat(player);
    nameplateDragRef.current = { player, startX: e.clientX, startY: e.clientY, baseX: nameplateSlots[player].offsetX, baseY: nameplateSlots[player].offsetY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleNameplatePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = nameplateDragRef.current;
    if (!drag) return;
    if (!isPrimaryButtonDown(e)) {
      nameplateDragRef.current = null;
      return;
    }
    // ネームプレートは.tableの外（.game-screen直下）にあり、.tableのzoom
    // (1.46)ではなくStageのレターボックス用zoomだけを受ける。祖先に
    // .tableを持たないためgetTableZoomRatioは使えず、DiscardPile.tsxと
    // 同じ.stage__canvas基準の比率をここで直接測る。
    const stageEl = document.querySelector<HTMLElement>(".stage__canvas");
    const zoom = stageEl && stageEl.offsetWidth > 0 ? stageEl.getBoundingClientRect().width / stageEl.offsetWidth : 1;
    const dx = (e.clientX - drag.startX) / zoom;
    const dy = (e.clientY - drag.startY) / zoom;
    setNameplateSlotStore(drag.player, { offsetX: Math.round(drag.baseX + dx), offsetY: Math.round(drag.baseY + dy) });
  };
  const handleNameplatePointerUp = () => {
    nameplateDragRef.current = null;
  };
  // リーチ棒は河と同じ.table-cluster内(.tableのzoom/3D傾きを継承する空間)
  // に置かれているため、河のドラッグ(handleRiverPointerMove)と同じく
  // getTableZoomRatioで画面px→ローカルpxへ変換する。
  const handleRiichiStickPointerDown = (player: 0 | 1 | 2 | 3) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setRiichiStickEditActiveSeat(player);
    riichiStickDragRef.current = {
      player,
      startX: e.clientX,
      startY: e.clientY,
      baseX: riichiStickSlots[player].offsetX,
      baseY: riichiStickSlots[player].offsetY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleRiichiStickPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = riichiStickDragRef.current;
    if (!drag) return;
    if (!isPrimaryButtonDown(e)) {
      riichiStickDragRef.current = null;
      return;
    }
    const zoom = getTableZoomRatio(e.currentTarget);
    const dx = (e.clientX - drag.startX) / zoom;
    const dy = (e.clientY - drag.startY) / zoom;
    setRiichiStickSlotStore(drag.player, { offsetX: Math.round(drag.baseX + dx), offsetY: Math.round(drag.baseY + dy) });
  };
  const handleRiichiStickPointerUp = () => {
    riichiStickDragRef.current = null;
  };
  // 編集モードを閉じた瞬間にドラッグ中だった場合の保険（副露/手牌編集と
  // 同じ理由。onPointerDownの発生時にしかriverEditOpen/nameplateEditOpen
  // を見ていないpointermove側だけでは、モードを閉じた直後の1回だけ古い
  // 値のまま動いてしまう可能性がある）。
  useEffect(() => {
    if (!riverEditOpen) riverDragRef.current = null;
  }, [riverEditOpen]);
  useEffect(() => {
    if (!nameplateEditOpen) nameplateDragRef.current = null;
  }, [nameplateEditOpen]);
  useEffect(() => {
    if (!riichiStickEditOpen) riichiStickDragRef.current = null;
  }, [riichiStickEditOpen]);
  // 河・ネームプレートのtransformは座席ごとにCSS側で既に固有の値
  // （河は3D傾き補正込み、ネームプレートは--left/--right限定のtranslateY）
  // を持っているため、inline styleでtransformを丸ごと上書きすると
  // それらが消えてしまう。角度調整だけをCSSカスタムプロパティ経由で
  // 末尾に追加してもらう方式にし、実際のtransform文字列の組み立ては
  // styles.css側（.table-cluster .river--*/.character-panel--*）に閉じる
  // （角度=0の時はrotate(0deg)でno-op、これまでの見た目に一切影響しない）。
  //
  // 位置オフセットはmargin経由で加算する（transformと違い、既存の3D補正
  // transformを一切崩さず済むため）。ただしmarginは「どちらの辺を基準に
  // 配置されているか」によって効く向きが変わる（例:
  // bottom指定の要素はmarginTopでは動かず、marginBottomを負の値で
  // 与える必要がある）。styles.cssの実際のtop/left/right/bottom指定
  // （.table-cluster .river--*/.character-panel--*参照）に合わせて
  // 座席ごとに正しいmarginプロパティを選ぶ。
  // 河: human(0)=bottom+left, right(1)=top+right, top(2)=top+left, left(3)=top+left
  const riverOffsetStyle = (player: 0 | 1 | 2 | 3): CSSProperties => {
    const slot = riverSlots[player];
    // scaleは後から追加したフィールド。HMR経由の再読み込み等でstoreの
    // migrateが走らず古い形のriverSlotsが残っているとundefinedになり
    // 得るため、RiverEditToolbar.tsxと同じく既定値(等倍)へフォールバックする。
    const style: Record<string, string | number> = { "--river-rotate": `${slot.rotate}deg`, "--river-scale": slot.scale ?? 1 };
    if (player === 1) style.marginRight = -slot.offsetX;
    else style.marginLeft = slot.offsetX;
    if (player === 0) style.marginBottom = -slot.offsetY;
    else style.marginTop = slot.offsetY;
    return style as CSSProperties;
  };
  // ネームプレート: top(2)=top+right, right(1)=top+right, left(3)=top+left, bottom(0)=top+left
  const nameplateOffsetStyle = (player: 0 | 1 | 2 | 3): CSSProperties => {
    const slot = nameplateSlots[player];
    const style: Record<string, string | number> = { "--nameplate-rotate": `${slot.rotate}deg`, marginTop: slot.offsetY };
    if (player === 1 || player === 2) style.marginRight = -slot.offsetX;
    else style.marginLeft = slot.offsetX;
    return style as CSSProperties;
  };
  // リーチ棒: 4座席とも共通してtop/left+translate(-50%,-50%)で中心寄せして
  // いる（河・ネームプレートと違い座席ごとに基準の辺がバラバラではない）
  // ため、marginではなくtransformにtranslate(offsetXpx, offsetYpx)を
  // 追加する方式で統一できる（styles.cssの.riichi-stick--*参照。
  // translate(-50%,-50%)の後に足すことで、要素自身の実寸に依存せず
  // 常に一定量だけ動かせる）。
  const riichiStickOffsetStyle = (player: 0 | 1 | 2 | 3): CSSProperties => {
    const slot = riichiStickSlots[player];
    return {
      "--riichi-offset-x": `${slot.offsetX}px`,
      "--riichi-offset-y": `${slot.offsetY}px`,
      "--riichi-rotate": `${slot.rotate}deg`,
    } as CSSProperties;
  };
  // CharacterPanelへ渡す配置編集用propsをまとめるヘルパー（4座席分の
  // JSXが冗長になるのを避ける）。編集モードOFF中はstyleだけ渡し
  // （persistされた位置は常に反映する）、ドラッグ用ハンドラは付けない。
  const nameplateEditProps = (player: 0 | 1 | 2 | 3) => ({
    style: nameplateOffsetStyle(player),
    editable: nameplateEditOpen,
    editActive: nameplateEditOpen && nameplateEditActiveSeat === player,
    onPointerDown: nameplateEditOpen ? handleNameplatePointerDown(player) : undefined,
    onPointerMove: nameplateEditOpen ? handleNameplatePointerMove : undefined,
    onPointerUp: nameplateEditOpen ? handleNameplatePointerUp : undefined,
    onPointerCancel: nameplateEditOpen ? handleNameplatePointerUp : undefined,
  });
  // 卓面背景画像(.table-surface)のサイズ・位置を実機で調整できるように
  // するためのCSS変数。BackgroundDebugPanel.tsx参照。
  const bgScale = useBackgroundDebugStore((s) => s.bgScale);
  const bgPosX = useBackgroundDebugStore((s) => s.bgPosX);
  const bgPosY = useBackgroundDebugStore((s) => s.bgPosY);
  const isBgPanelOpen = useBackgroundDebugStore((s) => s.isPanelOpen);
  const setIsBgPanelOpen = useBackgroundDebugStore((s) => s.setIsPanelOpen);
  // どの背景画像を使うか（複数の背景を切り替えられるようにするための
  // tableBackgroundStore.ts）。サイズ・位置(--bg-scale等)とは独立して
  // 管理し、画像自体はCSSカスタムプロパティとして注入する。
  const tableBackgroundId = useTableBackgroundStore((s) => s.backgroundId);
  const tableSurfaceStyle = {
    "--bg-scale": `${bgScale}%`,
    "--bg-pos-x": `${bgPosX}px`,
    "--bg-pos-y": `${bgPosY}px`,
    "--table-bg-image": `url("${tableBackgroundPath(tableBackgroundId)}")`,
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
        {ankanPreviewPanelOpen && createPortal(<AnkanPreviewPanel />, document.body)}
        {riverEditOpen && createPortal(<RiverEditToolbar />, document.body)}
        {nameplateEditOpen && createPortal(<NameplateEditToolbar />, document.body)}
        {riichiStickEditOpen && createPortal(<RiichiStickEditToolbar />, document.body)}
        {toimenEditTarget && createPortal(<ToimenEditToolbar />, document.body)}

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
                  <div
                    className={`river river--top${riverEditOpen ? ` river--editable${riverEditActiveSeat === 2 ? " river--editable-active" : ""}` : ""}`}
                    style={riverOffsetStyle(2)}
                    onPointerDown={riverEditOpen ? handleRiverPointerDown(2) : undefined}
                    onPointerMove={riverEditOpen ? handleRiverPointerMove : undefined}
                    onPointerUp={riverEditOpen ? handleRiverPointerUp : undefined}
                    onPointerCancel={riverEditOpen ? handleRiverPointerUp : undefined}
                  >
                    <DiscardPile discards={round.players[2].discards} direction="top" callTargetTileId={callTargetTileId} frozen={riverFrozen(2)} />
                  </div>
                  <div
                    className={`river river--left${riverEditOpen ? ` river--editable${riverEditActiveSeat === 3 ? " river--editable-active" : ""}` : ""}`}
                    style={riverOffsetStyle(3)}
                    onPointerDown={riverEditOpen ? handleRiverPointerDown(3) : undefined}
                    onPointerMove={riverEditOpen ? handleRiverPointerMove : undefined}
                    onPointerUp={riverEditOpen ? handleRiverPointerUp : undefined}
                    onPointerCancel={riverEditOpen ? handleRiverPointerUp : undefined}
                  >
                    <DiscardPile discards={round.players[3].discards} direction="left" callTargetTileId={callTargetTileId} frozen={riverFrozen(3)} />
                  </div>
                  <div
                    className={`river river--right${riverEditOpen ? ` river--editable${riverEditActiveSeat === 1 ? " river--editable-active" : ""}` : ""}`}
                    style={riverOffsetStyle(1)}
                    onPointerDown={riverEditOpen ? handleRiverPointerDown(1) : undefined}
                    onPointerMove={riverEditOpen ? handleRiverPointerMove : undefined}
                    onPointerUp={riverEditOpen ? handleRiverPointerUp : undefined}
                    onPointerCancel={riverEditOpen ? handleRiverPointerUp : undefined}
                  >
                    <DiscardPile discards={round.players[1].discards} direction="right" callTargetTileId={callTargetTileId} frozen={riverFrozen(1)} />
                  </div>
                  <div
                    className={`river river--human${riverEditOpen ? ` river--editable${riverEditActiveSeat === 0 ? " river--editable-active" : ""}` : ""}`}
                    style={riverOffsetStyle(0)}
                    onPointerDown={riverEditOpen ? handleRiverPointerDown(0) : undefined}
                    onPointerMove={riverEditOpen ? handleRiverPointerMove : undefined}
                    onPointerUp={riverEditOpen ? handleRiverPointerUp : undefined}
                    onPointerCancel={riverEditOpen ? handleRiverPointerUp : undefined}
                  >
                    <DiscardPile
                      discards={round.players[0].discards}
                      direction="human"
                      callTargetTileId={callTargetTileId}
                      frozen={riverFrozen(0)}
                      onTileClick={riverEditOpen ? undefined : humanRiverClickable ? selectRetrieveReclaimTile : undefined}
                      selectedTileId={retrieveReclaimTileId ?? undefined}
                    />
                  </div>
                  <CenterBoard round={round} scores={match.scores} />
                  {/* リーチ棒（1000点棒）。点数バッジ（外側）と中央の局情報
                      「東◯局」「残りN枚」（内側）の隙間に置く（位置の詳細は
                      styles.cssの.riichi-stick--*参照）。配置編集モード中は、
                      副露/手牌編集と同じ考え方で、選択中の座席がまだリーチ
                      していなくても「仮」のリーチ棒を表示し、実際にリーチ
                      するのを待たずに位置を調整できるようにする。 */}
                  {(
                    [
                      { player: 2 as const, cls: "top" },
                      { player: 3 as const, cls: "left" },
                      { player: 1 as const, cls: "right" },
                      { player: 0 as const, cls: "human" },
                    ]
                  ).map(({ player, cls }) => {
                    const isRiichi = round.players[player].riichi;
                    const isMock = riichiStickEditOpen && riichiStickEditActiveSeat === player && !isRiichi;
                    if (!isRiichi && !isMock) return null;
                    return (
                      <div
                        key={player}
                        className={`riichi-stick riichi-stick--${cls}${riverFrozen(player) ? " table__frozen" : ""}${isMock ? " riichi-stick--mock" : ""}${
                          riichiStickEditOpen ? ` riichi-stick--editable${riichiStickEditActiveSeat === player ? " riichi-stick--editable-active" : ""}` : ""
                        }`}
                        style={riichiStickOffsetStyle(player)}
                        onPointerDown={riichiStickEditOpen ? handleRiichiStickPointerDown(player) : undefined}
                        onPointerMove={riichiStickEditOpen ? handleRiichiStickPointerMove : undefined}
                        onPointerUp={riichiStickEditOpen ? handleRiichiStickPointerUp : undefined}
                        onPointerCancel={riichiStickEditOpen ? handleRiichiStickPointerUp : undefined}
                      />
                    );
                  })}
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
        <CharacterPanel round={round} player={2 as PlayerIndex} score={match.scores[2]} corner="top" {...nameplateEditProps(2)} />
        <CharacterPanel round={round} player={1 as PlayerIndex} score={match.scores[1]} corner="right" {...nameplateEditProps(1)} />
        <CharacterPanel round={round} player={3 as PlayerIndex} score={match.scores[3]} corner="left" {...nameplateEditProps(3)} />
        <CharacterPanel
          round={round}
          player={0 as PlayerIndex}
          score={match.scores[0]}
          corner="bottom"
          isSelf
          onShowSkillInfo={() => setShowOwnSkillInfo(true)}
          {...nameplateEditProps(0)}
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
