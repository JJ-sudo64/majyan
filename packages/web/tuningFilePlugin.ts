import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";

/**
 * 調整値(zustand persistの保存データ)をブラウザのlocalStorageではなく
 * リポジトリ内のファイル(packages/web/tuning/<ストア名>.json)に保存する
 * ための開発サーバー用API。localStorageはブラウザごとに別物なので、
 * Edgeで詰めた調整がAvastでは反映されない、という問題をなくすのが目的。
 * クライアント側は src/store/sharedTuningStorage.ts。
 *
 *   GET /__tuning            → { "<ストア名>": "<保存データ生文字列>", ... }
 *   PUT /__tuning/<ストア名>  → ファイルへ保存（?onlyIfMissing=1なら既存時409）
 */
// MAJYAN_TUNING_DIRは動作確認用（本物の調整値ファイルに触れずに試すため）。
export const TUNING_DIR = process.env.MAJYAN_TUNING_DIR ?? fileURLToPath(new URL("./tuning", import.meta.url));
const NAME_RE = /^[a-z0-9-]+$/;

function readAll(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(TUNING_DIR)) return out;
  for (const file of fs.readdirSync(TUNING_DIR)) {
    if (!file.endsWith(".json")) continue;
    const name = file.slice(0, -".json".length);
    if (!NAME_RE.test(name)) continue;
    out[name] = fs.readFileSync(path.join(TUNING_DIR, file), "utf8");
  }
  return out;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const middleware: Connect.NextHandleFunction = (req, res, next) => {
  const url = new URL(req.url ?? "", "http://localhost");
  if (!url.pathname.startsWith("/__tuning")) return next();
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET" && url.pathname === "/__tuning") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(readAll()));
    return;
  }

  const name = url.pathname.slice("/__tuning/".length);
  if (req.method === "PUT" && NAME_RE.test(name)) {
    readBody(req)
      .then((body) => {
        // 壊れたデータでファイルを上書きしないよう、JSONとして読めるものだけ受け付ける
        JSON.parse(body);
        const file = path.join(TUNING_DIR, `${name}.json`);
        if (url.searchParams.get("onlyIfMissing") === "1" && fs.existsSync(file)) {
          res.statusCode = 409;
          res.end("exists");
          return;
        }
        fs.mkdirSync(TUNING_DIR, { recursive: true });
        // 書き込み途中で落ちても元ファイルが半端に壊れないよう、一時ファイル経由で置き換える
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(JSON.parse(body), null, 2) + "\n", "utf8");
        fs.renameSync(tmp, file);
        res.statusCode = 204;
        res.end();
      })
      .catch(() => {
        res.statusCode = 400;
        res.end("invalid");
      });
    return;
  }

  res.statusCode = 404;
  res.end();
};

export function tuningFilePlugin(): Plugin {
  return {
    name: "majyan-tuning-file",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
