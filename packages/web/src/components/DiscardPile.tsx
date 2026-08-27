import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { DiscardedTile } from "@majyan/core";
import { TileView } from "./TileView.js";
import { STAGE_WIDTH } from "./Stage.js";

// 川の表示枠は横6枚×3段(18枚)分しか確保していないため、CSSのoverflowでの
// クリップに頼らずここで頭打ちにする。それ以上は溢れて隣と被ってしまうため。
const MAX_VISIBLE = 18;

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

export function DiscardPile({ discards, direction }: { discards: DiscardedTile[]; direction: RiverDirection }) {
  const visible = discards.length > MAX_VISIBLE ? discards.slice(discards.length - MAX_VISIBLE) : discards;
  const latestIndex = visible.length - 1;
  const latestTileRef = useRef<HTMLButtonElement>(null);
  const latest = latestIndex >= 0 ? visible[latestIndex] : undefined;

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
    // 移る。対面は自分と正対している＝鏡写しの関係なので、対面自身の右端
    // （row-reverseで画面左に描画）を使う。人間の自分の手牌は鏡関係が無い
    // のでそのまま右端。
    const horizontal = handRect.width >= handRect.height;
    const anchorX = horizontal
      ? direction === "top"
        ? handRect.left + handRect.height / 2
        : handRect.right - handRect.height / 2
      : handRect.left + handRect.width / 2;
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
    <div className="discard-pile">
      {visible.map((d, i) => {
        const isLatest = i === latestIndex;
        const isLatestTsumogiri = isLatest && d.isTsumogiri;
        return (
          <TileView
            key={d.tile.id}
            ref={isLatest ? latestTileRef : undefined}
            code={d.tile.code}
            small
            rotated={d.isRiichiDeclaration}
            dimmed={d.calledAway}
            red={d.tile.isRed}
            slideIn={isLatest ? (d.isTsumogiri ? "tsumogiri" : "default") : undefined}
            style={isLatest ? (isLatestTsumogiri ? undefined : tegiriOffset(direction)) : undefined}
          />
        );
      })}
    </div>
  );
}
