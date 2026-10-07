import React from "react";
import ReactDOM from "react-dom/client";
import { loadSharedTuning } from "./store/sharedTuningStorage.js";
import "./styles.css";

// カットイン一覧（?cutin-gallery）とその1コマ（?cutin-frame=…）、勝利台詞一覧
// （?quote-gallery）は確認用のページなので、ゲーム本体（App・ストア・調整値の
// 読み込み）は動かさない。
const params = new URLSearchParams(window.location.search);
if (params.has("admin")) {
  // 運営用の管理画面（AdminPage.tsx）。ゲーム本体は読み込まない。
  import("./components/AdminPage.js").then(({ AdminPage }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<AdminPage />);
  });
} else if (params.has("quote-gallery")) {
  import("./components/QuoteGallery.js").then(({ QuoteGallery }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<QuoteGallery />);
  });
} else if (params.has("cutin-gallery") || params.has("cutin-frame")) {
  import("./components/CutinGallery.js").then(({ CutinGallery, CutinFrame }) => {
    const frameCharacter = params.get("cutin-frame");
    ReactDOM.createRoot(document.getElementById("root")!).render(
      frameCharacter ? (
        <CutinFrame
          characterId={frameCharacter}
          kind={(params.get("kind") ?? "riichi") as "riichi" | "tsumo" | "ron" | "skill"}
          mode={params.get("mode") ?? "still"}
        />
      ) : (
        <CutinGallery />
      ),
    );
  });
} else {
  // 調整値ファイルを先に読み込んでから、ストアを含むAppを読み込む
  // （ストアは読み込まれた瞬間に保存値を読むため。sharedTuningStorage.ts参照）。
  loadSharedTuning()
    .then(() => import("./App.js"))
    .then(({ default: App }) => {
      ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    });
}

// ホーム画面に追加して遊べるように（PWA）。開発中(Vite)はキャッシュが邪魔になるので本番ビルドだけ。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("[majyan] サービスワーカーを登録できませんでした:", err));
  });
}
