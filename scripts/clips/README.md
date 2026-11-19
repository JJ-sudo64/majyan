# 実プレイ縦動画の録画（必殺技カットイン）
- 準備: 一時フォルダに `npm i puppeteer-core@23`、`cd packages/web && npx vite --port 5199` を起動。
- rec.mjs <id> <outDir> [riichi]: ストアを操作して録画（CPUのカードは外す。matchとfullMatchの両方のゲージを満タンにしてから0.7秒後に発動）。リーチ発動型(deagari/jin/nyanjiro/ren)は riichi を付ける。
- build.mjs <id> <recDir> <caps.json> <out.mp4>: 5秒・1080x1920に整形（字幕は caps.json、ボイスは public/voices）。
- batch.sh <scratchdir>: 13人分を順番に。終わったらVite(5199)と majyan-pp 付きChromeを止める。
- 注意: sed で正規表現を書き換えない（\s が s に化けた）。
