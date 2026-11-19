// 投稿文（drafts/*.md）を、プラットフォーム別・言語別のプレーンテキストにまとめる。
// 使い方: npx tsx scripts/export-posts-txt.mts   →  drafts/posts-txt/{X,TikTok,YouTube}_{ja,en,zh}.txt
// 元のMarkdownは scripts/gen-post-calendar.mts が作る。先にそちらを実行してから、これを実行する。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Kind = "X" | "TikTok" | "YouTube" | "YouTube説明";
interface Entry { day: string; video: string; blocks: Partial<Record<Kind, string>> }

/** Markdown（## 見出し ごとに、ラベル行→コードブロック）を読む。 */
function parse(md: string): Entry[] {
  const entries: Entry[] = [];
  for (const sec of md.split(/^## /m).slice(1)) {
    const lines = sec.split("\n");
    const head = lines[0]!;
    const video = /`([^`]+)`/.exec(head)?.[1] ?? "";
    // 見出しは「Day 2：ライコ（動画 `…`）」「Day 2: Raiko (video `…`)」の形。日付と名前の部分だけを取る。
    const day = head.replace(/\s*[（(]\s*(动画|视频|動画|video)\s.*$/i, "").trim();
    const blocks: Entry["blocks"] = {};
    let label = "";
    let inFence = false;
    let buf: string[] = [];
    for (const line of lines.slice(1)) {
      if (line.startsWith("```")) {
        if (!inFence) { inFence = true; buf = []; continue; }
        inFence = false;
        const text = buf.join("\n").trim();
        const kind: Kind | null = /^\*\*X\*\*/.test(label) ? "X" : /TikTok|短视频/.test(label) ? "TikTok" : /YouTube/.test(label) ? "YouTube" : /説明欄/.test(label) ? "YouTube説明" : label === "" ? "X" : null;
        if (kind && !blocks[kind]) blocks[kind] = text;
        label = "-";
        continue;
      }
      if (inFence) buf.push(line);
      else if (/^\*\*/.test(line) || /^説明欄/.test(line)) label = line.trim();
    }
    entries.push({ day, video, blocks });
  }
  return entries;
}

const WORDS = { ja: { video: "動画", title: "【タイトル】", desc: "【説明欄】", suffix: "用の投稿文" }, en: { video: "Video", title: "[Title]", desc: "[Description]", suffix: " posts" }, zh: { video: "视频", title: "【标题】", desc: "【说明栏】", suffix: " 投稿文" } } as const;
const SOURCES: { lang: "ja" | "en" | "zh"; label: string; files: string[]; note: string }[] = [
  { lang: "ja", label: "日本語", files: ["drafts/post-calendar.md", "drafts/shorts-captions.md"], note: "1日1本。動画を添付して、下の文をコピペ。TikTok/Reelsは「AI生成コンテンツ」の設定をオン、URLはプロフィールのリンク欄に、夜20〜23時に投稿。" },
  { lang: "en", label: "English", files: ["drafts/posts-en.md"], note: "One per day. Attach the video and paste the text. Turn the AI-generated label ON; put the link in the profile; post in the evening of the target time zone." },
  { lang: "zh", label: "简体中文", files: ["drafts/posts-zh.md"], note: "每天一条。附上视频，粘贴下面的文字。开启“AI生成内容”标识；链接放在个人简介里；在晚间发布。" },
];

mkdirSync("drafts/posts-txt", { recursive: true });
for (const src of SOURCES) {
  // 同じ日の複数ファイル（日本語は X が post-calendar、TikTok/YouTube が shorts-captions）を番号で束ねる。
  const merged: Entry[] = [];
  for (const f of src.files) {
    if (!existsSync(f)) continue;
    parse(readFileSync(f, "utf8")).forEach((e, i) => {
      merged[i] = merged[i] ? { ...merged[i]!, blocks: { ...merged[i]!.blocks, ...e.blocks } } : e;
    });
  }
  const out: Record<string, string[]> = { X: [], TikTok: [], YouTube: [] };
  merged.forEach((e) => {
    const W = WORDS[src.lang];
    const head = `==== ${e.day} ====\n${W.video}: ${e.video}\n`;
    if (e.blocks.X) out.X!.push(`${head}\n${e.blocks.X}\n`);
    if (e.blocks.TikTok) out.TikTok!.push(`${head}\n${e.blocks.TikTok}\n`);
    if (e.blocks.YouTube) out.YouTube!.push(`${head}\n${W.title}\n${e.blocks.YouTube}${e.blocks.YouTube説明 ? `\n\n${W.desc}\n${e.blocks.YouTube説明}` : ""}\n`);
  });
  const title: Record<string, string> = { X: "X（旧Twitter）", TikTok: "TikTok / Instagram Reels", YouTube: "YouTube Shorts" };
  for (const k of ["X", "TikTok", "YouTube"]) {
    const body = `${title[k]}${WORDS[src.lang].suffix}（${src.label}）\n${src.note}\n\n${out[k]!.join("\n")}`;
    writeFileSync(`drafts/posts-txt/${k}_${src.lang}.txt`, body);
  }
  console.log(src.lang, merged.length, "日分");
}
