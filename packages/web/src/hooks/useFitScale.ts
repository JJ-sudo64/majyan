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

    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const next = Math.min(w / naturalWidth, h / naturalHeight);
      setScale(next > 0 ? next : 1);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [naturalWidth, naturalHeight]);

  return { containerRef, scale };
}
