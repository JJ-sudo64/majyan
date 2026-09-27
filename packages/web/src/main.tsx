import React from "react";
import ReactDOM from "react-dom/client";
import { loadSharedTuning } from "./store/sharedTuningStorage.js";
import "./styles.css";

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
