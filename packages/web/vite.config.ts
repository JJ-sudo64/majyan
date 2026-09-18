import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // ポート5173が塞がっている時に黙って別ポートへ逃げると、その別
    // ポートはブラウザから見て別オリジンになりlocalStorage（Tile3D調整
    // 値の保存先）が空の別物になる——「知らないうちに違うポートで開いて
    // いて設定が消えたように見えた」事故が実際に起きたため、その場合は
    // 自動フォールバックせず起動時にエラーで教えるようにする。
    strictPort: true,
  },
});
