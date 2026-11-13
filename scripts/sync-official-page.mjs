#!/usr/bin/env node
/**
 * 公式ページ（packages/web/public/about/index.html）に埋め込んである、ゲームのデータ
 * （キャラクター・カード・段位・ガチャの数字）を、いまのゲームのデータ（packages/core）から書き直す。
 * キャラやカードを増やした・説明を変えた時は、これを実行すれば公式ページも追いつく。
 *
 * 使い方:  npm run build -w @majyan/core && node scripts/sync-official-page.mjs
 *          （node scripts/build-official-site.mjs の中からも自動で呼ばれる）
 *
 * 書き直すもの:
 *   - const CHARACTERS / CARDS / RANKS / FACTS の行
 *   - <span data-count="…">N</span> の中の数字（スクリプトが動かない環境用の、はじめから入れておく数字）
 * 確かめるだけで書き直さないもの:
 *   - ガチャの確率の棒グラフ（3% / 18% / 79%）。ゲームの確率と違っていたら、エラーで止まる。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pagePath = join(root, "packages/web/public/about/index.html");
const corePath = join(root, "packages/core/dist/index.js");
if (!existsSync(corePath)) throw new Error("先に npm run build -w @majyan/core を実行してください（packages/core/dist がありません）");
const core = await import(pathToFileURL(corePath).href);

let html = readFileSync(pagePath, "utf8");

/** スクリプトの中に置くJSONは、「</script>」と間違われないように「</」だけ直す。 */
const js = (value) => JSON.stringify(value).replaceAll("</", "<\\/");
const replaceLine = (name, value) => {
  const re = new RegExp(`^const ${name} = .*;$`, "m");
  if (!re.test(html)) throw new Error(`公式ページに「const ${name} = …;」の行が見つかりません`);
  html = html.replace(re, () => `const ${name} = ${js(value)};`);
};

// キャラクター。名前は「二つ名・呼び名」の形。
const characters = core.CHARACTER_IDS.map((id) => {
  const c = core.CHARACTERS[id];
  const parts = c.name.split("・");
  return {
    id,
    name: c.name,
    title: parts.length > 1 ? parts.slice(0, -1).join("・") : c.name,
    short: parts[parts.length - 1],
    rarity: core.characterRarity(id),
    skill: c.skill.name,
    desc: c.skill.description,
    quote: c.winQuote ?? "",
    avatar: c.avatar,
    top: c.topArt ?? c.avatar,
  };
});

// カード。レア度の高い順（同じレア度の中はゲームでの並び順）。種類の呼び方はゲーム内（パッシブ／アクティブ）と同じ。
const KIND_LABEL = { passive: "パッシブ", consumable: "アクティブ" };
const cards = core.CARD_IDS.map((id, i) => ({ c: core.CARDS[id], rarity: core.cardRarity(id), i }))
  .sort((a, b) => b.rarity - a.rarity || a.i - b.i)
  .map(({ c, rarity }) => ({ name: c.name, rarity, type: KIND_LABEL[c.kind] ?? c.kind, desc: c.description }));

// 段位。降段のある段がひとつでもあれば canDemote。段が無い最上位（雀廃）は levels:0。
const ranks = core.RANK_TIERS.map((t) => ({ name: t.name, levels: t.levelMax.length, canDemote: t.canDemote.length === 0 ? true : t.canDemote.some(Boolean) }));

const facts = { exchangeCost: core.EXCHANGE_COST };

replaceLine("CHARACTERS", characters);
replaceLine("CARDS", cards);
replaceLine("RANKS", ranks);
replaceLine("FACTS", facts);

// 文中の数字。
const counts = { characters: characters.length, cards: cards.length, rankTiers: ranks.filter((r) => r.levels > 0).length, exchangeCost: facts.exchangeCost };
html = html.replace(/<span data-count="(\w+)">[^<]*<\/span>/g, (all, key) => {
  if (!(key in counts)) throw new Error(`知らない data-count です: ${key}`);
  return `<span data-count="${key}">${counts[key]}</span>`;
});

// ガチャの確率の棒グラフ（手で書いてある）が、ゲームの確率と同じか確かめる。
const rates = core.GACHA_RARITY_RATES;
for (const star of [3, 2, 1]) {
  const want = Math.round(rates[star] * 100);
  const m = new RegExp(`<b>${"★".repeat(star)}</b><div class="rate__bar"><i style="--v:(\\d+)%"></i></div><span>(\\d+)%</span>`).exec(html);
  if (!m || Number(m[1]) !== want || Number(m[2]) !== want) throw new Error(`ガチャの確率（★${star}）が公式ページ（${m ? m[2] : "なし"}%）とゲーム（${want}%）で違います。公式ページの棒グラフを直してください`);
}

writeFileSync(pagePath, html);
console.log(`公式ページのデータを更新しました: キャラ ${characters.length}人 / カード ${cards.length}種 / 段位 ${counts.rankTiers}つ（+雀廃） / 交換 ${facts.exchangeCost}ポイント`);
