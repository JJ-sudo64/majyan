import { useEffect, useState } from "react";

/** スマホ・タブレット（指で操作する端末）を縦に持っているか。PCの縦長ウィンドウは含めない。 */
const PORTRAIT_TOUCH = "(orientation: portrait) and (pointer: coarse)";

/**
 * このゲームは横向きの画面で遊ぶ作り（卓もメニューも横長の同じ比率）。縦に持っている
 * 間は「横にしてください」と知らせる。画面の回転を止めている人のために、閉じて
 * そのまま続けることもできる。ホーム画面に追加したアプリは最初から横向きで開く
 * （manifest.webmanifestのorientation）。
 */
export function RotateNotice() {
  const [portrait, setPortrait] = useState(() => window.matchMedia(PORTRAIT_TOUCH).matches);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(PORTRAIT_TOUCH);
    const update = () => setPortrait(query.matches);
    query.addEventListener("change", update);
    // 横向きに固定できる環境（ホーム画面に追加したアプリ等）では固定する。できなければ何もしない。
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    orientation.lock?.("landscape").catch(() => {});
    return () => query.removeEventListener("change", update);
  }, []);

  // 横に戻したら、次に縦にした時はまた知らせる。
  useEffect(() => {
    if (!portrait) setDismissed(false);
  }, [portrait]);

  if (!portrait || dismissed) return null;
  return (
    <div className="rotate-notice" role="dialog" aria-label="画面を横向きにしてください">
      <div className="rotate-notice__phone" aria-hidden="true" />
      <p className="rotate-notice__title">スマホを横向きにしてください</p>
      <p className="rotate-notice__text">このゲームは横向きの画面で遊びます。</p>
      <button type="button" className="rotate-notice__skip" onClick={() => setDismissed(true)}>
        縦のまま続ける
      </button>
    </div>
  );
}
