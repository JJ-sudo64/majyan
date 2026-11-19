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
// 英語UIで撮った動画があればそれを使う。無ければ日本語UIの動画（その旨を注記）。
const videoOfEn = (id: string) => (existsSync(`drafts/shorts/play-en/${id}.mp4`) ? `drafts/shorts/play-en/${id}.mp4` : `${videoOf(id)} (Japanese UI)`);
const enWeight = (t: string) => [...t.replace(EN_URL, "")].length + (t.includes(EN_URL) ? 23 : 0);
const firstEn = (t: string) => (t.split(/(?<=\.)\s/)[0] ?? t).trim();

let pe = `# English posts (X / TikTok / Reels / Shorts)

Same order and same videos as post-calendar.md. Videos: drafts/shorts/play-en/ holds English-UI clips with English captions; days without one fall back to the Japanese-UI clip (marked).
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
  pe += `## Day ${i + 1}: ${short} (video \`${videoOfEn(id)}\`)\n\n**X**\n\n${FENCE}\n${post}\n${FENCE}\n(${enWeight(post)}/280${post === withQuote ? "" : ", quote omitted: too long"})\n\n`;
  pe += `**TikTok / Reels**\n\n${FENCE}\n${short}'s skill "${skill}" 🀄 ${first} Free, no sign-up — link in bio.\n#mahjong #riichimahjong #browsergame #indiegame #gamedev\n${FENCE}\n\n`;
  pe += `**YouTube Shorts** (title ≤100 chars)\n\n${FENCE}\n${short}: "${skill}" skill | Skill-Powered Riichi Mahjong #Shorts\n${FENCE}\n\n`;
});
writeFileSync("drafts/posts-en.md", pe);
console.log("posts-en:", ids.length, "days");

// --- 簡体字中国語版。出力: drafts/posts-zh.md。対訳は packages/web/src/i18n/zh-data.ts。
import { zhData } from "../packages/web/src/i18n/zh-data.ts";
const ZH_URL = "https://janhai.maxplantlabs.com/zh/";
const zhT = (t: string): string => zhData[t] ?? t;
const videoOfZh = (id: string) => (existsSync(`drafts/shorts/play-zh/${id}.mp4`) ? `drafts/shorts/play-zh/${id}.mp4` : `${videoOf(id)} (日语界面)`);
const firstZh = (t: string) => (t.split("。")[0] ?? t) + "。";

let pz = `# 中文投稿文（X / 抖音以外的短视频平台 / Reels / Shorts 等）

顺序和视频与 post-calendar.md 相同。视频：drafts/shorts/play-zh/ 是中文界面的实机录像（带简体字幕）；没有的角色用日语界面的视频（已标注）。
每次发布前确认：开启“AI生成内容”标识；链接放在个人简介里（TikTok/Reels 的文案链接无法点击）；在目标时区的晚间发布。
X 的字数：汉字算2、半角算1、链接算23，280以内。

`;
ids.forEach((id, i) => {
  const c = all[id];
  const full = zhT(c.name); // "绽放的巫女·柊"
  const dot = full.lastIndexOf("·");
  const short = dot >= 0 ? full.slice(dot + 1) : full;
  const epithet = dot >= 0 ? full.slice(0, dot) : "";
  const skill = zhT(c.skill.name);
  const first = firstZh(zhT(c.skill.description));
  const quote = zhT(c.winQuote);
  const head = `【${short}】${epithet ? `${epithet}` : ""}的必杀技「${skill}」\n${first}\n\n`;
  const tail = `免费・无需注册，浏览器就能玩的异能麻将『雀杯』\n${ZH_URL}\n#雀杯 #日麻 #立直麻将`;
  const withQuote = `${head}「${quote}」\n\n${tail}`;
  const post = weight(withQuote.replace(ZH_URL, EN_URL)) <= 280 ? withQuote : `${head}${tail}`;
  pz += `## 第${i + 1}天：${short}（视频 \`${videoOfZh(id)}\`）\n\n**X**\n\n${FENCE}\n${post}\n${FENCE}\n（X换算 ${weight(post.replace(ZH_URL, EN_URL))}/280${post === withQuote ? "" : "，台词太长已省略"}）\n\n`;
  pz += `**短视频平台 / Reels**\n\n${FENCE}\n${short}的必杀技「${skill}」🀄 ${first}免费・无需注册→主页链接\n#雀杯 #日麻 #立直麻将 #浏览器游戏 #独立游戏\n${FENCE}\n\n`;
  pz += `**YouTube Shorts**（标题100字以内）\n\n${FENCE}\n【${short}】必杀技「${skill}」｜异能立直麻将 #Shorts #雀杯\n${FENCE}\n\n`;
});
writeFileSync("drafts/posts-zh.md", pz);
console.log("posts-zh:", ids.length, "days");

