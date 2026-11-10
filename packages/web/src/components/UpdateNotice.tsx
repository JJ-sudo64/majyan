import { useEffect, useState } from "react";
import { useGameStore } from "../store/gameStore.js";

/** サーバーの版を確かめる間隔。 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 開きっぱなしの画面が古くなったことを知らせる。ビルドごとの版番号（version.json）を
 * 定期的に取りに行き、この画面に埋め込まれた版と違えば「新しい版があります」と出す。
 * 対局中に読み込み直すと入り直しの情報が消えるので、対局が終わるまでは出さない。
 */
export function UpdateNotice() {
  const inMatch = useGameStore((s) => s.match !== null);
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    // 開発中（Vite）は版番号が無いので何もしない。
    if (!import.meta.env.PROD) return;
    let stopped = false;
    async function check() {
      try {
        // サービスワーカーやブラウザのキャッシュに古い返事を返されないよう、毎回違うURLで取る。
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { build?: unknown };
        if (!stopped && typeof data.build === "string" && data.build !== __APP_BUILD__) setOutdated(true);
      } catch {
        // つながらない時は何もしない（次の確認で試す）。
      }
    }
    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!outdated || inMatch) return null;
  return (
    <div className="update-notice" role="status">
      <span>新しい版があります</span>
      <button type="button" onClick={() => window.location.reload()}>
        更新する
      </button>
    </div>
  );
}
