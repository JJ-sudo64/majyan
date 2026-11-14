#!/usr/bin/env node
/**
 * 公式ページ（packages/web/public/about/index.html）を、Cloudflare Pages などに置ける形の
 * フォルダ一式（official-site/）にまとめる。ゲーム本体（Fly）とは別の場所に載せるためのもの。
 *
 * 使い方:  node scripts/build-official-site.mjs
 *   環境変数（省略可）:
 *     SITE_URL  公式ページの住所（既定 https://janhai.maxplantlabs.com）。about/index.html の canonical 等と揃える。
 *     GAME_URL  ゲーム本体の住所（既定 https://play-janhai.maxplantlabs.com）。「今すぐプレイ」の行き先。
 *
 * やること:
 *   1. ページ内の「ゲームへのリンク（/）」を GAME_URL に、「/about/…」の素材の場所を「/…」に直す。
 *   2. ページが実際に使う画像・動画だけを public/ から集めて並べる（使わない素材は載せない）。
 *   3. robots.txt と sitemap.xml、キャッシュの指定（_headers）を作る。
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildLegalPages } from "./build-legal-pages.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "packages/web/public");
const out = join(root, "official-site");
const SITE_URL = (process.env.SITE_URL ?? "https://janhai.maxplantlabs.com").replace(/\/$/, "");
const GAME_URL = (process.env.GAME_URL ?? "https://play-janhai.maxplantlabs.com").replace(/\/$/, "");
const MAX_FILE_BYTES = 25 * 1024 * 1024; // Cloudflare Pages は1ファイル25MBまで

// 先に、ページに埋め込んであるゲームのデータ（キャラ・カード・段位）をいまのゲームに合わせる。
const sync = spawnSync(process.execPath, [join(root, "scripts/sync-official-page.mjs")], { stdio: "inherit" });
if (sync.status !== 0) throw new Error("scripts/sync-official-page.mjs が失敗しました（先に npm run build -w @majyan/core が必要です）");

const src = readFileSync(join(pub, "about/index.html"), "utf8");

// 1. 住所の書き換え。
let html = src
  .replaceAll('href="/"', `href="${GAME_URL}/"`)
  .replaceAll("/about/img/", "/img/")
  .replaceAll("/about/pv.mp4", "/pv.mp4");
if (html.includes('href="/"') || html.includes("/about/")) throw new Error("書き換え漏れがあります（/about/ または href=\"/\" が残っています）");

// 2. 使う素材を集める。
/** 公開側の「/img/…」は、元の場所では about/img/…。 */
const sourceOf = (url) => (url.startsWith("/img/") || url === "/pv.mp4" ? join(pub, "about", url) : join(pub, url));
const used = new Set();
for (const m of html.matchAll(/["'(](\/(?:img|icons|title|avatars|declarations)\/[^"')\s?#`$]+|\/pv\.mp4)/g)) used.add(m[1]);
// 共有画像（og:image）は「https://公式ページ/img/og.webp」と絶対URLで書かれており、上の探し方では拾えない。
for (const m of html.matchAll(new RegExp(`${SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/img\\/[^"')\\s?#]+)`, "g"))) used.add(m[1]);
// スクリプトが組み立てる住所（`/declarations/${id}.webp`）は、使うidの一覧から作る。
const listIds = (name) => {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n?\\];`).exec(html)?.[1] ?? "";
  return [...block.matchAll(/\[?\s*"([a-z0-9-]+)"/g)].map((x) => x[1]);
};
const declarationIds = new Set([...listIds("HERO"), ...[...(/const CUTINS = \[([\s\S]*?)\];/.exec(html)?.[1] ?? "").matchAll(/\["([a-z0-9-]+)"\s*,/g)].map((x) => x[1])]);
if (declarationIds.size === 0) throw new Error("宣言演出の画像の一覧（HERO / CUTINS）を読み取れませんでした");
for (const id of declarationIds) used.add(`/declarations/${id}.webp`);
for (const m of html.matchAll(/"(?:avatar|top)":\s*"(\/[^"]+)"/g)) used.add(m[1]);
used.delete("/declarations/${id}.webp");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const missing = [];
let totalBytes = 0;
let count = 0;
for (const url of [...used].sort()) {
  const from = sourceOf(url);
  if (!existsSync(from)) {
    missing.push(url);
    continue;
  }
  const size = statSync(from).size;
  if (size > MAX_FILE_BYTES) throw new Error(`${url} が25MBを超えています（${(size / 1048576).toFixed(1)}MB）`);
  const to = join(out, url);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  totalBytes += size;
  count++;
}
if (missing.length > 0) throw new Error(`ページが使う素材が見つかりません:\n  ${missing.join("\n  ")}`);

// 法的ページ（特商法・規約・プライバシー）。販売者の情報が未記入なら作らず、リンクも付けない。
const legal = await buildLegalPages({ root, out, siteUrl: SITE_URL });
if (legal.ok) {
  const links = `      <a href="/tokushoho">特定商取引法に基づく表記</a>\n      <a href="/terms">利用規約</a>\n      <a href="/privacy">プライバシーポリシー</a>\n`;
  const marker = `      <a href="${GAME_URL}/">ゲームを始める</a>\n`;
  if (!html.includes(marker)) throw new Error("フッターの「ゲームを始める」のリンクが見つかりません（法的ページへのリンクを付けられません）");
  html = html.replace(marker, () => marker + links);
} else {
  console.warn("注意: " + legal.reason);
}
writeFileSync(join(out, "index.html"), html);

// 3. 検索エンジン向けのファイルとキャッシュの指定。
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // 日本時間の日付
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n${(legal.files ?? []).map((n) => `  <url>\n    <loc>${SITE_URL}/${n.replace(/.html$/, "")}</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n`).join("")}</urlset>\n`,
);
// ページ本体はすぐ更新を反映（毎回確認）、画像・動画は1日キャッシュ。
writeFileSync(
  join(out, "_headers"),
  ["/", "  Cache-Control: public, max-age=0, must-revalidate", "/*.webp", "  Cache-Control: public, max-age=86400", "/*.png", "  Cache-Control: public, max-age=86400", "/*.mp4", "  Cache-Control: public, max-age=86400", ""].join("\n"),
);

console.log(`official-site/ を作りました: ${count}ファイル + index.html・robots.txt・sitemap.xml・_headers（素材 ${(totalBytes / 1048576).toFixed(1)}MB）`);
console.log(`  公式ページ ${SITE_URL}/  →  「今すぐプレイ」は ${GAME_URL}/`);
