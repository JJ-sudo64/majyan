import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Meld, PlayerIndex, RoundState, Tile, TileCode } from "@majyan/core";
import { meldDisplaySlots } from "../meldDisplay.js";
import { TileView } from "./TileView.js";
import { Tile3D } from "./Tile3D.js";
import { HAND_GROUP_SLOT_COUNT, MELD_SLOT_COUNT, useTile3DDebugStore, usePlayerTile3DParam } from "../store/tile3dDebugStore.js";
import { useSettingsStore } from "../store/settingsStore.js";
import type { MeldSlotConfig } from "../store/tile3dDebugStore.js";

/** 副露どうしの「自然な(手で動かす前の)」間隔(px)。実際の副露の実寸
    (種類によって3〜4枚で幅が変わる)には依存しない固定値——固定値にする
    ことで、副露の個数や種類が変わっても既に置いた副露の自然位置が
    絶対にズレない（後述のtransform-originを使った固定端アンカーと
    組み合わせて実現）。 */
const MELD_NATURAL_STEP = 30;
// 上家(--3)と下家(--1)は見た目こそ左右対称だが、.opponent-hand-rowの
// 実際の高さ・画面上の絶対位置は非対称（実測: 下家側の行は高さ708px・
// 画面y=24開始、上家側は高さ624px・画面y=210開始——卓の3D傾き演出との
// 組み合わせで、同じCSSでも座席ごとに異なる射影結果になる）。
// 下家(shimocha)は元々ユーザー確認済みの位置で問題が無いため一切触れない
// （補正0）。上家(kamicha)だけ、.opponent-hand-rowの実際の高さ・画面上の
// 絶対位置が下家と非対称なため、同じ式では副露が実際に見える範囲
// (.stage、overflow:hiddenの本当の可視領域)の外に出てしまう不具合が
// 実機で発覚した（指摘により判明）。上家側だけこの分を差し引く。
const KAMICHA_MELDS_ANCHOR_CORRECTION = -395;

/** 副露配置編集モードで、実際の副露がまだ足りない時に卓上へ仮で表示する
    ダミーの副露（見た目確認・ドラッグ操作用、対局の実データには一切
    影響しない）。孤立したidを使い、実データのidと衝突しないようにする。 */
function makeMockMeld(index: number): Meld {
  const tile = (i: number): Tile => ({ id: `mock-meld-${index}-${i}`, code: "5p", isRed: false });
  return { type: "pon", tiles: [tile(0), tile(1), tile(2)], calledFromRelative: 1, calledTile: tile(0) };
}

/** .table祖先のzoom（Stageのレターボックスscaleと.tableのCSS zoom:1.46を
    合成した「画面px÷ローカルpx」の倍率）。Tile3D側のPortal同期(sync())と
    全く同じ考え方で、ドラッグ量(画面px)を副露のoffsetX/Y(ローカルpx)に
    正しく変換するために必要。 */
function getTableZoomRatio(el: HTMLElement): number {
  const tableEl = el.closest(".table") as HTMLElement | null;
  return tableEl && tableEl.offsetWidth > 0 ? tableEl.getBoundingClientRect().width / tableEl.offsetWidth : 1;
}

/** 副露(.meld)の直接の親(.opponent-melds__inner)がrotate(-90deg)(下家)/
    rotate(90deg)(上家)されているため、.meld自身のtransform: translate()に
    渡すoffsetX/Yのローカル座標系は、画面上の左右/上下とは90度ズレている
    （実際にCSSのrotate(θ)を掛けて検証済み: 下家はlocal(x,y)→screen(y,-x)、
    上家はlocal(x,y)→screen(-y,x)になる）。ここではその逆変換を行い、
    画面上でマウスを動かした方向(screenDX/DY)がそのまま画面上で見た目通り
    動くようにoffsetX/Y側のデルタへ変換する。 */
function screenDeltaToMeldLocal(screenDX: number, screenDY: number, player: PlayerIndex): { dx: number; dy: number } {
  if (player === 1) return { dx: -screenDY, dy: screenDX };
  if (player === 3) return { dx: screenDY, dy: -screenDX };
  return { dx: screenDX, dy: screenDY };
}

// 下家・上家の手牌（副露・河は対象外）をCSS 3Dの立体牌(Tile3D)で表示する
// 対象座席。ON/OFF自体はsettingsStore.tsのtile3dEnabled（設定画面の
// トグル、GPU負荷が高い環境向けの回避策）が実際のスイッチを持つ——この
// Setは「そもそもどの座席が対象か」という座席側の区別だけを表す。
//
// 注意: player番号と上家/下家の対応はこのファイル内の古いコメント
// （「上家(1)/下家(3)」、mainTiles.map内に残っている）を信じてはいけない
// ——実際には逆で、CharacterPanel.tsxのSEAT_LABELS（{1:"下家CPU",
// 2:"対面CPU", 3:"上家CPU"}）とstyles.cssの座席位置指定
// （.opponent-area--1はright:185px＝画面右＝下家、--3はleft:185px＝
// 画面左＝上家）が正。実際に3(上家)へ誤って適用してしまい、ユーザーの
// 指摘で発覚した。数字だけで判断せず、必ずSEAT_LABELSか実際のDOM座標で
// 裏を取ること。
const TILE3D_PLAYERS = new Set<PlayerIndex>([1, 3]);

const HUMAN: PlayerIndex = 0;

// 上家の「縮む方向」固定端の計算に使う定数。Tile3Dの牌本体(.tile3d-outer)
// の自然な高さは常に43px×scale（Tile3D.tsxのbaseH、aspectYは2D的な後乗せ
// 引き伸ばしのため未加算）。列の最大枚数は配牌13枚+ツモ枠1で14——2D側の
// HAND_MAX_HALF_TRACKと同じ考え方（実際の現在の枚数ではなく取りうる
// 最大枚数を基準にする）をTile3Dの実寸で再現している。
const TILE3D_BASE_H = 43;
const TILE3D_MAX_SLOTS = 14;

// 副露が分かりにくいとの指摘を受け、鳴いた瞬間に発声を模した大きな文字を
// 一瞬表示する。暗槓は他家の捨て牌に反応した「鳴き」ではなく自分の手番中の
// 自己申告だが、実際の対局でも「カン」は声に出して宣言するのが普通なので
// 表示対象に含める。
const CALL_LABELS: Partial<Record<Meld["type"], string>> = {
  chi: "チー",
  pon: "ポン",
  minkan: "カン",
  kakan: "カン",
  ankan: "カン",
};
const CALL_ANNOUNCE_MS = 1000;

// 手出し（ツモった牌を一旦手牌に加えてから中ほどの牌を選んで切った）と
// わかるように、手出しの瞬間だけ残った手牌が中央でサッと割れて開き、
// そこから閉じる演出を見せる。ツモ切りは手牌に触れず端の牌をそのまま
// 切っただけなので、この演出は出さない（DiscardPile側の入場演出とだけ
// 差がつく）。CSSアニメーションの実時間(tile-slide-in, 300ms)と揃える。
const HAND_SPLIT_MS = 320;
const HAND_SPLIT_DISTANCE = 16;

