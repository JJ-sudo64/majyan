/**
 * 画面の向き。このゲームは横向きの画面で遊ぶ作り（卓もメニューも横長の同じ比率）。
 *
 * スマホ・タブレット（指で操作する端末）を縦に持っている時は、#root を90度回して
 * 横向きに描く。持っている人が端末を横に倒せば、そのまま正しい向きで見える
 * （端末の自動回転が効いて画面が横向きになれば、回すのをやめて普通に描く）。
 * PCの縦長ウィンドウは回さない。
 *
 * #root の中は常に「横向きの画面」として扱える:
 * - 幅・高さはCSSの --app-vw / --app-vh（1/100）で取る（vw/vhは回す前の画面のもの）
 * - 画面上の位置を測る時は getBoundingClientRect の代わりに viewRect を使う
 * - document.body へ出していた部品（Portal）は portalRoot() の中へ出す
 */

let rotated = false;
/** 回す前の画面の幅（回している時、回した後の高さになる）。 */
let screenWidth = 0;
let viewWidth = 0;
let viewHeight = 0;

/** #root を今の画面に合わせる。main.tsx がゲーム本体を描く前に1回呼ぶ。 */
export function initOrientation(): void {
  const root = document.getElementById("root");
  if (!root) return;
  const coarse = window.matchMedia("(pointer: coarse)");
  const apply = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    rotated = coarse.matches && h > w;
    screenWidth = w;
    viewWidth = rotated ? h : w;
    viewHeight = rotated ? w : h;
    root.style.position = "fixed";
    root.style.top = "0";
    root.style.left = "0";
    root.style.width = `${viewWidth}px`;
    root.style.height = `${viewHeight}px`;
    root.style.transformOrigin = "top left";
    // 右へ90度回し、回した後の左上が画面の左上に来るようにずらす。
    root.style.transform = rotated ? "rotate(90deg) translateY(-100%)" : "";
    root.style.setProperty("--app-vw", `${viewWidth / 100}px`);
    root.style.setProperty("--app-vh", `${viewHeight / 100}px`);
    root.classList.toggle("app-rotated", rotated);
  };
  apply();
  window.addEventListener("resize", apply);
  coarse.addEventListener("change", apply);
  // 横向きに固定できる環境（ホーム画面に追加したアプリ等）では固定する。できなければ何もしない。
  const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
  orientation?.lock?.("landscape").catch(() => {});
}

export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * 要素の位置と大きさを、#root の中（横向きの画面）の座標で返す。回していない時は
 * getBoundingClientRect と同じ。回している時は、画面上の点(X, Y)が #root の中の
 * (Y, 画面の幅 − X) に当たる。
 */
export function viewRect(el: Element): ViewRect {
  const r = el.getBoundingClientRect();
  if (!rotated) return r;
  const left = r.top;
  const top = screenWidth - r.right;
  return { left, top, width: r.height, height: r.width, right: left + r.height, bottom: top + r.width };
}

/** 横向きの画面としての高さ（px）。 */
export function viewportHeight(): number {
  return viewHeight || window.innerHeight;
}

/** document.body の代わりにPortalを出す先。#root の中なら一緒に回る。 */
export function portalRoot(): HTMLElement {
  return document.getElementById("root") ?? document.body;
}
