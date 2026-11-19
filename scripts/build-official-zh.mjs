/**
 * 公式ページの中国語版（簡体字、/zh/）を、日本語版のHTMLから作る。build-official-en.mjs の中国語版。
 * 文言の置き換えは、英語版と同じ REPLACEMENTS の順番で official-zh.mjs の ZH を使う。
 * キャラ・カード・段位のデータは、ゲーム内の対訳表（packages/web/src/i18n/zh-data.ts）を使う。
 * 置き換えのあとに日本語のかなが残っていればエラーにする。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPLACEMENTS } from "./build-official-en.mjs";
import { ZH } from "./official-zh.mjs";
import { ZH_HANT } from "./official-zh-hant.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadZhData(file, name) {
  const src = readFileSync(join(root, "packages/web/src/i18n", file), "utf8");
  return JSON.parse(src.slice(src.indexOf("{", src.indexOf(name)), src.lastIndexOf("}") + 1).replace(/,\s*}$/, "}"));
}

/** 簡体字版(hans)と繁体字版(hant)の違い。 */
const VARIANTS = {
  hans: { table: ZH, dataFile: "zh-data.ts", dataName: "zhData", path: "zh", gameLang: "zh", tag: "zh-CN", locale: "zh_CN", moreLeftover: [] },
  hant: { table: ZH_HANT, dataFile: "zh-hant-data.ts", dataName: "zhHantData", path: "zh-tw", gameLang: "zh-Hant", tag: "zh-TW", locale: "zh_TW", moreLeftover: [] },
};

const TYPE_ZH = { パッシブ: "被动", アクティブ: "主动" };

/** 置き換え表の番号ずれを検出する（日本語と中国語で、タグや引用符の付き方が揃っているか）。 */
function checkAlignment(ZH) {
  if (ZH.length !== REPLACEMENTS.length) throw new Error(`official-zh.mjs の件数（${ZH.length}）が置き換え表（${REPLACEMENTS.length}）と違います`);
  REPLACEMENTS.forEach(([ja], i) => {
    const zh = ZH[i];
    const kind = (s) => (s.startsWith(">") ? ">" : s.startsWith('"') ? '"' : s.startsWith("`") ? "`" : /^(aria-label|alt=|property=|content=)/.test(s) ? s.slice(0, 4) : "");
    if (kind(ja) !== kind(zh)) throw new Error(`official-zh.mjs の ${i} 番が日本語の置き換え元とずれています: ${ja.slice(0, 30)} ↔ ${zh.slice(0, 30)}`);
    if (ja.startsWith(">") && !zh.endsWith("<")) throw new Error(`official-zh.mjs の ${i} 番: 末尾の < がありません`);
  });
}

/** 日本語版のHTML（住所の書き換えまで済んだもの）から、中国語版のHTMLを作る。 */
export function buildChinesePage(html, { siteUrl, gameUrl, variant = "hans" }) {
  const v = VARIANTS[variant];
  const ZH = v.table;
  checkAlignment(ZH);
  const zhData = loadZhData(v.dataFile, v.dataName);
  let out = html;

  const tr = (text) => {
    const v = zhData[text];
    if (v === undefined) throw new Error(`対訳表に無い文言です: ${text}`);
    return v;
  };
  const translateJsonConst = (name, mapItem) => {
    const re = new RegExp(`^const ${name} = (\\[.*\\]);$`, "m");
    const m = re.exec(out);
    if (!m) throw new Error(`${name} のデータが見つかりません`);
    const list = JSON.parse(m[1]).map(mapItem);
    out = out.replace(re, () => `const ${name} = ${JSON.stringify(list)};`);
  };
  translateJsonConst("CHARACTERS", (c) => {
    const full = tr(c.name); // 例: "绽放的巫女·柊"
    const i = full.lastIndexOf("·");
    const short = i >= 0 ? full.slice(i + 1) : full;
    const title = i >= 0 ? full.slice(0, i) : "";
    return { ...c, name: short, title, short, skill: tr(c.skill), desc: tr(c.desc), quote: tr(c.quote) };
  });
  translateJsonConst("CARDS", (c) => ({ ...c, name: tr(c.name), type: TYPE_ZH[c.type] ?? c.type, desc: tr(c.desc) }));
  translateJsonConst("RANKS", (r) => ({ ...r, name: tr(r.name) }));

  // 文言の置き換え。
  REPLACEMENTS.forEach(([ja], i) => {
    if (!out.includes(ja)) throw new Error(`中国語版の置き換え元が見つかりません（日本語版の文言が変わった？）: ${ja.slice(0, 60)}`);
    out = out.split(ja).join(ZH[i]);
  });

  // 言語タグ（簡体字版の表は zh-CN のまま。繁体字版は zh-TW に直す）。
  out = out.replace('<html lang="zh-CN">', `<html lang="${v.tag}">`).replace('content="zh_CN"', `content="${v.locale}"`).replace('"inLanguage": "zh-CN"', `"inLanguage": "${v.tag}"`);

  // 検索・共有まわり（中国語版の住所、言語の対応づけ）。
  const zhUrl = `${siteUrl}/${v.path}/`;
  out = out
    .replace(`<link rel="canonical" href="${siteUrl}/" />`, `<link rel="canonical" href="${zhUrl}" />`)
    .replace(`property="og:url" content="${siteUrl}/"`, `property="og:url" content="${zhUrl}"`)
    .replace(`"url": "${siteUrl}/",`, `"url": "${zhUrl}",`)
    .replace(`"url": "${gameUrl}/"`, `"url": "${gameUrl}/?lang=${v.gameLang}"`);
  // ゲームへのリンクは、中国語で開くよう lang=zh を付ける。
  out = out.replaceAll(`href="${gameUrl}/"`, `href="${gameUrl}/?lang=${v.gameLang}"`);
  // フッターの言語リンク: 日本語版への行き先と英語版を出す（日本語版にある英語・中国語のリンクを差し替える）。
  const hansLink = `<a href="${siteUrl}/zh/" hreflang="zh-CN">简体中文</a>`;
  const hantLink = `<a href="${siteUrl}/zh-tw/" hreflang="zh-TW">繁體中文</a>`;
  out = out.replace(`<a href="${siteUrl}/en/" hreflang="en">English</a>`, `<a href="${siteUrl}/" hreflang="ja">日本語</a>`);
  out = out.replace(variant === "hans" ? hansLink : hantLink, `<a href="${siteUrl}/en/" hreflang="en">English</a>`);

  // 日本語のかなが残っていないか確認する（コメント・日本語への言語リンクは除く）。
  const visible = out
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
  const left = [...new Set(visible.match(/[^\n<>"`]*[぀-ヺー-ヿ][^\n<>"`]*/g) ?? [])].filter((x) => !x.includes("日本語") && !x.includes("简体中文") && !x.includes("繁體中文") && !x.includes("じゃんはい"));
  if (left.length > 0) throw new Error(`中国語版に日本語が残っています:\n${left.slice(0, 15).join("\n")}`);
  return out;
}