export function OpponentArea({
  round,
  player,
  tile3dPortalTarget,
}: {
  round: RoundState;
  player: PlayerIndex;
  /** Tile3D立体牌の描画先（Table.tsx側の.tile3d-hand-layer--1）。祖先の
      「傾いた卓」演出(rotateX)の外にあるDOM要素で、渡された場合は手牌の
      実際の見た目をここへPortalし、シアー変形を回避する。渡されない
      座席・useTile3D=falseの座席では元通りその場に描画する。 */
  tile3dPortalTarget?: HTMLDivElement | null;
}) {
  // Tile3Dの角度・拡大率・厚みは実機の画面上でスライダー調整できるように
  // Tile3DDebugPanel/tile3dDebugStore側に外出ししてある（値が決まったら
  // このusePlayerTile3DParam呼び出しを消して固定値に置き換えてよい）。
  // 下家(player1)用と上家(player3)用は完全に独立したパラメータセット
  // なので、isKamichaでどちらを見るか切り替える（tile3dDebugStore.ts
  // のusePlayerTile3DParam参照）。
  const tile3dEnabled = useSettingsStore((s) => s.tile3dEnabled);
  const isKamicha = player === 3;
  const tile3dRx = usePlayerTile3DParam((s) => s.rx, (s) => s.kamichaRx, isKamicha);
  const tile3dRy = usePlayerTile3DParam((s) => s.ry, (s) => s.kamichaRy, isKamicha);
  const tile3dScale = usePlayerTile3DParam((s) => s.scale, (s) => s.kamichaScale, isKamicha);
  const tile3dThickness = usePlayerTile3DParam((s) => s.thickness, (s) => s.kamichaThickness, isKamicha);
  const tile3dWhiteWidth = usePlayerTile3DParam((s) => s.whiteWidth, (s) => s.kamichaWhiteWidth, isKamicha);
  const tile3dAspectX = usePlayerTile3DParam((s) => s.aspectX, (s) => s.kamichaAspectX, isKamicha);
  const tile3dAspectY = usePlayerTile3DParam((s) => s.aspectY, (s) => s.kamichaAspectY, isKamicha);
  const tile3dSpacing = usePlayerTile3DParam((s) => s.spacing, (s) => s.kamichaSpacing, isKamicha);
  const tile3dFanOffsetX = usePlayerTile3DParam((s) => s.fanOffsetX, (s) => s.kamichaFanOffsetX, isKamicha);
  const tile3dFrontIsLast = usePlayerTile3DParam((s) => s.frontIsLast, (s) => s.kamichaFrontIsLast, isKamicha);
  // 手牌の列全体の位置は、以前は鳴いた副露の数に関わらず一律だったが、
  // 手牌が短くなるたびに位置が変わって見える（sync()が実際のサイズを
  // 元に再計算するため）という指摘のため、鳴いた副露の数(0〜4)ごとに
  // 完全に独立した固定位置を持てるようにした（配列、下のp.hand.melds.
  // length定義後に実際の状態を選ぶ）。
  const tile3dHandGroupByMeldCount = usePlayerTile3DParam(
    (s) => s.handGroupByMeldCount,
    (s) => s.kamichaHandGroupByMeldCount,
    isKamicha,
  );
  const tile3dDrawnOffsetX = usePlayerTile3DParam((s) => s.drawnOffsetX, (s) => s.kamichaDrawnOffsetX, isKamicha);
  const tile3dDrawnOffsetY = usePlayerTile3DParam((s) => s.drawnOffsetY, (s) => s.kamichaDrawnOffsetY, isKamicha);
  // 副露を1つ鳴くごと(1番目〜4番目)の個別配置。各副露は完全に独立して
  // 位置・角度を持つ（MeldEditToolbar.tsx＋卓上での直接ドラッグで調整）。
  const tile3dMeldSlots = usePlayerTile3DParam((s) => s.meldSlots, (s) => s.kamichaMeldSlots, isKamicha);
  const tile3dShrinkReversed = usePlayerTile3DParam(() => false, (s) => s.kamichaShrinkReversed, isKamicha);
  // 副露配置編集モード（MeldEditToolbar.tsx参照）。実際の卓の上で副露を
  // 直接ドラッグして位置・角度を決める——別画面の縮小プレビューは実際の
  // 配置と一致せず意味がないという指摘のため、この方式に変更した。
  const meldEditSeat = useTile3DDebugStore((s) => s.meldEditSeat);
  const meldEditPreviewCount = useTile3DDebugStore((s) => s.meldEditPreviewCount);
  const meldEditActiveSlot = useTile3DDebugStore((s) => s.meldEditActiveSlot);
  const setMeldEditActiveSlot = useTile3DDebugStore((s) => s.setMeldEditActiveSlot);
  const setMeldSlotStore = useTile3DDebugStore((s) => s.setMeldSlot);
  const isEditingThisSeat = (meldEditSeat === "shimocha" && player === 1) || (meldEditSeat === "kamicha" && player === 3);
  const meldDragRef = useRef<{ index: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  // 編集モードを閉じた瞬間にドラッグ中だった場合の保険——isEditingThisSeat
  // はpointerdown発生時にしか見ていないため、これも上のpointermove側の
  // ボタン確認と合わせた多重の安全策。
  useEffect(() => {
    if (!isEditingThisSeat) meldDragRef.current = null;
  }, [isEditingThisSeat]);
  // 【重要な事故の反省】ドラッグ中に何らかの理由(要素の再生成でPointer
  // Captureが失われる、ウィンドウ外でボタンを離す等)でpointerupイベントが
  // 発火しないと、meldDragRef/handGroupDragRefが「ドラッグ中」のまま
  // 固まってしまい、その後は単にマウスがその牌の上を通過するだけ
  // （クリックしていなくても、pointermoveはボタンの状態に関わらず発火
  // するため）で位置がどんどんズレていく重大な事故が実機で発生した
  // （「マウスが合うとどんどん遠くに飛んでいく」との報告で発覚）。
  // pointerup/pointercancelのイベントハンドラだけに頼らず、pointermove側
  // で「実際に左ボタンが押され続けているか(e.buttons)」を都度確認し、
  // 押されていなければ即座にドラッグを中断する多重の安全策にする。
  const isPrimaryButtonDown = (e: ReactPointerEvent<HTMLDivElement>) => (e.buttons & 1) === 1;
  const handleMeldPointerDown = (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isEditingThisSeat) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
    const clampedIndex = Math.min(index, tile3dMeldSlots.length - 1);
    setMeldEditActiveSlot(clampedIndex);
    const current = tile3dMeldSlots[clampedIndex]!;
    meldDragRef.current = { index: clampedIndex, startX: e.clientX, startY: e.clientY, baseX: current.offsetX, baseY: current.offsetY };
  };
  const handleMeldPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = meldDragRef.current;
    if (!drag) return;
    if (!isPrimaryButtonDown(e)) {
      // pointerupを取り逃した後の暴走を防ぐ保険。
      meldDragRef.current = null;
      return;
    }
    const zoomRatio = getTableZoomRatio(e.currentTarget);
    const screenDX = (e.clientX - drag.startX) / zoomRatio;
    const screenDY = (e.clientY - drag.startY) / zoomRatio;
    const { dx, dy } = screenDeltaToMeldLocal(screenDX, screenDY, player);
    setMeldSlotStore(isKamicha, drag.index, { offsetX: Math.round(drag.baseX + dx), offsetY: Math.round(drag.baseY + dy) });
  };
  const handleMeldPointerUp = () => {
    meldDragRef.current = null;
  };
  // 手牌配置編集モード（HandEditToolbar.tsx参照）。副露配置編集と同じ
  // 考え方で、実際の卓の上で手牌の塊(Portalされた.tile3d-hand-portal-
  // inner)を直接ドラッグする。この要素自体は祖先の回転を持たない
  // (document.body直下にPortalしてあるため)ので、副露の時とは違い
  // 画面上のドラッグ方向をそのままoffsetX/Yに使ってよい
  // （screenDeltaToMeldLocalのような90度補正は不要）。
  const handEditSeat = useTile3DDebugStore((s) => s.handEditSeat);
  const handEditMeldCount = useTile3DDebugStore((s) => s.handEditMeldCount);
  const setHandGroupSlotStore = useTile3DDebugStore((s) => s.setHandGroupSlot);
  const isEditingHandThisSeat = (handEditSeat === "shimocha" && player === 1) || (handEditSeat === "kamicha" && player === 3);
  const handGroupDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  useEffect(() => {
    if (!isEditingHandThisSeat) handGroupDragRef.current = null;
  }, [isEditingHandThisSeat]);
  const handleHandGroupPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isEditingHandThisSeat) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
    const current = tile3dHandGroupByMeldCount[handEditMeldCount]!;
    handGroupDragRef.current = { startX: e.clientX, startY: e.clientY, baseX: current.offsetX, baseY: current.offsetY };
  };
  const handleHandGroupPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = handGroupDragRef.current;
    if (!drag) return;
    if (!isPrimaryButtonDown(e)) {
      // pointerupを取り逃した後の暴走を防ぐ保険（handleMeldPointerMoveと
      // 同じ理由、上のコメント参照）。
      handGroupDragRef.current = null;
      return;
    }
    const zoomRatio = getTableZoomRatio(e.currentTarget);
    const dx = (e.clientX - drag.startX) / zoomRatio;
    const dy = (e.clientY - drag.startY) / zoomRatio;
    setHandGroupSlotStore(isKamicha, handEditMeldCount, { offsetX: Math.round(drag.baseX + dx), offsetY: Math.round(drag.baseY + dy) });
  };
  const handleHandGroupPointerUp = () => {
    handGroupDragRef.current = null;
  };
  // 手牌配置編集モード中は、実際の対局データではなく「鳴いた副露が
  // handEditMeldCount個ある体」を仮に表示する——別画面のプレビューでは
  // なく実際の卓の上で見ながら配置したいという副露編集と同じ理由。
  // p.hand.concealedだけを差し替えることで、以降のmainTiles/枚数計算
  // 等はすべて自動的にこの仮の枚数に追従する（実データには一切影響
  // しない、表示専用の差し替え）。
  const isEditingHandThisSeatEarly = handEditSeat !== null && ((handEditSeat === "shimocha" && player === 1) || (handEditSeat === "kamicha" && player === 3));
  const p = isEditingHandThisSeatEarly
    ? {
        ...round.players[player],
        hand: {
          ...round.players[player].hand,
          concealed: Array.from({ length: Math.max(1, 13 - 3 * handEditMeldCount) }, (_, i) => ({
            id: `hand-edit-preview-${i}`,
            code: "1m" as TileCode,
            isRed: false,
          })),
        },
      }
    : round.players[player];
  const isCurrent = round.currentTurn === player;
  const concealedCount = p.hand.concealed.length;
  const discardCount = p.discards.length;

  const prevDiscardCountRef = useRef(discardCount);
  const [splitting, setSplitting] = useState(false);

  useEffect(() => {
    const prevCount = prevDiscardCountRef.current;
    prevDiscardCountRef.current = discardCount;
    if (discardCount > prevCount) {
      const latest = p.discards[discardCount - 1];
      if (latest && !latest.isTsumogiri) {
        setSplitting(true);
        const timer = setTimeout(() => setSplitting(false), HAND_SPLIT_MS);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [discardCount, p.discards]);

  // 加槓は新しい副露を追加するのではなく、既存のポンをその場でカンへ
  // 差し替える（配列の長さは変わらない）ため、枚数だけの比較では検出でき
  // ない。副露「種類の並び」を比較し、枚数が増えた場合と、同じ枚数のまま
  // 途中の種類が変わった場合（加槓）の両方を拾う。
  const meldTypes = p.hand.melds.map((m) => m.type);
  const meldsSignature = meldTypes.join(",");
  const prevMeldTypesRef = useRef(meldTypes);
  const [callAnnounce, setCallAnnounce] = useState<string | null>(null);

  useEffect(() => {
    const prevTypes = prevMeldTypesRef.current;
    let changedType: Meld["type"] | undefined;
    if (meldTypes.length > prevTypes.length) {
      changedType = meldTypes[meldTypes.length - 1];
    } else if (meldTypes.length === prevTypes.length) {
      for (let j = 0; j < meldTypes.length; j++) {
        if (meldTypes[j] !== prevTypes[j]) {
          changedType = meldTypes[j];
          break;
        }
      }
    }
    prevMeldTypesRef.current = meldTypes;
    const label = changedType && CALL_LABELS[changedType];
    if (label) {
      setCallAnnounce(label);
      const timer = setTimeout(() => setCallAnnounce(null), CALL_ANNOUNCE_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [meldsSignature]);

  // 必殺技発動の演出はTable.tsxのSkillActivationOverlay（卓全体を使った
  // ド派手な演出）に一本化したため、ここでの個別表示は行わない。

  // 自分の手牌(Hand.tsx)と同じく、ツモった直後（まだ切っていない間）は
  // その1枚だけ本体から少し離して見せる。ここでツモ切り／手出しの分かれ道を
  // 作る：
  // - ツモ切り＝この離れた牌がそのまま河へ運ばれる（DiscardPile側の入場
  //   演出が、この牌を含む.opponent-hand-backの右端付近を実測して起点に
  //   使うため、離れた牌の位置とほぼ一致した所から飛んでいくように見える）。
  // - 手出し＝この離れた牌は本体側に合流して見え隠れし、代わりに本体が
  //   中央で割れて別の牌が河へ出ていく（上のsplitting演出）。
  const hasPendingDraw = round.currentTurn === player && round.phase === "awaiting-discard";
  // カゲロウの「透視の術」発動中（自分＝人間プレイヤーに見えている間）、
  // またはこの対面がジンの「大明立直」でオープンリーチ中（p.openRiichi）
  // なら、伏せ牌の代わりに実際の牌柄を表示する。
  const revealHand = round.handsRevealedTo === HUMAN || p.openRiichi;
  // 立体牌(Tile3D)は伏せ牌の見た目だけを詰めてきたため、カゲロウの
  // 「透視の術」等で手牌が公開された時にどう見えるかは未検証。公開時は
  // 見た目が破綻する心配のない従来のTileView表示（2D、帯だけの表現）に
  // 戻す——指摘により、Tile3D対象のplayerでも revealHand中だけは
  // useTile3D=falseにして通常のTileView経路を使う。
  const useTile3D = tile3dEnabled && TILE3D_PLAYERS.has(player) && !revealHand;
  // 副露(.opponent-melds)は手牌がTile3D表示か2Dフォールバック(revealHand)
  // かに関わらず、常に同じ2D表示（TileView）を使う——Tile3Dなのは伏せ牌の
  // 見た目だけで、副露は元々2Dのまま。にもかかわらず副露の位置決め
  // (.opponent-melds--floating)を`useTile3D`で分岐させていたため、
  // 透視の術等で手牌が公開された瞬間だけ副露が旧方式（手牌と同じflex行内
  // で共に中央揃えされる、今回手牌側で直した「動くたびにズレる」のと
  // 同じ仕組み）に戻ってしまい、副露が手牌から大きく離れた位置（行の
  // 中心）に表示される不具合になっていた（指摘により判明）。副露の位置
  // 決めは手牌の表示方式と無関係に、常にこの座席がTile3D対象かどうか
  // だけで決めるべきなので、専用のフラグに分離する。
  const isTile3DSeat = tile3dEnabled && TILE3D_PLAYERS.has(player);
  const drawnTileId = hasPendingDraw ? round.lastDrawnTile?.id : undefined;
  const mainTiles = drawnTileId ? p.hand.concealed.filter((t) => t.id !== drawnTileId) : p.hand.concealed;
  const drawnTile = drawnTileId ? p.hand.concealed.find((t) => t.id === drawnTileId) : undefined;
  const mainCount = mainTiles.length;
  const leftCount = Math.ceil(mainCount / 2);
  // 上家・下家(opponent-area--1/3)の手牌枠(.opponent-hand-back)は、以前は
  // 常に最大14枚ぶん(474px)を固定で確保していた。鳴いて副露が増えても
  // 手牌側の枠は縮まないため、同じ行内でflex:1により余りしか渡されない
  // 副露側(.opponent-melds)が窮屈になり、90度回転後の見た目の高さが
  // 枠からはみ出して卓の外側で見切れてしまっていた（1副露だけでもtile--small
  // 3枚ぶん≒102pxを要求するのに対し、手牌側が常に474px専有していたため
  // 副露側に残る余白が足りなかった）。手牌が減ったぶんだけ副露に幅を
  // 返せるよう、実際の手牌枚数（ツモ牌含む）から必要な分だけ確保する。
  // ツモった牌(.tile--drawn)には本体から離して見せるための
  // margin-left:10pxが別途乗るため、枚数ぶんの実寸だけでは10px足りず、
  // ツモった瞬間だけそのぶんが枠からはみ出して見切れてしまう
  // （＝ツモっても手が開かれて見えない）。
  // 以前はこの+1枚・+10pxをhasPendingDrawの間だけ加算していたが、その
  // せいでツモ・打牌のたびにこの枠の高さが44pxぶん変動し、続く副露エリア
  // (.opponent-melds)がその変動をそのまま押し出されて縦にガクガク動く
  // 不具合になっていた（上家・下家どちらでも発生）。ツモの有無に関わらず
  // 「常にもう1枚保持している体」で高さを一定にし、実際にツモった瞬間も
  // 枠のサイズが変わらないようにする。
  const handTileCount = p.hand.concealed.length;
  const steadyHandTileCount = hasPendingDraw ? handTileCount - 1 : handTileCount;
  const handGap = 2;
  const handBackTrack = steadyHandTileCount > 0 ? (steadyHandTileCount + 1) * (32 + handGap) - handGap + 10 : 0;
  // Tile3D使用時、副露(.opponent-melds--floating、styles.css参照)を
  // 手牌の「実際の現在の枚数」ではなく「取りうる最大の枚数」を基準に
  // 行の中心から離す。配牌時点の最大13枚+ツモ1枚ぶんの固定値であり、
  // 副露が進んで実際の手牌が減っても変わらない——これにより、手牌が
  // 何枚であっても副露側の開始位置が手牌の実際の描画範囲より必ず外側に
  // なることを保証し、鳴くたびに両者が重なる不具合を構造的に防ぐ。
  const HAND_MAX_HALF_TRACK = ((13 + 1) * (32 + handGap) - handGap + 10) / 2;

  // 副露枠(.opponent-melds)も手牌枠と同じ理屈で、実際の副露牌の実寸から
  // 必要な幅（回転後は「卓の縁沿い」の長さになる）を算出する。以前は
  // 副露どうしを横に並べず1つずつ縦に積んでいたが（回転後は逆に卓の内側へ
  // 向かって伸びる向きになり、鳴くたびに卓へめり込んでいくように見える
  // 不具合になっていた）、自分/対面と同じく鳴いた順に一列へ並べる方式に
  // 統一したことで、この実寸ぶんを手牌と同じ並び方向に確保する必要がある。
  // 1副露あたりの実寸は.meld（tile--small 32px×n + 内側gap1px×(n-1) +
  // padding 2px×2）=33n+3px。ただし鳴いた牌(calledTile、暗槓を除く全て)は
  // 横向き表示(tile--rotated)で幅が32px→43pxに広がる（tile--smallの
  // --tile-h）ため、その差11pxを1副露につき1枚ぶんだけ追加する。副露間は
  // opponent-melds__innerのgap 2pxぶん。
  const ROTATED_TILE_EXTRA_WIDTH = 43 - 32;
  // 加槓は4枚目を横一列に並べず元のポンの牌に重ねて表示する（下の
  // 描画側のmeldDisplaySlots参照）ため、占有幅は3枚ぶんとして計算する。
  const meldFootprintTileCount = (m: Meld) => (m.type === "kakan" && m.addedKanTile ? m.tiles.length - 1 : m.tiles.length);
  const meldsTrack =
    p.hand.melds.reduce((sum, m) => sum + 33 * meldFootprintTileCount(m) + 3 + (m.calledTile ? ROTATED_TILE_EXTRA_WIDTH : 0), 0) +
    Math.max(0, p.hand.melds.length - 1) * 2;

  // 必殺技「時間停止」発動中の演出。発動者本人（timeStopSource）以外は
  // 手牌ごと丸ごとグレーアウトする（2巡ぶんの発動中はずっと）。
  // ネームプレート側の「空振りの光り演出」（fakeTurnStepIndex）は
  // CharacterPanel.tsxへ移設したため、ここでは手牌グレーアウト用の
  // frozen判定だけ残す。
  const timeStopSource = ([0, 1, 2, 3] as const).find((seat) => round.players[seat]!.timeStopTurnsRemaining > 0);
  const isTimeStopped = timeStopSource !== undefined;
  const frozen = isTimeStopped && timeStopSource !== player;

  // ツモ牌の枠は常に描画し、ツモ中でない間はvisibility:hiddenで隠すだけに
  // する（DOMから外したり幅0にはしない）。こうしないとツモの有無でこの
  // 内側全体(.opponent-hand-back__inner)の実寸が変わってしまい、外側
  // (.opponent-hand-back)のjustify-content:centerによって既存の牌ごと
  // 再センタリングされ、手牌全体がガクガク動く不具合になる。実寸を常に
  // 一定に保つことで、中央寄せのままでも手牌の位置が変わらないようにする。
  // Tile3Dは.tile/.tile--drawn等のクラス体系を使わない別コンポーネントの
  // ため、置き換え対象のplayerでは通常のTileViewの代わりにこちらを使う。
  //
  // 既存の2D牌は「横一列に並べてからopponent-hand-back__innerごと
  // rotate(90deg)/(-90deg)で丸ごと回転させて縦に見せる」仕組みだが、これは
  // 完成した3D描画済みの画像を後からさらに平面的にスピンさせることになり、
  // プロトタイプ本来の見た目（どちら側に側面の帯が来るか等の見え方）が
  // まるごと90度分ズレてしまう（指摘により判明）。Tile3D側ではこの
  // 回転の仕組みを使わず、下のJSXで.opponent-hand-back__innerの
  // transform/flex-directionを直接上書きして素直な縦並び(column)にし、
  // 各立体牌はプロトタイプそのままのrx/ry（追加の回転なし）で描く。
  function renderConcealed3D(args: {
    key?: string;
    code: TileCode;
    faceDown: boolean;
    red?: boolean;
    style?: CSSProperties;
    drawn?: boolean;
    /** 縦一列の中での並び順（0が先頭）。重なり量(縦)・横のずらし量(扇状)・
        手前/奥の重なり順は、全部この番号を基準に計算する。 */
    index: number;
  }) {
    // 手前/奥(tile3dFrontIsLast)は、どちらの端の牌を一番手前に重ねるかを
    // z-indexの符号で切り替える——プロトタイプの「Aが手前/Bが手前」に相当。
    const zIndex = tile3dFrontIsLast ? args.index : -args.index;
    // 計算式ベースの配置。縦位置(tile3dSpacing、負の値で重ねる)は
    // .opponent-hand-back__inner側のgapを0にした上でここのmarginTopとして
    // 各牌に適用する（flexのgapは負の値を受け付けないため）。列の基準
    // (index 0)は常にmarginTop:0。横位置(tile3dFanOffsetX)は並び順に
    // 応じて累積させ扇状に広げる。
    //
    // ツモ牌を列の反対側の端に置きたいとの指摘のため、ツモ牌は単に横位置
    // の符号を反転させるのではなく、並び順そのものを列の端(index 0または
    // 末尾)にして描画順も本体側と入れ替える（呼び出し側を参照）。
    // どちらの端にするかは座席によって異なる——下家(1)は先頭、上家(3)は
    // 「逆サイドにしてほしい」との指摘のため末尾。
    // ツモ牌と本体の間だけ少し広めに空けたい（本体から離して見せる従来の
    // 演出）ので、+10pxは「ツモ牌と隣接する側の牌」のmarginTopに乗せる
    // ——marginTopは「自分の直前の要素との間隔」なので、間隔を担うのは
    // 常に後ろに来る側の要素になる。ツモ牌が先頭(index 0)の座席では
    // その直後(index 1、本体の先頭)に、ツモ牌が末尾の座席ではツモ牌
    // 自身に付与する。
    const drawnAtEnd = player === 3;
    const needsExtraGap = drawnAtEnd ? args.drawn === true : args.index === 1;
    const marginTop = args.index === 0 ? 0 : tile3dSpacing + (needsExtraGap ? 10 : 0);
    const marginLeft = args.index * tile3dFanOffsetX;
    const extraStyle: CSSProperties = { marginTop, marginLeft };
    return (
      <Tile3D
        key={args.key}
        code={args.code}
        faceDown={args.faceDown}
        red={args.red}
        rx={tile3dRx}
        ry={tile3dRy}
        scale={tile3dScale}
        thickness={tile3dThickness}
        whiteWidth={tile3dWhiteWidth}
        aspectX={tile3dAspectX}
        aspectY={tile3dAspectY}
        style={{ ...args.style, ...extraStyle, zIndex }}
      />
    );
  }

  function renderDrawnTile() {
    const showDrawn = hasPendingDraw && !!drawnTile;
    const zIndexStyle: CSSProperties | undefined =
      player === 1 ? { zIndex: -mainTiles.length } : player === 3 ? { zIndex: mainTiles.length } : undefined;
    // 対面(2)だけツモ牌を先頭（画面左）に置くため、既定の.tile--drawn
    // (margin-left:10px＝手前の牌との間隔)を反転させ、後ろに続く本体牌との
    // 間隔をmargin-rightで確保する。
    const marginFix: CSSProperties | undefined = player === 2 ? { marginLeft: 0, marginRight: 10 } : undefined;
    const code = showDrawn && revealHand ? drawnTile!.code : "1m";
    const faceDown = !(showDrawn && revealHand);
    const red = showDrawn && revealHand ? drawnTile!.isRed : undefined;
    const style: CSSProperties = { ...zIndexStyle, ...marginFix, visibility: showDrawn ? "visible" : "hidden" };
    if (useTile3D) {
      // ツモ牌を列の反対側の端に置くため、下家(1)はindex 0(先頭)固定、
      // 上家(3)は「逆サイドにしてほしい」との指摘のためindex
      // mainTiles.length(末尾)固定にする（呼び出し側でも描画順を本体と
      // 入れ替えている、handInner参照）。
      const index = player === 3 ? mainTiles.length : 0;
      return renderConcealed3D({ code, faceDown, red, style, drawn: true, index });
    }
    return <TileView key="drawn" code={code} faceDown={faceDown} red={red} small drawn style={style} />;
  }

  // Tile3D立体牌は祖先の「傾いた卓」演出(rotateX)の中にいるとシアー変形
  // する（project-tile3d-prototypeメモ参照）ため、Table.tsx側で用意した
  // 傾きの外にあるレイヤー(tile3dPortalTarget)へPortalで描画し直す。
  // マウント直後などtile3dPortalTargetがまだ取得できていない一瞬だけは、
  // 元の場所（歪む）にフォールバック表示する。
  const portalActive = useTile3D && !!tile3dPortalTarget;

  // 対面(2)は自分と正対しているため、対面本人から見た右側（＝こちらから
  // 見た左側）にツモ牌が来るのが実際の卓と同じで自然。DOM順で先頭に置く
  // ことで、回転もrow-reverseもしていない対面の手牌の中で画面左端に
  // 表示させる（下家・自分はこれまで通りDOM順の最後＝画面右端寄り）。
  // 下家(useTile3D)は、ツモ牌を列の反対側の端(先頭)に置きたいとの指摘の
  // ためDOM順で先頭にする（本体側のindexは+1する、mainTiles.map内参照）。
  // 上家(useTile3D)は「ツモ位置を下家と逆サイドにしてほしい」との指摘
  // のため、下家とは逆にDOM順・indexとも末尾（本体はindexそのまま、
  // ツモ牌がmainTiles.length）にする。
  const drawnAtStart = player === 2 || (useTile3D && player !== 3);
  const drawnAtEnd = (player !== 2 && !useTile3D) || (useTile3D && player === 3);
  const handInner = (
    <>
      {drawnAtStart && renderDrawnTile()}
      {mainTiles.map((t, i) => {
        // 上家・下家は手牌もrotate(90deg/-90deg)されており、牌の帯
        // (box-shadow)がローカル座標の「下」＝回転後は横方向に伸びる
        // ため、素のままだと隣の牌の絵の上に帯が乗ってしまう（大明
        // 立直等で手牌を公開した時に顕著）。河・副露(.opponent-melds)
        // と同じ考え方で、手前に来る牌ほど高いz-indexを持たせ、奥の
        // 牌の帯を手前の牌の絵の下に隠す。
        const zIndexStyle: CSSProperties | undefined =
          player === 1 ? { zIndex: -i } : player === 3 ? { zIndex: i } : undefined;
        const enterStyle: CSSProperties | undefined = splitting
          ? i < leftCount
            ? ({ "--enter-x": `${-HAND_SPLIT_DISTANCE}px`, "--enter-y": "0px" } as CSSProperties)
            : ({ "--enter-x": `${HAND_SPLIT_DISTANCE}px`, "--enter-y": "0px" } as CSSProperties)
          : undefined;
        const code = revealHand ? t.code : "1m";
        const faceDown = !revealHand;
        const red = revealHand ? t.isRed : undefined;
        if (useTile3D) {
          // 下家はツモ牌がindex 0(先頭)を占めるため、本体側は1つずつ
          // 後ろにずれる(i+1)。上家はツモ牌がmainTiles.length(末尾)を
          // 占めるため、本体側はそのままのindex(i)でよい。
          return renderConcealed3D({
            key: t.id,
            code,
            faceDown,
            red,
            style: { ...zIndexStyle, ...enterStyle },
            index: player === 3 ? i : i + 1,
          });
        }
        return (
          <TileView
            key={t.id}
            code={code}
            faceDown={faceDown}
            red={red}
            small
            slideIn={splitting ? "default" : undefined}
            style={{ ...zIndexStyle, ...enterStyle }}
          />
        );
      })}
      {drawnAtEnd && renderDrawnTile()}
    </>
  );

  // Portal先(tile3dPortalTarget)は.opponent-hand-back（プレースホルダー、
  // 下のuseEffect参照）の実際の画面位置をそのまま実測して自分の位置に
  // するため、.opponent-hand-back自身が持つtranslateX(±27px)や
  // .opponent-hand-rowが持つtranslateY(-50px)は、実測値に既に織り込み
  // 済み——ここではユーザーが実機で追い込む「全体・横/縦」スライダー
  // (tile3dGroupOffsetX/Y)分の微調整だけを追加で乗せる。rotate(groupRotate)
  // は個々の牌の並び順(spacing/fanOffsetX、renderConcealed3D参照)には
  // 一切触れず、既に並べ終えた列全体をそのまま傾けるためのもの。
  // translateをrotateの左（＝適用順としては後）に書くことで、rotateが
  // 要素自身の中心を軸に先に適用され、その後translateで平行移動する
  // ——移動量がrotateの値に関わらず一定に保たれる（逆順だと、回転後の
  // 座標系でtranslateすることになり、移動方向が傾きに応じて変わって
  // しまう）。
  //
  // どの副露数状態の位置を使うかは、手牌配置編集モード中ならユーザーが
  // 選んでいる状態(handEditMeldCount)、それ以外は実際の現在の副露数
  // （5状態(0〜4)を超える分は4に丸める、5副露以上は起こらないはずだが
  // 念のため）。p.hand.meldsは手牌配置編集用の差し替え(concealedのみ)の
  // 影響を受けないため、実際の副露数を正しく反映する。
  const realHandMeldCount = Math.min(p.hand.melds.length, HAND_GROUP_SLOT_COUNT - 1);
  const effectiveHandMeldCount = isEditingHandThisSeat ? handEditMeldCount : realHandMeldCount;
  const handGroupSlot = tile3dHandGroupByMeldCount[effectiveHandMeldCount] ?? tile3dHandGroupByMeldCount[0]!;
  const tile3dGroupTransform = `translate(${handGroupSlot.offsetX}px, ${handGroupSlot.offsetY}px) rotate(${handGroupSlot.rotate}deg)`;

  // Portal先レイヤーの位置を、.opponent-hand-back（祖先の「傾いた卓」
  // 演出の中にいるプレースホルダー、実際の見た目は持たない）の画面上の
  // 実際の中心点に継続的に追従させる。数式で祖先の回転(rotateX)を
  // 打ち消す方式は、回転中心のズレによる位置ズレ（「下家の見切れ」不具合
  // 参照）を繰り返したため、実測ベースのこの方式に変更した。
  const handBackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!portalActive || !tile3dPortalTarget) return undefined;
    const anchor = handBackRef.current;
    const layer = tile3dPortalTarget;
    if (!anchor) return undefined;

    const sync = () => {
      const anchorRect = anchor.getBoundingClientRect();
      // .tableはrotateX等の3D回転を持たないため、その
      // getBoundingClientRect().width / offsetWidth の比が、.tableの
      // zoom:1.46とStageのレターボックスscaleを合成した「実際の画面
      // ピクセル ÷ 論理px」の倍率になる。Tile3D側の内部px値(scale,
      // thickness等)はこの論理pxを基準にしているため、Portal先にも
      // 同じ倍率を掛けないと、他の卓上の要素と比べてTile3Dだけ
      // サイズ感が食い違って見える。
      const tableEl = anchor.closest(".table") as HTMLElement | null;
      const zoomRatio = tableEl && tableEl.offsetWidth > 0 ? tableEl.getBoundingClientRect().width / tableEl.offsetWidth : 1;
      const cx = anchorRect.left + anchorRect.width / 2;
      const cy = anchorRect.top + anchorRect.height / 2;
      // CSSのtranslate(-50%,-50%)では、layer自身のtransform:scale(zoom)と
      // 組み合わせた時に中心合わせが常にズレる（transform-originや適用
      // 順序をどう工夫してもCSSだけでは解決できなかった、styles.cssの
      // .tile3d-hand-layerコメント参照）ため、layerの「前フレームの実際の
      // 描画サイズ」(scale適用後)を使って左上位置をpx単位で直接計算する。
      // layer側はtransform-origin:0 0 + scale(zoom)のみなので、
      // style.left/topはそのまま「拡大後の左上が来る位置」として機能する。
      const layerRect = layer.getBoundingClientRect();
      layer.style.left = `${cx - layerRect.width / 2}px`;
      // 上家だけ「副露で手牌が短くなる時、どちら側の端から縮んでいくか」を
      // 指定できるようにするため、中心合わせ(cy - height/2、両端が対称に
      // 動く)ではなく、片方の端を常に固定した位置合わせに変える。
      // 濃度の判定には、実際に取りうる最大の枚数(13枚+ツモ枠1)の時の
      // 列の高さ(maxColumnHeightLocal、zoomRatio適用前のローカル座標)の
      // 半分を使い、常にこの「最大サイズ基準の固定点」からtop/bottomを
      // 算出する——実際の現在の枚数(layerRect.height)には依存しないため、
      // 枚数が変わっても固定端は絶対に動かない。下家(shimocha)はこの
      // 分岐に入らず、元の中心合わせのまま（過去の実装でツモ牌位置まで
      // 巻き込んで壊した反省から、影響範囲を上家だけに絞っている）。
      if (isKamicha) {
        const maxColumnHeightLocal =
          TILE3D_MAX_SLOTS * (TILE3D_BASE_H * tile3dScale) + (TILE3D_MAX_SLOTS - 1) * tile3dSpacing + 10;
        const maxHalfHeight = (maxColumnHeightLocal * zoomRatio) / 2;
        layer.style.top = tile3dShrinkReversed
          ? `${cy + maxHalfHeight - layerRect.height}px` // 下端を固定、上端が縮む
          : `${cy - maxHalfHeight}px`; // 上端を固定、下端が縮む
      } else {
        layer.style.top = `${cy - layerRect.height / 2}px`;
      }
      layer.style.setProperty("--tile3d-hand-zoom", String(zoomRatio));
    };

    // 毎フレームgetBoundingClientRect()を呼ぶrafループで実装した所、
    // Tile3DDebugPanelのスライダー操作時に強制同期レイアウト
    // (forced reflow)が常時発生し続け、実機で「異常に重い・スライダーの
    // 反映が遅れる」規模の性能劣化を引き起こした（指摘により発覚、
    // 削除）。実際に位置の再計算が必要なのは「.opponent-hand-back(anchor)
    // 自身のサイズが変わった時」「layer自身の見た目サイズが変わった時
    // （scale/thickness等のスライダー操作でTile3Dの実際の描画サイズが
    // 変わる）」「.tableのサイズが変わった時（ウィンドウリサイズ）」の
    // 3つだけなので、この3要素をResizeObserverで直接監視する方式に
    // 戻した。ResizeObserver単体だと初回マウント直後のごく短い間
    // （Stage.tsxのuseFitScaleが非同期にレターボックスscaleを確定する
    // タイミングとのズレ）だけ位置がズレることがあったため、マウント後
    // 数回だけ追加でsync()を呼んで補正する（rafループのような常時
    // ポーリングではなく、有限回のタイムアウトなので負荷はごく小さい）。
    const tableEl = anchor.closest(".table") as HTMLElement | null;
    const observed = [anchor, layer, tableEl].filter((el): el is HTMLElement => !!el);
    const ro = new ResizeObserver(sync);
    observed.forEach((el) => ro.observe(el));
    // ブラウザの拡大縮小(Ctrl+/Ctrl-)やウィンドウリサイズの直後、手牌の
    // 立体牌が全く違う位置に飛ぶ不具合が実機で発覚した。原因: .table自身の
    // CSS上のwidth/height(1392x748)や.opponent-hand-backのwidth/height
    // (実際の手牌枚数だけで決まる)は、祖先(.stage__canvas)のズーム倍率
    // (Stage.tsxのuseFitScaleが再計算するレターボックスscale)が変わっても
    // 一切変化しない——ResizeObserverは要素自身の宣言サイズ(zoom適用前)を
    // 見るため、祖先のズーム変化だけではどれも発火しない。window の
    // resizeイベントはズーム変化時にも発火するが、そのタイミングでは
    // Stage.tsx側のscale再計算がまだ反映されておらず、sync()が古い
    // (ズーム前の).tableの実測値を掴んでしまう競合状態があった
    // （マウント直後だけ複数回sync()を呼んで補正する既存の対策と全く
    // 同じ種類の問題が、マウント時以外のリサイズのたびにも起きていたが、
    // そちらには再試行の仕組みが無かった）。resize時もマウント時と同じく
    // 複数回・時間差でsync()を呼び直すことで、Stage側の再計算が遅れて
    // 反映されるケースまで確実に拾う。
    const resync = () => {
      sync();
      [50, 150, 300, 600].forEach((ms) => window.setTimeout(sync, ms));
    };
    window.addEventListener("resize", resync);
    const timeouts = [50, 150, 300, 600, 1000].map((ms) => window.setTimeout(sync, ms));
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resync);
      timeouts.forEach((id) => window.clearTimeout(id));
    };
    // isKamicha/tile3dShrinkReversed/tile3dScale/tile3dSpacingはsync内の
    // 固定端計算(maxColumnHeightLocal)で使うクロージャ値のため、これらが
    // スライダー等で変わった時にもsyncを作り直して古い値を掴まないようにする。
  }, [portalActive, tile3dPortalTarget, isKamicha, tile3dShrinkReversed, tile3dScale, tile3dSpacing]);

  return (
    <div
      className={`opponent-area opponent-area--${player}${isCurrent ? " opponent-area--active" : ""}${frozen ? " opponent-area--frozen" : ""}${isEditingThisSeat || isEditingHandThisSeat ? " opponent-area--editing-melds" : ""}`}
    >
      {callAnnounce && <div className="call-announce">{callAnnounce}</div>}
      <div className="opponent-hand-row">
        <div
          className="opponent-hand-back"
          data-hand-anchor={player}
          ref={handBackRef}
          style={
            {
              "--hand-back-track": `${handBackTrack}px`,
              // Tile3D使用時は横一列→丸ごと回転の仕組みを使わないため、
              // その仕組み向けに計算されたwidth:45px/heightをここだけ
              // 上書きする（実寸(scale=2で64px幅)に合わせて自動サイズに）。
              // Portal化した時はこの箱は「副露側との幅の取り合いのための
              // サイズ確保だけ」を担う透明なプレースホルダーになるため、
              // 元の固定サイズ(width:45px/height:var(--hand-back-track))
              // のままにしておく（実際の見た目はPortal側が担当する）。
              ...(useTile3D && !portalActive
                ? {
                    width: "auto",
                    height: "auto",
                    transform: tile3dGroupTransform,
                  }
                : null),
            } as CSSProperties
          }
        >
          <div
            className="opponent-hand-back__inner"
            style={
              useTile3D && !portalActive
                ? // gapは負の値を取れない(CSS仕様)ため、重なりは各牌の
                  // marginTop(renderConcealed3D参照)で表現し、ここでは
                  // 既定のgap:2pxを打ち消しておく。
                  { transform: "none", flexDirection: "column", gap: 0 }
                : undefined
            }
          >
            {!portalActive && handInner}
          </div>
        </div>
        {portalActive &&
          tile3dPortalTarget &&
          createPortal(
            <div
              className={`tile3d-hand-portal-inner${isEditingHandThisSeat ? " tile3d-hand-portal-inner--editable" : ""}`}
              style={{ transform: tile3dGroupTransform }}
              onPointerDown={isEditingHandThisSeat ? handleHandGroupPointerDown : undefined}
              onPointerMove={isEditingHandThisSeat ? handleHandGroupPointerMove : undefined}
              onPointerUp={isEditingHandThisSeat ? handleHandGroupPointerUp : undefined}
              onPointerCancel={isEditingHandThisSeat ? handleHandGroupPointerUp : undefined}
            >
              <div className="tile3d-hand-back-inner">{handInner}</div>
            </div>,
            tile3dPortalTarget,
          )}
        <div
          className={`opponent-melds${isTile3DSeat ? " opponent-melds--floating" : ""}`}
          style={
            {
              "--melds-track": `${meldsTrack}px`,
              // 副露の位置決めは、手牌がTile3D表示中かrevealHandで2D表示に
              // 落ちているかに関わらず、この座席(下家/上家)であれば常に
              // 同じ.opponent-melds--floating方式を使う（副露自体は常に2D
              // 表示のため）。isTile3DSeatはuseTile3Dと違いrevealHandの
              // 影響を受けない——ここをuseTile3Dで分岐させていたのが
              // 「透視の術で手牌公開中だけ副露が旧方式に戻って行の中心
              // 付近まで飛んでいく」不具合の原因だった。
              //
              // 位置決めの基準点(top)は「1番目の副露(最も手牌から離れた
              // 位置)が来る点」そのものにする——HAND_MAX_HALF_TRACK(手牌の
              // 最大サイズの半分、実際の手牌枚数に依存しない固定値)から、
              // さらに副露が取りうる最大個数(MELD_SLOT_COUNT)ぶんの間隔
              // (MELD_NATURAL_STEP固定値)だけ離す。以前はここを「手牌の
              // すぐ外側の点」にして副露をそこから外側へ広げていたが、
              // それだと1番目の副露がその都度伸び縮みする塊の内側の端に
              // なってしまい、(a)副露の個数が変わるたびに1番目の副露の
              // 位置までズレる、(b)実際の卓上マナーとは逆方向（1番目が
              // 手牌に近く、後から鳴くほど離れる）になる、の2つの不具合
              // があった。基準点自体を「最大個数分離れた、常に一定の点」
              // にし、副露ごとのleft(下のslotStyle参照)をこの基準点から
              // 手牌に向かって並べることで、両方を同時に解決する。
              // 基準点(top)自体は「手牌のすぐ外側(HAND_MAX_HALF_TRACKのみ)」
              // に戻す——以前はここに副露最大個数分の間隔もまとめて足して
              // いたが、それだと基準点自体が卓の外・画面外まで押し出されて
              // しまい、実機で「上家の副露が完全に画面外に出て触れない」
              // 不具合が発覚した（実測: .stage(overflow:hidden)の実際の
              // 可視範囲を基準に確認、下家側も程度は軽いが同様に一部が
              // 可視範囲を超えていた）。「1番目が最も手牌から離れる」は
              // 下のleft(slotStyle参照、indexが増えるほど基準点に近づく
              // 側)だけで表現し、基準点自体は動かさない。
              top: `calc(50% + ${HAND_MAX_HALF_TRACK + (isKamicha ? KAMICHA_MELDS_ANCHOR_CORRECTION : 0)}px)`,
            } as CSSProperties
          }
        >
          <div className="opponent-melds__inner">
            {(() => {
              // 上家・下家の副露は川の捨て牌と同じ帯（厚み）の向きにしたが、
              // 川と違ってどの牌にも段内の奥行きz-indexが付いていないため、
              // 隣の牌の帯がそのまま前の牌の絵の上に乗って見えてしまって
              // いた（川と同じ「隣り合う牌が互いの帯を隠す」処理が必要）。
              // 帯が伸びる向き（下家=左向き/-X、上家=右向き/+X）へ進むほど
              // 手前に来るよう、副露をまたいだ通し番号でz-indexを振る
              // （.meldはposition未指定でスタッキングコンテキストを
              // 作らないため、この番号は副露の境をまたいでそのまま比較される）。
              // 副露配置編集モード中、実際の副露がまだ足りない分は仮の
              // 副露(makeMockMeld)を末尾に補って卓上に表示する——「別画面の
              // 縮小プレビューではなく、実際の卓の上で直接配置したい」との
              // 指摘のため、本物の卓面・本物のCSSのままドラッグできる
              // ようにしている。実際の副露が既にpreviewCount以上ある場合は
              // 何も補わない（本物のデータを優先、隠さない）。
              // 手牌配置編集モード中も、鳴いた副露の数(handEditMeldCount)に
              // 応じた分だけ仮の副露を表示する——手牌だけ短くして副露が
              // 何も無いと、実際にその副露数だった時の見た目と食い違う
              // ため、両方の編集モードで同じ仮表示の仕組みを共有する。
              const previewMeldCountForThisSeat = isEditingThisSeat
                ? meldEditPreviewCount
                : isEditingHandThisSeat
                  ? handEditMeldCount
                  : 0;
              const realMeldCount = p.hand.melds.length;
              const mockCount = previewMeldCountForThisSeat > 0 ? Math.max(0, previewMeldCountForThisSeat - realMeldCount) : 0;
              const displayMelds =
                mockCount > 0
                  ? [...p.hand.melds, ...Array.from({ length: mockCount }, (_, k) => makeMockMeld(realMeldCount + k))]
                  : p.hand.melds;
              return displayMelds.map((m, i) => {
                const isMock = i >= realMeldCount;
                // 対面は卓を挟んで自分と向き合っているため、本人から見た
                // 左右がこちらの画面上ではそのまま逆になる。mirror=trueで
                // 上家(1)/下家(3)から鳴いた牌の位置を入れ替え、対面本人
                // から見た並びを正しく再現する。
                const slots = meldDisplaySlots(m, player === 2);
                // 副露配置編集モード(MeldEditToolbar.tsx)で1〜4番目の副露
                // ごとに個別指定した位置・角度。最大4副露までしか無いはず
                // だが、念のため配列の最後の要素にクランプする。下家・上家
                // 以外(player===2)は対象外なのでbaseのまま。
                const slotConfig: MeldSlotConfig | undefined = isTile3DSeat
                  ? tile3dMeldSlots[Math.min(i, tile3dMeldSlots.length - 1)]
                  : undefined;
                // 自然な(ユーザーがドラッグする前の)位置は、flexの自動配置
                // ではなくposition:absoluteの明示的なleftで指定する
                // （固定値MELD_NATURAL_STEPのみに依存し、実際の副露の
                // 個数・種類には一切依存しない）。1番目の副露(index0)を
                // left:0に固定し、.opponent-melds__innerのtransform-origin
                // も(0,0)にしてあるため、1番目の副露は絶対に動かない。
                // 後から鳴くほどindexが増え、leftが手牌に近い側へ進む
                // ——「1番目が最も手牌から離れ、後から鳴くほど手牌に近づく」
                // という卓上マナーの並びをそのまま再現する。ただし
                // .opponent-melds__innerのrotate(90deg)(上家)/rotate(-90deg)
                // (下家)は互いに逆向きのため、同じ符号のleftの変化が画面上で
                // 意味する方向（手牌に近づく/離れる）も座席ごとに逆になる
                // ——実測(getBoundingClientRect+手牌との距離)で確認し、
                // 上家だけ符号を反転させている（下家は元から正しかったため
                // 触れていない）。
                const naturalLeft = isTile3DSeat
                  ? (isKamicha ? 1 : -1) * (MELD_SLOT_COUNT - 1 - i) * MELD_NATURAL_STEP
                  : undefined;
                // 副露どうしの重なり順は、.meld自身に明示のz-indexを
                // 持たせて決める。内側の牌1枚1枚(.tile、isolation:isolateで
                // それぞれ独立したスタッキングコンテキストを持つ)のz-index
                // だけで副露をまたいで比較させようとした前回の実装は、実際の
                // 描画順(elementsFromPointで直接検証)では効いておらず、結局
                // DOM順（最後に鳴いた副露が手前）のままになってしまっていた
                // ——`.meld`自身はposition:absoluteだけでz-indexを持たず、
                // スタッキングコンテキストを作っていなかったのが原因。
                // `.meld`自身に明示的なz-indexを与えれば、それ自体が確実な
                // スタッキングコンテキストになり、副露間の比較はこの値だけで
                // 決まるようになる（内側の牌のz-indexは、その副露自身の内部
                // だけの話に閉じてスコープされる）。
                // 重なる向きは座席で逆：上家(3)は先に鳴いた副露(小さいi)が
                // 手前、下家(1)は逆に後から鳴いた副露(大きいi)が手前——
                // ユーザー指摘による座席ごとの正しい原則。
                const meldOrderZIndex = isTile3DSeat ? (isKamicha ? MELD_SLOT_COUNT - i : i + 1) * 100 : undefined;
                const slotStyle: CSSProperties | undefined = slotConfig
                  ? {
                      position: "absolute",
                      left: naturalLeft,
                      top: 0,
                      zIndex: meldOrderZIndex,
                      transform: `translate(${slotConfig.offsetX}px, ${slotConfig.offsetY}px) rotate(${slotConfig.rotate}deg)`,
                    }
                  : undefined;
                const editableClass = isEditingThisSeat
                  ? ` meld--editable${meldEditActiveSlot === Math.min(i, tile3dMeldSlots.length - 1) ? " meld--editable-active" : ""}`
                  : "";
                return (
                  <div
                    key={i}
                    className={`meld meld--small${editableClass}${isMock ? " meld--mock" : ""}`}
                    style={slotStyle}
                    onPointerDown={isEditingThisSeat ? handleMeldPointerDown(i) : undefined}
                    onPointerMove={isEditingThisSeat ? handleMeldPointerMove : undefined}
                    onPointerUp={isEditingThisSeat ? handleMeldPointerUp : undefined}
                    onPointerCancel={isEditingThisSeat ? handleMeldPointerUp : undefined}
                  >
                    {slots.map((slot, j) => {
                      // 副露どうしの重なり順は、もう上のmeldOrderZIndex
                      // (.meld自身のz-index)だけで決まる。ここは副露1つの
                      // 中の牌どうしの重なり（牌の帯を隣の牌の絵で隠すため
                      // の、副露内だけの関係）に専念すればよく、他の副露と
                      // 混ざらないよう小さい範囲の値で十分——実際、.meldが
                      // 明示のz-indexを持つことで独立したスタッキング
                      // コンテキストになり、この値は他の副露の牌と比較
                      // されなくなる（実測(elementsFromPoint)で確認済み）。
                      // 元の実装では下家(1)が「副露内で先の牌(小さいj)ほど
                      // 手前」、上家(3)は逆に「後の牌(大きいj)ほど手前」という
                      // 互いに鏡写しの向きで、どちらもそれぞれ正しく機能して
                      // いたため、この座席ごとの向きの違いはそのまま保つ。
                      const withinMeldSign = player === 1 ? -1 : 1;
                      const zIndexStyle: CSSProperties | undefined =
                        player === 1 || player === 3 ? { zIndex: withinMeldSign * j } : undefined;
                      if (slot.kind === "stack") {
                        // 加槓：元のポンで横向きにした牌の上に4枚目を重ねて
                        // 見せる（以前は単に横一列へ並べていたため大明槓と
                        // 見分けがつかない見た目になっていた）。
                        return (
                          <span key={j} style={{ position: "relative", display: "inline-flex", ...zIndexStyle }}>
                            <TileView
                              code={slot.base.code}
                              small
                              rotated
                              red={slot.base.isRed}
                              // 4枚目(added)と重ならないよう、台座側も少し下へ
                              // ずらす（Hand.tsxのMeldViewと同じ理由）。
                              style={{ position: "relative", top: 16 }}
                            />
                            <TileView
                              code={slot.added.code}
                              small
                              rotated
                              red={slot.added.isRed}
                              // 台座にしている牌と同じ「厚み」の帯(box-shadow)を
                              // 重ねて出すと二重に見えるため、浮いている程度の
                              // 柔らかい影に差し替える（Hand.tsxのMeldViewと同じ理由）。
                              style={{ position: "absolute", top: -16, left: 0, zIndex: 999, boxShadow: "0 2px 3px rgba(0, 0, 0, 0.5)" }}
                            />
                          </span>
                        );
                      }
                      // 暗槓は自己申告のみで鳴きではないため、実際の対局同様
                      // 両端の2枚は伏せたまま（種類を悟らせない）。以前は
                      // dimmed（半透明）にするだけで柄自体は見えてしまっており、
                      // 対戦相手の暗槓の中身が丸わかりになってしまっていた。
                      return (
                        <TileView
                          key={j}
                          code={slot.tile.code}
                          faceDown={slot.faceDown}
                          small
                          rotated={slot.rotated}
                          red={slot.tile.isRed}
                          style={zIndexStyle}
                        />
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
