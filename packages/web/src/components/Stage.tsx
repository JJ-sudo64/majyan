import type { ReactNode } from "react";
import { useFitScale } from "../hooks/useFitScale.js";

/**
 * デザイン基準のキャンバスサイズ。ここを基準にレイアウトの各要素をpxで組んでいる。
 * 1920x1080にすると、ブラウザのツールバー等を差し引いた実際の表示領域は
 * ほぼ常にこれより低くなり、常に縮小されて全体が小さく見えてしまっていた。
 * 実際の検証環境（1568x707〜1904x859）で無理なく収まるサイズを基準にし、
 * 一般的な画面では等倍(scale=1)に近い状態で表示されるようにする。
 *
 * 文字・牌が全体的に小さく見づらいとの指摘を受け、縦横比は変えずに
 * キャンバス自体を約15%小さくした（＝同じ画面幅/高さに対する拡大率が
 * その分上がる）。中の要素は全てこのキャンバス基準の固定pxのままなので、
 * 個々のサイズや間隔の比率・重なり検証結果に影響を与えず、全体が一律に
 * 大きく表示される。 */
export const STAGE_WIDTH = 1392;
export const STAGE_HEIGHT = 748;

/**
 * じゃんたま同様、卓の縦横比を常に一定に保つための土台。
 * 画面が縦に狭ければ左右に、逆に縦長なら上下に余白（レターボックス）ができる形で
 * 1920x1080のキャンバスを一律スケールする。中のレイアウトはこのキャンバス基準の
 * 固定pxのままでよく、画面サイズごとに個別調整する必要がない。
 *
 * 縮小には transform: scale() ではなく zoom を使う。transform: scale() は
 * コンポジタが「描画済みのビットマップを後から引き伸ばす」形になるため、
 * 特にSVG(<img src="*.svg">)がその引き伸ばし前の解像度でラスタライズ
 * キャッシュされたままになりやすく、牌画像・回転させた点数表示・河など
 * 卓のあちこちが縮尺次第でぼやけて見える不具合の温床になっていた
 * （子要素側で個別にbackface-visibility等の補正を積み重ねてもキリがない）。
 * zoomはレイアウト計算そのものを縮尺後のサイズで行う（＝実際にその解像度で
 * 描き直す）ため、この種のぼやけがそもそも起こらない。
 */
export function Stage({ children }: { children: ReactNode }) {
  const { containerRef, scale } = useFitScale(STAGE_WIDTH, STAGE_HEIGHT);

  return (
    <div className="stage" ref={containerRef}>
      <div className="stage__canvas" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, zoom: scale }}>
        {children}
      </div>
    </div>
  );
}
