/**
 * 本番用: ビルド済みの画面（packages/web/dist）をこのサーバーから配る。
 * 画面とWebSocket(/ws)を同じオリジン・同じポートで出せるので、置き場所が
 * どこでも（VPS・Render・Fly.io等）サーバー1つ起動するだけで遊べる。
 * 開発中はVite(5173)が画面を配るので、distが無ければ何もしない。
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

export function createStaticHandler(rootDir: string): ((req: IncomingMessage, res: ServerResponse) => void) | null {
  const root = resolve(rootDir);
  if (!existsSync(join(root, "index.html"))) return null;

  function send(res: ServerResponse, filePath: string, status = 200) {
    const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    // Viteがファイル名にハッシュを付けるassets/配下は長くキャッシュさせ、
    // index.html等は毎回確認させる（更新がすぐ届くように）。
    const immutable = filePath.startsWith(join(root, "assets") + sep);
    res.writeHead(status, {
      "Content-Type": type,
      "Content-Length": statSync(filePath).size,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(res);
  }

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    // ../ 等でdistの外を読ませない。
    const filePath = normalize(join(root, pathname));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      send(res, filePath);
      return;
    }
    // 拡張子の無いパス（?cutin-gallery等の画面切り替えはクエリなので通常は来ない）は
    // 画面本体を返す。拡張子付きで見つからないものは素直に404にする。
    if (!extname(pathname)) {
      send(res, join(root, "index.html"));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
  };
}
