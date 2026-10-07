#!/usr/bin/env node
/**
 * 効果音・ボイス・BGMの聞こえる大きさ（ラウドネス, LUFS）をそろえる。
 *
 *   npm run normalize-audio            packages/web/public の音をすべて目標値へそろえる
 *   npm run normalize-audio -- --check 測るだけ（書き換えない）
 *
 * 新しいボイス等を足した時はこれを1回流す（目標値から±0.7以内のファイルは触らないので、
 * 何度流してもよい）。ffmpeg・ffprobe（PATH上、または環境変数FFMPEG・FFPROBE）が必要。
 * 書き換える前の元のファイルは asset-backups/audio-<日時>/ に写しておく（gitには入らない）。
 *
 * 目標値:
 *   ボイス・リーチ/和了の効果音   -18 LUFS（一番聞かせたい音）
 *   BGM                          -20 LUFS（声と効果音が埋もれないよう少し下げる）
 *   打牌・ツモ・配牌の効果音      そろえない（短いカチッという音で、ラウドネスでそろえると
 *                                 大きくなりすぎる。ピークは元々そろっている）
 * 大きくする時に割れないよう、ピークは -1.5 dBTP までに抑える（ffmpeg loudnorm の2回処理）。
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "packages/web/public");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FFPROBE = process.env.FFPROBE || "ffprobe";
const TRUE_PEAK = -1.5;
const TOLERANCE = 0.7;

/** そろえ方の決まり（上から順に最初に当てはまったもの）。targetがnullならそろえない。 */
const RULES = [
  { match: /^sfx\/(deal|discard|draw)\./, target: null },
  { match: /^sfx\//, target: -18 },
  { match: /^voices\//, target: -18 },
  { match: /^bgm\//, target: -20 },
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** ffmpegを動かし、標準エラー（測定結果が出る）を返す。 */
function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ["-nostdin", "-hide_banner", "-nostats", ...args], { encoding: "utf8" });
  if (r.error) throw new Error(`ffmpegを起動できませんでした（${r.error.message}）`);
  if (r.status !== 0) throw new Error(r.stderr.split("\n").slice(-6).join("\n"));
  return r.stderr;
}

/** loudnormの1回目（測定だけ）。 */
function measure(file, target) {
  const out = ffmpeg(["-i", file, "-af", `loudnorm=I=${target}:TP=${TRUE_PEAK}:LRA=11:print_format=json`, "-f", "null", "-"]);
  const m = out.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) throw new Error(`${file} を測れませんでした`);
  return JSON.parse(m[0]);
}

function probe(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels,bit_rate", "-of", "json", file], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`${file} の形式を読めませんでした`);
  return JSON.parse(r.stdout).streams[0];
}

/**
 * loudnormの「山を抑えて合わせる」処理は3秒より短い音では働かない（ボイスはほとんど1〜2秒）。
 * そこで足りない分だけ音量を上げ、はみ出る山はリミッターで -1.5dB に抑える。
 */
function limitAndGain(file, gainDb) {
  const info = probe(file);
  const ext = extname(file).toLowerCase();
  const codecArgs =
    ext === ".wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "libmp3lame", "-b:a", `${Math.max(128, Math.round(Number(info.bit_rate || 192000) / 1000))}k`];
  const tmp = `${file}.normalizing${ext}`;
  const limit = 10 ** (TRUE_PEAK / 20);
  ffmpeg(["-y", "-i", file, "-af", `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit.toFixed(3)}:level=false`, "-ar", String(info.sample_rate), "-ac", String(info.channels), ...codecArgs, tmp]);
  renameSync(tmp, file);
}

function normalize(file, target, m, linear) {
  const info = probe(file);
  const filter =
    `loudnorm=I=${target}:TP=${TRUE_PEAK}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=${linear}`;
  const ext = extname(file).toLowerCase();
  const codecArgs =
    ext === ".wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "libmp3lame", "-b:a", `${Math.max(128, Math.round(Number(info.bit_rate || 192000) / 1000))}k`];
  const tmp = `${file}.normalizing${ext}`;
  // loudnormは内部で192kHzにするので、元のサンプリング周波数・チャンネル数に戻す。
  ffmpeg(["-y", "-i", file, "-af", filter, "-ar", String(info.sample_rate), "-ac", String(info.channels), ...codecArgs, tmp]);
  renameSync(tmp, file);
}

const check = process.argv.includes("--check");
const files = ["sfx", "voices", "bgm"].flatMap((d) => walk(join(PUBLIC, d))).filter((f) => /\.(wav|mp3)$/i.test(f));
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const backupDir = join(ROOT, "asset-backups", `audio-${stamp}`);
let changed = 0;

for (const file of files) {
  const rel = relative(PUBLIC, file).replace(/\\/g, "/");
  const rule = RULES.find((r) => r.match.test(rel));
  if (!rule || rule.target === null) continue;
  const m = measure(file, rule.target);
  const input = Number(m.input_i);
  if (!Number.isFinite(input)) {
    console.log(`- ${rel}: 短すぎて測れないので触りません`);
    continue;
  }
  const diff = rule.target - input;
  if (Math.abs(diff) <= TOLERANCE) continue;
  console.log(`${check ? "?" : "*"} ${rel}: ${input.toFixed(1)} → ${rule.target} LUFS（${diff > 0 ? "+" : ""}${diff.toFixed(1)}）`);
  if (check) continue;

  mkdirSync(dirname(join(backupDir, rel)), { recursive: true });
  copyFileSync(file, join(backupDir, rel));
  // まずは音量を上げ下げするだけ（音の形を変えない）。ピークが邪魔で目標まで上げられなかった
  // 時だけ、山を少し抑えながら（ダイナミック）目標に合わせる。
  normalize(file, rule.target, m, true);
  const after = Number(measure(file, rule.target).input_i);
  if (Math.abs(rule.target - after) > 1) limitAndGain(file, rule.target - after);
  changed++;
}

if (check) console.log("（--check: 書き換えていません）");
else console.log(changed ? `${changed}個をそろえました。元のファイルは ${relative(ROOT, backupDir)} にあります。` : "そろえる必要のあるファイルはありませんでした。");
