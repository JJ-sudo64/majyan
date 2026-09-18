import { useEffect, useRef, useState } from "react";

/**
 * じゃんたま等と同じ「固定比率キャンバスをレターボックスで一律縮小」方式のためのフック。
 * ref を付けた要素自身のサイズを計測し、(naturalWidth, naturalHeight) の
 * デザインキャンバスをその中に収めるための scale を返す。
 *
 * 個々の要素の幅/高さを別々に画面サイズへ追従させると、中の固定pxレイアウト
 * （河・八角形など）の縦横比が崩れて重なる。キャンバス全体を一つの剛体として
 * 一律スケールすることで、画面サイズに関わらず内部の比率・間隔が常に保たれる。
 */
export function useFitScale(naturalWidth: number, naturalHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // scaleを el.clientWidth/Height からの生の除算結果（画面サイズが1px
    // 変わるだけで毎回違う値になる、ほぼ無限精度の浮動小数点数）のまま使うと、
    // この上にさらに.tableの固定zoom(1.46)、卓中央の点数バッジ(.center-board)
    // のtranslate/translateZ/rotateXが何重にも重なる箇所で、画面サイズが
    // 変わるたびに異なる端数がネストしたzoom/transformの丸め誤差として
    // 蓄積し、「点数表示が画面サイズによって微妙にズレる」不具合の原因に
    // なっていた（指摘により）。scale自体を粗いステップ(0.5%刻み)へ丸めて
    // 取りうる値の種類を大幅に減らすことで、この端数のばらつきを抑える。
    // ステップ幅はSTAGE_WIDTH(1392px)基準で最大でも±3.5px程度のフィット
    // 誤差にしかならず、レターボックスの余白としては見た目に影響しない。
    const SCALE_STEP = 200; // 1/200 = 0.5%刻み
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const raw = Math.min(w / naturalWidth, h / naturalHeight);
      const next = Math.round(raw * SCALE_STEP) / SCALE_STEP;
      setScale(next > 0 ? next : 1);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [naturalWidth, naturalHeight]);

  return { containerRef, scale };
}
