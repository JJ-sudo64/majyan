// 縦動画1日1本用の投稿文を、キャラデータから作る。出力: drafts/post-calendar.md
import { CHARACTERS } from "../packages/core/src/index.ts";
import { writeFileSync, existsSync } from "node:fs";

// 実プレイ録画を優先。無ければ紹介用の短い動画。
const SPECIAL: Record<string, string> = { zeno: "drafts/shorts/play-zeno-timestop.mp4", raiko: "drafts/shorts/play-raiko-issen.mp4" };
const videoOf = (id: string) => SPECIAL[id] ?? (existsSync(`drafts/shorts/play/${id}.mp4`) ? `drafts/shorts/play/${id}.mp4` : `drafts/shorts/chars/${id}.mp4`);

const ORDER = ["zeno", "raiko", "kagami", "mirai", "nyanjiro", "ren", "saki", "karin", "naoki", "tomohiro", "kagerou", "runa", "hiiragi", "jin", "toki", "subaru", "kaede", "nagi", "masato", "koki", "takaharu", "koji", "nannan", "deagari", "sena", "mio", "mebius"];
const URL = "https://janhai.maxplantlabs.com";
const FENCE = "```";
const all = CHARACTERS as Record<string, any>;
const ids = [...ORDER.filter((id) => all[id]), ...Object.keys(all).filter((id) => !ORDER.includes(id))];

// Xの文字数: 全角は2、半角は1、URLは23。280以内に収める。
const weight = (t: string) =>
  [...t.replace(URL, "")].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) + (t.includes(URL) ? 23 : 0);

let out = "# 投稿カレンダー（1日1本・縦動画）\n\n毎日: 動画を添付 → 下の文をコピペ。動画のパスは各日に記載（実プレイ録画があるキャラはそれを優先）。\n\n";
ids.forEach((id, i) => {
  const c = all[id];
  const [title, ...rest] = c.name.split("・");
  const who = rest.join("・");
  const first = String(c.skill.description).split("。")[0] + "。";
  const head = `【${title}】${who}の必殺技「${c.skill.name}」\n${first}\n\n`;
  const tail = `無料・登録不要で遊べる異能麻雀『雀杯』\n${URL}\n#雀杯 #異能麻雀`;
  const withQuote = `${head}「${c.winQuote}」\n\n${tail}`;
  const post = weight(withQuote) <= 280 ? withQuote : `${head}${tail}`;
  out += `## Day ${i + 1}：${who}（動画 \`${videoOf(id)}\`）\n\n${FENCE}\n${post}\n${FENCE}\n`;
  out += `（X換算 ${weight(post)}/280${post === withQuote ? "" : "・台詞が長いので省略"}）\n\n`;
});
writeFileSync("drafts/post-calendar.md", out);
console.log(ids.length, "days");

// --- TikTok / YouTube Shorts / Instagram Reels 用（同じ動画・同じ順番）。出力: drafts/shorts-captions.md
let sc = `# 縦動画の投稿文（TikTok / YouTube Shorts / Instagram Reels）

毎日1本。動画を選んで、下の文をコピペするだけ。順番は post-calendar.md の Day と同じ。
**毎回の確認**: ①「AI生成コンテンツ」の設定をオン ②URLはプロフィールのリンク欄（キャプションのURLは押せない）③夜20〜23時に出す。

`;
ids.forEach((id, i) => {
  const c = all[id];
  const [title, ...rest] = c.name.split("・");
  const who = rest.join("・");
  const first = String(c.skill.description).split("。")[0] + "。";
  const tags = "#雀杯 #異能麻雀 #麻雀 #ブラウザゲーム #ゲーム紹介";
  sc += `## Day ${i + 1}：${who}（動画 \`${videoOf(id)}\`）\n\n`;
  sc += `**TikTok / Instagram Reels**\n\n${FENCE}\n${who}の必殺技「${c.skill.name}」🀄 ${first}無料・登録不要で遊べます→プロフのリンク\n${tags}\n${FENCE}\n\n`;
  sc += `**YouTube Shorts**（タイトル100文字以内）\n\n${FENCE}\n【${who}】必殺技「${c.skill.name}」 #Shorts #雀杯 #異能麻雀\n${FENCE}\n\n`;
  sc += `説明欄:\n\n${FENCE}\n${first}\n無料・登録不要で遊べる異能麻雀バトル『雀杯』\n▼今すぐ遊ぶ ${URL}\n公式X https://x.com/janhai_game\n${FENCE}\n\n`;
});
writeFileSync("drafts/shorts-captions.md", sc);
console.log("shorts-captions:", ids.length, "days");

// --- 英語版（海外向け）。出力: drafts/posts-en.md。対訳は packages/web/src/i18n/en-data.ts。
import { enData } from "../packages/web/src/i18n/en-data.ts";
const EN_URL = "https://janhai.maxplantlabs.com/en/";
const en = (t: string): string => enData[t] ?? t;
const enWeight = (t: string) => [...t.replace(EN_URL, "")].length + (t.includes(EN_URL) ? 23 : 0);
const firstEn = (t: string) => (t.split(/(?<=\.)\s/)[0] ?? t).trim();

let pe = `# English posts (X / TikTok / Reels / Shorts)

Same order and same videos as post-calendar.md. Note: the gameplay clips still show the Japanese UI — re-record in English (set \`majyan.locale\` to "en") if you want an English-UI version.
Check each time: AI-generated content label ON; put the link in the profile (caption links aren't clickable on TikTok/Reels); post in the evening of the target time zone.

`;
ids.forEach((id, i) => {
  const c = all[id];
  const full = en(c.name); // "Hiiragi, the Blossom Priestess"
  const [short, ...rest] = full.split(", ");
  const epithet = rest.join(", ");
  const skill = en(c.skill.name);
  const first = firstEn(en(c.skill.description));
  const quote = en(c.winQuote);
  const head = `${short}${epithet ? `, ${epithet}` : ""} — skill "${skill}"\n${first}\n\n`;
  const tail = `Free skill-powered mahjong in your browser, no sign-up:\n${EN_URL}\n#mahjong #riichimahjong #indiegame`;
  const withQuote = `${head}"${quote}"\n\n${tail}`;
  const post = enWeight(withQuote) <= 280 ? withQuote : `${head}${tail}`;
  pe += `## Day ${i + 1}: ${short} (video \`${videoOf(id)}\`)\n\n**X**\n\n${FENCE}\n${post}\n${FENCE}\n(${enWeight(post)}/280${post === withQuote ? "" : ", quote omitted: too long"})\n\n`;
  pe += `**TikTok / Reels**\n\n${FENCE}\n${short}'s skill "${skill}" 🀄 ${first} Free, no sign-up — link in bio.\n#mahjong #riichimahjong #browsergame #indiegame #gamedev\n${FENCE}\n\n`;
  pe += `**YouTube Shorts** (title ≤100 chars)\n\n${FENCE}\n${short}: "${skill}" skill | Skill-Powered Riichi Mahjong #Shorts\n${FENCE}\n\n`;
});
writeFileSync("drafts/posts-en.md", pe);
console.log("posts-en:", ids.length, "days");
