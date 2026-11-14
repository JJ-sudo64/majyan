/**
 * 公式サイトに載せる「特定商取引法に基づく表記」「利用規約」「プライバシーポリシー」の3ページを作る。
 * 中身はゲーム側と同じもの（packages/core の shop.ts / legal.ts）から作るので、文言を直す時はそちらだけ。
 *
 * 販売者の情報（SELLER_INFO）が1つでも空なら作らない（「公開前に記入」の文字が載ったページを公開しないため）。
 * 見た目の確認だけしたい時は、環境変数 LEGAL_PREVIEW=1 を付けると、空のままでも作る
 * （その場合は公開してはいけない。npm run publish:official には付けないこと）。
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
:root { color-scheme: dark; --bg:#0b0806; --ink:#f3ead8; --ink-2:#cdbfa6; --ink-3:#988a72; --gold:#e6c36b; --line:rgba(230,195,107,.25); }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.85 "Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif; }
.wrap { max-width: 780px; margin: 0 auto; padding: 36px 16px 72px; }
a { color: var(--gold); }
.back { font-size: 14px; }
h1 { font-size: 26px; margin: 18px 0 6px; color: var(--gold); letter-spacing: .04em; }
h2 { font-size: 18px; margin: 34px 0 6px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
p { margin: 8px 0; color: var(--ink-2); }
.meta { color: var(--ink-3); font-size: 13px; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 8px; font-size: 15px; }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border: 1px solid var(--line); }
th { width: 34%; color: var(--gold); font-weight: 600; background: rgba(230,195,107,.05); }
td { color: var(--ink-2); }
nav.legal { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--line); display:flex; flex-wrap:wrap; gap: 8px 22px; font-size: 14px; }
@media (max-width: 560px) { th, td { display: block; width: 100%; } th { border-bottom: 0; } }
`;

function page({ title, siteUrl, body }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}｜雀廃</title>
<meta name="robots" content="index,follow" />
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<a class="back" href="${esc(siteUrl)}/">← 雀廃 公式サイトへ</a>
<h1>${esc(title)}</h1>
${body}
<nav class="legal">
<a href="${esc(siteUrl)}/tokushoho.html">特定商取引法に基づく表記</a>
<a href="${esc(siteUrl)}/terms.html">利用規約</a>
<a href="${esc(siteUrl)}/privacy.html">プライバシーポリシー</a>
</nav>
</div>
</body>
</html>
`;
}

const table = (rows) => `<table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
const sections = (list) => list.map((s) => `<h2>${esc(s.title)}</h2><p>${esc(s.body)}</p>`).join("\n");

/** @returns {Promise<{ok: boolean, reason?: string, files?: string[]}>} */
export async function buildLegalPages({ root, out, siteUrl }) {
  const corePath = join(root, "packages/core/dist/index.js");
  if (!existsSync(corePath)) throw new Error("先に npm run build -w @majyan/core を実行してください");
  const core = await import(pathToFileURL(corePath).href);
  const preview = process.env.LEGAL_PREVIEW === "1";
  if (!core.sellerInfoComplete() && !preview) {
    return { ok: false, reason: "販売者の情報（packages/core/src/shop.ts の SELLER_INFO）が未記入のため、法的ページは作りませんでした" };
  }

  const { commerce, prepaid } = core.legalNoticeRows();
  const yen = (n) => `${n.toLocaleString("ja-JP")}円`;
  const products = core.JADE_PRODUCTS.map((p) => [
    `雀玉 ${p.paidJade.toLocaleString("ja-JP")}個`,
    `${yen(p.priceYen)}（税込）${p.bonusJade > 0 ? ` ／ おまけ（無償の雀玉）${p.bonusJade.toLocaleString("ja-JP")}個つき` : ""}`,
  ]);

  const tokushoho = page({
    title: "特定商取引法に基づく表記",
    siteUrl,
    body: `${table(commerce)}
<h2>販売する商品と価格</h2>
${table(products)}
<h2>資金決済法に基づく表示</h2>
${table(prepaid)}`,
  });
  const dateLine = `<p class="meta">版: ${esc(core.TERMS_VERSION)}</p>`;
  const terms = page({ title: "利用規約", siteUrl, body: `${dateLine}\n${sections(core.TERMS_SECTIONS)}` });
  const privacy = page({ title: "プライバシーポリシー", siteUrl, body: `${dateLine}\n${sections(core.PRIVACY_SECTIONS)}` });

  const files = { "tokushoho.html": tokushoho, "terms.html": terms, "privacy.html": privacy };
  for (const [name, html] of Object.entries(files)) writeFileSync(join(out, name), html);
  return { ok: true, files: Object.keys(files) };
}
