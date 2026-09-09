import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { DiscardedTile } from "@majyan/core";
import { TileView } from "./TileView.js";
import { STAGE_WIDTH } from "./Stage.js";

// 川の表示枠は横6枚×3段(18枚)分しか確保していないため、CSSのoverflowでの
// クリップに頼らずここで頭打ちにする。それ以上は溢れて隣と被ってしまうため。
const MAX_VISIBLE = 18;
// 1段あたりの牌数（styles.cssの.discard-pile幅=214pxが通常牌6枚+gap5本分な
// のに対応、「6枚×3段」参照）。段番号・段内の位置からz-indexを組み立てる
// のに使う（下のtileZIndex参照）。
const TILES_PER_ROW = 6;

// 河の牌は全てのタイル（対面・自分は左右に並ぶだけで奥行きの差がなく、
// 上家・下家は段の中で奥から手前へ順に並ぶ）に同じ張り出し量の帯を付ける
// （styles.cssの.tile--small等参照）。段内で奥行きの差がある上家・下家は、
// 実際の卓と同じく手前の牌に厚みが隠れて見えなくなるよう、z-indexだけで
// 前後関係を作る（間隔やCSSのbox-shadowの有無はここでは一切変えない）。
//
// 上家は段の中で後から置かれた牌ほど画面下(=手前)に来るため、段内の
// 位置(i%6)が大きいほど手前。下家はローカル座標の回転方向が逆で、段内の
// 位置が小さいほど手前（実測で確認済み）。対面・自分は段内の牌同士に
// 奥行きの差がないため0固定でよい。
function withinRowNearness(direction: RiverDirection, positionInRow: number): number {
  if (direction === "left") return positionInRow;
  if (direction === "right") return TILES_PER_ROW - 1 - positionInRow;
  return 0;
}

// 段（1段目/2段目/3段目）自体の奥行きは対面と自分とで逆になる：対面は
// 自分（＝カメラ）から見て奥にいる相手なので、河は相手からこちらへ、
// つまり1段目が一番手前・後の段ほど奥へ育つ。自分の河はこちらの手前へ
// そのまま育つため、逆に後の段ほど画面下＝手前に来る（実測で確認済み。
// 上家・下家は段ごとに横へ張り出す構造で段同士は重ならないため、
// どちらの向きでも見た目には影響しない）。
function rowNearness(direction: RiverDirection, rowIndex: number): number {
  return direction === "human" ? rowIndex : -rowIndex;
}

// 段番号の差を最優先し、その中で段内の奥行き差(0〜5)で微調整する合成
// z-index。段の差が必ず段内の差より効くよう、段番号には段内レンジ(6)より
// 大きい係数(10)を掛けておく。
function tileZIndex(direction: RiverDirection, i: number): number {
  const rowIndex = Math.floor(i / TILES_PER_ROW);
  const positionInRow = i % TILES_PER_ROW;
  return rowNearness(direction, rowIndex) * 10 + withinRowNearness(direction, positionInRow);
}

export type RiverDirection = "top" | "left" | "right" | "human";

// direction→そのプレイヤー番号。OpponentArea/Handが手牌の実DOMに
// data-hand-anchor={player} を振っているので、ここから逆引きして
// 「本当の手牌の位置」を計測できるようにする。
const DIRECTION_TO_PLAYER: Record<RiverDirection, number> = { human: 0, right: 1, top: 2, left: 3 };

// 牌には何も印を残さず、切った瞬間の入場アニメーションの始点だけで
// ツモ切り／手出しの違いを見せる：
// - ツモ切り＝ツモった牌をそのまま切った＝実際の手牌の位置を計測して、
//   そこから河へ運ばれてきたように見せる（下のuseLayoutEffect参照）。
//   「手牌の端に置かれてから捨てられる」感を出すため、最初はその位置で
//   一瞬静止してから河の定位置へ運ぶ（tile-slide-in-tsumogiri）。
// - 手出し＝一度手牌に加えてから中ほどの牌を選んで切った＝手牌の方向
//   （側軸のずれなし＝ほぼ正面）から短い距離で入ってくる。
//
// 手出し側の主軸・側軸は画面上で見たときの向き。.discard-pile自体が
// CSS側で対面ごとに丸ごと回転している（top:180deg / left:90deg /
// right:-90deg、human:回転なし。styles.cssの.river--*参照）ため、
// 個々の牌のtranslateはその回転より内側＝回転前のローカル座標で効く。
// 「画面上は主軸＝手牌方向」という結果になるよう、あらかじめ各対面の
// 回転角ぶん逆回転させた値をここに直接書いている。
const RIVER_PRIMARY: Record<RiverDirection, [number, number]> = {
  human: [0, 1], // 回転なし
  top: [0, 1], // 180deg分を打ち消す
  left: [0, 1], // 90deg分を打ち消す
  right: [0, 1], // -90deg分を打ち消す
};

