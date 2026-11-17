// 縦動画1日1本用の投稿文を、キャラデータから作る。出力: drafts/post-calendar.md
import { CHARACTERS } from "../packages/core/src/index.ts";
import { writeFileSync } from "node:fs";

const ORDER = ["zeno", "raiko", "kagami", "mirai", "nyanjiro", "ren", "saki", "karin", "naoki", "tomohiro", "kagerou", "runa", "hiiragi", "jin", "toki", "subaru", "kaede", "nagi", "masato", "koki", "takaharu", "koji", "nannan", "deagari", "sena", "mio", "mebius"];
const URL = "https://janhai.maxplantlabs.com";
const FENCE = "```";
const all = CHARACTERS as Record<string, any>;
const ids = [...ORDER.filter((id) => all[id]), ...Object.keys(all).filter((id) => !ORDER.includes(id))];

// Xの文字数: 全角は2、半角は1、URLは23。280以内に収める。
const weight = (t: string) =>
  [...t.replace(URL, "")].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) + (t.includes(URL) ? 23 : 0);

let out = "# 投稿カレンダー（1日1本・縦動画）\n\n毎日: 動画を添付 → 下の文をコピペ。動画は drafts/shorts/chars/{id}.mp4。\n\n";
ids.forEach((id, i) => {
  const c = all[id];
  const [title, ...rest] = c.name.split("・");
  const who = rest.join("・");
  const first = String(c.skill.description).split("。")[0] + "。";
  const head = `【${title}】${who}の必殺技「${c.skill.name}」\n${first}\n\n`;
  const tail = `無料・登録不要で遊べる異能麻雀『雀杯』\n${URL}\n#雀杯 #異能麻雀`;
  const withQuote = `${head}「${c.winQuote}」\n\n${tail}`;
  const post = weight(withQuote) <= 280 ? withQuote : `${head}${tail}`;
  out += `## Day ${i + 1}：${who}（動画 \`${id}.mp4\`）\n\n${FENCE}\n${post}\n${FENCE}\n`;
  out += `（X換算 ${weight(post)}/280${post === withQuote ? "" : "・台詞が長いので省略"}）\n\n`;
});
writeFileSync("drafts/post-calendar.md", out);
console.log(ids.length, "days");