// --- 繁体字中国語版（台湾向け）。出力: drafts/posts-zh-tw.md。対訳は packages/web/src/i18n/zh-hant-data.ts。
import { zhHantData } from "../packages/web/src/i18n/zh-hant-data.ts";
const ZHT_URL = "https://janhai.maxplantlabs.com/zh-tw/";
const zhtT = (t: string): string => zhHantData[t] ?? t;
const videoOfZht = (id: string) => (existsSync(`drafts/shorts/play-zhtw/${id}.mp4`) ? `drafts/shorts/play-zhtw/${id}.mp4` : `${videoOf(id)} (日語介面)`);

let pt = `# 繁體中文投稿文（X / Reels / Shorts 等，台灣・香港向け）

順序和影片與 post-calendar.md 相同。影片：drafts/shorts/play-zhtw/ 是繁體中文介面的實機錄影（附繁體字幕）；沒有的角色使用日語介面的影片（已標註）。
每次發布前確認：開啟「AI 生成內容」標示；連結放在個人簡介（TikTok/Reels 的文案連結無法點擊）；在目標時區的晚間發布。
X 的字數：漢字算2、半形算1、連結算23，280以內。

`;
ids.forEach((id, i) => {
  const c = all[id];
  const full = zhtT(c.name);
  const dot = full.lastIndexOf("·");
  const short = dot >= 0 ? full.slice(dot + 1) : full;
  const epithet = dot >= 0 ? full.slice(0, dot) : "";
  const skill = zhtT(c.skill.name);
  const first = firstZh(zhtT(c.skill.description));
  const quote = zhtT(c.winQuote);
  const head = `【${short}】${epithet}的必殺技「${skill}」\n${first}\n\n`;
  const tail = `免費・免註冊，瀏覽器就能玩的異能麻將『雀杯』\n${ZHT_URL}\n#雀杯 #日麻 #立直麻將`;
  const withQuote = `${head}「${quote}」\n\n${tail}`;
  const post = weight(withQuote.replace(ZHT_URL, EN_URL)) <= 280 ? withQuote : `${head}${tail}`;
  pt += `## 第${i + 1}天：${short}（影片 \`${videoOfZht(id)}\`）\n\n**X**\n\n${FENCE}\n${post}\n${FENCE}\n（X換算 ${weight(post.replace(ZHT_URL, EN_URL))}/280${post === withQuote ? "" : "，台詞太長已省略"}）\n\n`;
  pt += `**短影音平台 / Reels**\n\n${FENCE}\n${short}的必殺技「${skill}」🀄 ${first}免費・免註冊→主頁連結\n#雀杯 #日麻 #立直麻將 #瀏覽器遊戲 #獨立遊戲\n${FENCE}\n\n`;
  pt += `**YouTube Shorts**（標題100字以內）\n\n${FENCE}\n【${short}】必殺技「${skill}」｜異能立直麻將 #Shorts #雀杯\n${FENCE}\n\n`;
});
writeFileSync("drafts/posts-zh-tw.md", pt);
console.log("posts-zh-tw:", ids.length, "days");