const TEGIRI_PRIMARY = 12;

function tegiriOffset(direction: RiverDirection): CSSProperties {
  const [x, y] = RIVER_PRIMARY[direction];
  return { "--enter-x": `${x * TEGIRI_PRIMARY}px`, "--enter-y": `${y * TEGIRI_PRIMARY}px` } as CSSProperties;
}

// .discard-pile自体のCSS上の回転角（styles.cssの.river--*参照）。
const DISCARD_PILE_ROTATION_DEG: Record<RiverDirection, number> = { human: 0, top: 180, left: 90, right: -90 };

// getBoundingClientRectで測った「画面上で見たときの」dx/dyを、
// .discard-pile自体の回転より内側＝回転前のローカル座標のtranslateに
// 変換する。screen = R(θ)・local（θはCSSのrotate、時計回り正）なので、
// local = R(θ)^-1・screen = R(-θ)・screen。
function toLocalDelta(direction: RiverDirection, screenDx: number, screenDy: number): [number, number] {
  const rad = (-DISCARD_PILE_ROTATION_DEG[direction] * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cos * screenDx - sin * screenDy, sin * screenDx + cos * screenDy];
}

export function DiscardPile({
  discards,
  direction,
  callTargetTileId,
  frozen,
  onTileClick,
  selectedTileId,
}: {
  discards: DiscardedTile[];
  direction: RiverDirection;
  /** ロン/チー/ポン/カンの対象になっている牌のid。一致する牌を光らせて
      「どの牌に対して鳴こうとしているか」を分かりやすくする。 */
  callTargetTileId?: string;
  /** 必殺技「時間停止」発動中、発動者以外の河をグレーアウトする演出用。
      発動者本人の河はfalse（通常表示のまま）のまま渡される。 */
  frozen?: boolean;
  /** ミオの必殺技「取り返し」選択中: 河の牌をクリック可能にする（自分の河のみ渡される）。 */
  onTileClick?: (tileId: string) => void;
  /** 「取り返し」選択中に既に選んだ牌のid（選択中の見た目強調用）。 */
  selectedTileId?: string;
}) {
  // 鳴かれた牌は実物の麻雀と同じく、鳴いた側の副露に移ったものとして河からは
  // 完全に取り除く（以前は半透明のまま河に残していたが「実際の麻雀と見た目が
  // 違って不自然」との指摘のため）。
  const notCalledAway = discards.filter((d) => !d.calledAway);
  const visible = notCalledAway.length > MAX_VISIBLE ? notCalledAway.slice(notCalledAway.length - MAX_VISIBLE) : notCalledAway;
  const latestTileRef = useRef<HTMLButtonElement>(null);
  // 「一番最後に切られた牌」はdiscards（鳴きによる除外前）の末尾で判定する。
  // 鳴かれてvisibleから消えたのがちょうど直近の1枚だった場合、繰り上がった
  // visible配列の末尾（実際はもっと古い牌）を最新と誤判定してしまい、
  // とっくに河に馴染んでいた牌へ入場アニメーションが今さら再生される
  // 不具合になるため、visibleの配列位置ではなく牌のidそのもので照合する。
  const trueLatestId = discards.length > 0 ? discards[discards.length - 1]!.tile.id : undefined;
  const latest = visible.find((d) => d.tile.id === trueLatestId);

  // ツモ切り牌だけ、実際の手牌の位置を計測してそこを入場アニメーションの
  // 起点にする。「手牌の端に置かれた牌がそのまま河へ運ばれる」という
  // 見た目を作るには、スタイル演算だけの見立てでは不十分で、本物の座標が
  // 要る。useLayoutEffectはブラウザが描画する前に同期実行されるため、
  // ここで--enter-x/yを書き換えても入場アニメーションが古い値のまま
  // 一瞬再生されてしまうことはない。
  useLayoutEffect(() => {
    if (!latest?.isTsumogiri) return;
    const tileEl = latestTileRef.current;
    if (!tileEl) return;
    const handEl = document.querySelector<HTMLElement>(`[data-hand-anchor="${DIRECTION_TO_PLAYER[direction]}"]`);
    const stageEl = document.querySelector<HTMLElement>(".stage__canvas");
    if (!handEl || !stageEl) return;
    const scale = stageEl.getBoundingClientRect().width / STAGE_WIDTH || 1;

    const tileRect = tileEl.getBoundingClientRect();
    const handRect = handEl.getBoundingClientRect();
    const tileCenterX = tileRect.left + tileRect.width / 2;
    const tileCenterY = tileRect.top + tileRect.height / 2;
    // 「手牌の端（ツモった牌がある側＝OpponentArea/Handでtile--drawnを
    // 付けている側）」に寄せた位置を起点にする。手牌が横長（人間/対面）
    // なら左右どちらかの端寄り、縦長（上家/下家）なら上下どちらかの端寄り。
    // どちらの端かは「実際にtile--drawnがどちら側に描画されるか」で決まり、
    // これは.opponent-hand-back__innerの回転方向（styles.css参照）に依存
    // する: DOM順で最後（＝tile--drawn）はpre-rotationで一番右にあり、
    // rotate(90deg)（上家）だと画面下、rotate(-90deg)（下家）だと画面上へ
    // 移る。対面は以前「自分と正対している＝鏡写し」としてrow-reverseで
    // 左右反転させていたが、萬子/筒子/索子の並びが自分の手牌と逆向きで
    // 見づらいとの指摘のためその反転をやめた。対面も人間の自分の手牌と
    // 同じくDOM順そのまま＝右端がtile--drawn側になる。
    // 以前はhandRect.width >= handRect.heightで横長/縦長を判定していたが、
    // 上家・下家(.opponent-hand-back)の高さは鳴きで手牌が減った分だけ
    // 動的に縮むようになった（OpponentArea.tsx参照）ため、手牌がかなり
    // 少ない終盤（例: 4副露+単騎待ちで残り1枚）だと高さが横幅(45px)を
    // 下回り、この比較が誤って反転してしまうことがあった。反転すると
    // 入場アニメーションの起点が全く別の場所に飛び、捨て牌がぶれて見える。
    // 横長/縦長は手牌の実測サイズではなく、対面の向き（direction）だけで
    // 一意に決まる（top/human=横長、left/right=縦長）ため、そちらで判定する。
    const horizontal = direction === "top" || direction === "human";
    const anchorX = horizontal ? handRect.right - handRect.height / 2 : handRect.left + handRect.width / 2;
    const anchorY = horizontal
      ? handRect.top + handRect.height / 2
      : direction === "left"
        ? handRect.bottom - handRect.width / 2
        : handRect.top + handRect.width / 2;

    // ここまでのdx/dyは「画面上で見たときの」向き。.discard-pile自体が
    // 対面ごとに丸ごと回転しているため（top:180deg/left:90deg/right:-90deg,
    // styles.cssの.river--*参照）、translateは回転より内側＝回転前の
    // ローカル座標で効く。これを変換せずそのまま入れると、対面(top)
    // では見た目が180度反転し、下家の方向から飛んできたように見える
    // 不具合になっていた。
    const screenDx = (anchorX - tileCenterX) / scale;
    const screenDy = (anchorY - tileCenterY) / scale;
    const [dx, dy] = toLocalDelta(direction, screenDx, screenDy);
    tileEl.style.setProperty("--enter-x", `${dx}px`);
    tileEl.style.setProperty("--enter-y", `${dy}px`);
  }, [latest, direction]);

  return (
    <div className={`discard-pile${frozen ? " table__frozen" : ""}`}>
      {visible.map((d, i) => {
        const isLatest = d.tile.id === trueLatestId;
        const isLatestTsumogiri = isLatest && d.isTsumogiri;
        const style: CSSProperties = {
          zIndex: tileZIndex(direction, i),
          ...(isLatest && !isLatestTsumogiri ? tegiriOffset(direction) : undefined),
        };
        return (
          <TileView
            key={d.tile.id}
            ref={isLatest ? latestTileRef : undefined}
            code={d.tile.code}
            small
            rotated={d.isRiichiDeclaration}
            red={d.tile.isRed}
            callTarget={d.tile.id === callTargetTileId}
            selected={d.tile.id === selectedTileId}
            slideIn={isLatest ? (d.isTsumogiri ? "tsumogiri" : "default") : undefined}
            style={style}
            onClick={onTileClick ? () => onTileClick(d.tile.id) : undefined}
          />
        );
      })}
    </div>
  );
}
