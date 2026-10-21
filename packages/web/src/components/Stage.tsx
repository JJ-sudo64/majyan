import type { CSSProperties, ReactNode } from "react";
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
/**
 * メニューは卓より小さいキャンバスに描いて、そのぶん大きく拡大して見せる（比率は卓と同じ）。
 * 卓と同じ大きさのままだと、横向きスマホで文字が半分ほどになって読みにくいため。
 * 値を大きくするほどメニュー全体が大きくなる（そのぶん1画面に入る量は減る）。
 */
export const MENU_MAGNIFY = 1.25;
const MENU_WIDTH = Math.round(STAGE_WIDTH / MENU_MAGNIFY);
const MENU_HEIGHT = Math.round(STAGE_HEIGHT / MENU_MAGNIFY);

export function Stage({ children, menu = false }: { children: ReactNode; /** メニュー画面を描く（卓と同じ大きさのキャンバスに、同じ縮め方で出す）。 */ menu?: boolean }) {
  const width = menu ? MENU_WIDTH : STAGE_WIDTH;
  const height = menu ? MENU_HEIGHT : STAGE_HEIGHT;
  const { containerRef, scale } = useFitScale(width, height);

  return (
    <div className={`stage${menu ? " stage--menu" : ""}`} ref={containerRef}>
      <div className="stage__canvas" style={
          {
            width,
            height,
            zoom: scale,
            // 画面の幅・高さの代わりにキャンバスの大きさを使う（styles.cssの--app-vw/--app-vh）。
            // メニューだけでなく卓でも設定する。vh(ウィンドウ基準)のままだと、キャンバスが
            // zoomで縮んでいる時（ウィンドウが1392x748より小さい時）に、zoomの内側で
            // さらに縮んで二重に小さくなる——例えば結果画面の高さの上限が画面の約80%に
            // なり、全員聴牌の流局でスクロールが出ていた。
            "--app-vw": `${width / 100}px`,
            "--app-vh": `${height / 100}px`,
          } as CSSProperties
        }>
        {children}
      </div>
    </div>
  );
}
