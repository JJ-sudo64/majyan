import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tuningFilePlugin } from "./tuningFilePlugin";

export default defineConfig({
  plugins: [react(), tuningFilePlugin()],
  server: {
    port: 5173,
    // ポート5173が塞がっている時に黙って別ポートへ逃げると、その別
    // ポートはブラウザから見て別オリジンになりlocalStorage（Tile3D調整
    // 値の保存先）が空の別物になる——「知らないうちに違うポートで開いて
    // いて設定が消えたように見えた」事故が実際に起きたため、その場合は
    // 自動フォールバックせず起動時にエラーで教えるようにする。
    strictPort: true,
    // 調整値ファイル(tuning/、tuningFilePlugin.ts参照)は調整のたびに書き
    // 換わるので、ファイル監視によるリロードの対象にしない。
    watch: { ignored: ["**/tuning/**"] },
    // ネット対戦サーバー(packages/server、npm run dev:server)への中継（対局=/ws、アカウント=/api）。
    // 画面は同じオリジンの /ws につなぐだけでよく、本番でも同じ形にできる。
    proxy: {
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/api": { target: "http://localhost:8787" },
    },
  },
});
