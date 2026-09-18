import type { CSSProperties } from "react";
import type { TileCode } from "@majyan/core";
import { tileImageSrc, TILE_BACK_SRC, TILE_FRONT_SRC } from "../tileGlyph.js";

export interface Tile3DProps {
  code: TileCode;
  /** 伏せ牌（相手から見て裏向き）かどうか。TileViewと同じ意味。 */
  faceDown?: boolean;
  /** 赤ドラ牌かどうか（表向きの牌にのみ意味を持つ）。TileViewと同じ意味。 */
  red?: boolean;
  /** 縦の回転角度（度）。既定値-55はやや上から見下ろす角度。 */
  rx?: number;
  /** 横の回転角度（度）。既定値-20はやや斜めに構えた角度。 */
  ry?: number;
  /** 表示倍率。基準サイズは32×43px（.tile--smallと同じ実寸）。 */
  scale?: number;
  /** 牌の厚み(px、拡大前のローカル座標)。既定値8。 */
  thickness?: number;
  /** 側面の白いハイライト部分の幅(px、拡大前のローカル座標、固定値)。
      厚み(thickness)に対する割合ではなく固定pxにしているのは、厚みを
      絞った時に白い部分まで一緒に縮んでしまわないようにするため
      ——「緑の部分だけ薄くしたい」という要望に対応。既定値1.5。 */
  whiteWidth?: number;
  /** 牌の見た目の横幅の倍率（1で等倍）。3D的に箱の幅自体を変えるのでは
      なく、完成した見た目を2D的にそのまま横方向へ引き伸ばす/縮める
      （3Dの箱形状・回転角度には一切影響しない）。既定値1。 */
  aspectX?: number;
  /** 牌の見た目の縦幅の倍率（1で等倍）。同上、2D的な縦方向の伸縮。
      既定値1。 */
  aspectY?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * CSS 3D（`transform-style: preserve-3d`）で組んだ、実際に厚みのある麻雀牌。
 * 前面（絵柄）・背面（卓に接する側、常に無地の緑）・四方の側面、計6面すべてを
 * 持つ閉じた直方体で、どの角度に回しても中身が透けない。
 *
 * 元は独立したArtifactプロトタイプとして作り、CSS 3Dの閉じたキューブ構成
 * （ヒンジ回転＋translateZによる面の橋渡し、背面角の面取り+フィレット）を
 * 検証してからこのコンポーネントへ移植した。まだどの画面にも配線しておらず、
 * 再利用可能な部品として置いてあるだけの状態（上家/下家の伏せ牌に使う想定）。
 */
export function Tile3D({
  code,
  faceDown,
  red,
  rx = -55,
  ry = -20,
  scale = 4.4,
  thickness = 8,
  whiteWidth = 4.4,
  aspectX = 1,
  aspectY = 1,
  className,
  style,
}: Tile3DProps) {
  // 牌本体(3Dの箱)の自然サイズは常に32×43px固定。aspectX/aspectYはこの
  // 3D形状には一切触れず、完成した見た目(.tile3d-scene、3D描画済みで
  // 平坦化された結果)を最後に2D的にscaleX/scaleYで引き伸ばすだけにする
  // ——3Dの箱の高さ自体を変える方式も試したが、遠近法の性質上、縦に
  // 伸ばすほど元々あった台形の傾きが縦幅に対して相対的に小さくなり、
  // 「伸びる」のではなく「起き上がる(回転する)」ように見えてしまう
  // 問題があったため、2D的な引き伸ばし方式に変更した。
  const baseW = 32;
  const baseH = 43;

  // 外側(tile3d-outer)のレイアウト上の占有サイズ(width/height)はscaleの
  // みで決め、aspectX/aspectYでは変えない。手牌のように何枚も縦に並べる
  // 場面では、この占有サイズがそのままflexレイアウトの積み上げ量になる
  // ため、aspectYを1枚ごとに含めてしまうと13枚分積み重なって「牌1枚では
  // なく手牌全体の長さ」が伸び縮みするように見えてしまう不具合があった
  // （実機で指摘・確認済み）。aspectX/Yによる見た目の伸縮は下のtransform
  // (scaleX/scaleY)だけが担い、transformはレイアウトサイズに影響しない
  // ため、はみ出た分は（元々牌同士が大きく重なる設計なので）隣の牌と
  // 重なるだけで、他の牌の位置は一切動かない。
  //
  // perspectiveは内側(tile3d-scene)側に置き、そのサイズは常に牌本来の
  // 等倍(32×43px)のまま固定する——ここをscaleに合わせて広げてしまうと、
  // perspective-origin（既定50% 50%＝要素自身の中心）が牌の実際の中心
  // からズレて、scaleが大きいほど回転角度がプロトタイプと違って見える
  // 形で歪んでしまう（実際にscale=4.4でゲーム内・プロトタイプを並べて
  // 検証し発覚した不具合）。
  const outerStyle = {
    ...style,
    width: `calc(${baseW}px * ${scale})`,
    height: `calc(${baseH}px * ${scale})`,
    "--tile3d-w": `${baseW}px`,
    "--tile3d-h": `${baseH}px`,
    "--tile3d-aspect-x": aspectX,
    "--tile3d-aspect-y": aspectY,
  } as CSSProperties;

  const tileStyle = {
    "--tile3d-rx": `${rx}deg`,
    "--tile3d-ry": `${ry}deg`,
    "--tile3d-scale": scale,
    "--tile3d-thick": `${thickness}px`,
    "--tile3d-white-w": `${whiteWidth}px`,
  } as CSSProperties;

  return (
    <div className={["tile3d-outer", className].filter(Boolean).join(" ")} style={outerStyle}>
      <div className="tile3d-scene">
        <div className="tile3d" style={tileStyle}>
          <div className="tile3d__panel tile3d__front">
            {faceDown ? (
              <img className="tile3d__img tile3d__img--back" src={TILE_BACK_SRC} alt="" draggable={false} />
            ) : (
              <>
                <img className="tile3d__img tile3d__img--base" src={TILE_FRONT_SRC} alt="" draggable={false} />
                <img className="tile3d__img tile3d__img--face" src={tileImageSrc(code, red)} alt="" draggable={false} />
              </>
            )}
          </div>
          <div className="tile3d__panel tile3d__rear-fillet tile3d__rear-fillet--tl" />
          <div className="tile3d__panel tile3d__rear-fillet tile3d__rear-fillet--tr" />
          <div className="tile3d__panel tile3d__rear-fillet tile3d__rear-fillet--br" />
          <div className="tile3d__panel tile3d__rear-fillet tile3d__rear-fillet--bl" />
          <div className="tile3d__panel tile3d__rear" />
          <div className="tile3d__panel tile3d__edge-top" />
          <div className="tile3d__panel tile3d__edge-bottom" />
          <div className="tile3d__panel tile3d__edge-left" />
          <div className="tile3d__panel tile3d__edge-right" />
        </div>
      </div>
    </div>
  );
}
