// usage: node build.mjs <id> <recDir> <capsJson> <outMp4>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [id, dir, capsPath, out] = process.argv.slice(2);
const caps = JSON.parse(fs.readFileSync(capsPath, "utf8"))[id];
const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
const times = fs.readFileSync(path.join(dir, "times.txt"), "utf8").split("\n").map(Number);
const start = meta.holdAt - 0.8, end = start + 5;
// concat: 各フレームを次のフレームまでの時間だけ表示
let list = "";
let n = 0;
for (let i = 0; i < times.length; i++) {
  const a = Math.max(times[i], start), b = Math.min(times[i + 1] ?? end, end);
  if (b <= start || a >= end || b - a <= 0) continue;
  list += `file '${path.join(dir, `f${String(i).padStart(5, "0")}.jpg`).replace(/\\/g, "/")}'\nduration ${(b - a).toFixed(4)}\n`;
  n++;
}
const lastFile = list.trim().split("\n").filter((l) => l.startsWith("file")).at(-1);
list += lastFile + "\n";
fs.writeFileSync(path.join(dir, "list.txt"), list);

// 字幕（textfile）
const LANG = process.env.CLIP_LANG ?? "en"; // en | zh | zh-Hant
const wrap = (t, w) => {
  const words = t.split(" ");
  const lines = [];
  let cur = "";
  for (const wd of words) {
    if ((cur + " " + wd).trim().length > w) { lines.push(cur); cur = wd; } else cur = (cur + " " + wd).trim();
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
};
// 中国語は単語の区切りが無いので、文字数で折り返す。
const wrapCjk = (t, w) => {
  // 句読点や閉じ括弧は行頭に来ないよう、前の行の末尾に付ける。
  const noStart = new Set("。、，．）」』】！？；：…");
  const lines = [];
  let cur = "";
  for (const ch of [...t]) {
    if ([...cur].length >= w && !noStart.has(ch)) { lines.push(cur); cur = ""; }
    cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
};
const TEXTS = {
  en: { t1: (c) => `"${c.skill}"!`, t2: (c) => wrap(c.first, 38), t3: (c) => `${c.short}'s skill "${c.skill}"`, t4: "Free, no sign-up   janhai.maxplantlabs.com", font: "segoeuib.ttf" },
  zh: { t1: (c) => `「${c.skill}」发动！`, t2: (c) => wrapCjk(c.first, 19), t3: (c) => `${c.short}的必杀技「${c.skill}」`, t4: "免费・无需注册　janhai.maxplantlabs.com/zh/", font: "msyhbd.ttc" },
  "zh-Hant": { t1: (c) => `「${c.skill}」發動！`, t2: (c) => wrapCjk(c.first, 19), t3: (c) => `${c.short}的必殺技「${c.skill}」`, t4: "免費・無需註冊　janhai.maxplantlabs.com/zh-tw/", font: "msjhbd.ttc" },
}[LANG];
const tf = (name, text) => { const p = path.join(dir, name).replace(/\\/g, "/"); fs.writeFileSync(p, text); return p; };
const esc = (p) => p.replace(/:/g, "\\:");
const t1 = tf("t1.txt", TEXTS.t1(caps));
const t2 = tf("t2.txt", TEXTS.t2(caps));
const t3 = tf("t3.txt", TEXTS.t3(caps));
const t4 = tf("t4.txt", TEXTS.t4);
const FB = `C\\:/Windows/Fonts/${TEXTS.font}`;
const dt = (f, size, y, color) => `drawtext=fontfile='${FB}':textfile='${esc(f)}':fontsize=${size}:fontcolor=${color}:borderw=3:bordercolor=black@0.8:x=(w-text_w)/2:y=${y}`;
const t3size = caps.skill.length > 22 ? 48 : 56;
const vf = [
  "[0:v]split[a][b]",
  "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:5,eq=brightness=-0.25[bg]",
  "[b]scale=1080:-2[fg]",
  "[bg][fg]overlay=0:(H-h)/2[o]",
  `[o]${dt(t1, 72, 250, "white")},${dt(t2, 44, 1305, "white")},${dt(t3, t3size, 1500, "white")},${dt(t4, LANG === "en" ? 48 : 38, 1610, "#ffd966")}[v]`,
].join(";");

const voice = path.join("C:/Users/user/majyan/packages/web/public", caps.voice);
const delay = Math.round((meta.holdAt - start) * 1000);
const args = ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-i", voice];
let fc = vf + `;[1:a]adelay=${delay}|${delay},apad,atrim=0:5[a1]`;
let amap = "[a1]";
if (caps.sfx) {
  args.push("-i", path.join("C:/Users/user/majyan/packages/web/public", caps.sfx));
  fc += `;[2:a]adelay=${delay}|${delay},apad,atrim=0:5[a2];[a1][a2]amix=inputs=2:duration=first:normalize=0[am]`;
  amap = "[am]";
}
args.push("-filter_complex", fc, "-map", "[v]", "-map", amap, "-r", "30", "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-c:a", "aac", "-ar", "44100", "-ac", "2", out);
execFileSync("ffmpeg", args, { stdio: "inherit" });
console.log("built", out, n);
