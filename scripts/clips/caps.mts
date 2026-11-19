// 縦動画の字幕用データ(caps.json)を作る。使い方: npx tsx scripts/clips/caps.mts <zh|zh-Hant|en> <出力.json>
import { writeFileSync } from "node:fs";
import { CHARACTERS } from "../../packages/core/src/index.ts";
import { enData } from "../../packages/web/src/i18n/en-data.ts";
import { zhData } from "../../packages/web/src/i18n/zh-data.ts";
import { zhHantData } from "../../packages/web/src/i18n/zh-hant-data.ts";

const [lang, outPath] = process.argv.slice(2);
const table: Record<string, string> = lang === "zh" ? zhData : lang === "zh-Hant" ? zhHantData : enData;
const tr = (t: string) => table[t] ?? t;
const IDS = ["deagari", "jin", "kaede", "koji", "koki", "mirai", "nannan", "nyanjiro", "ren", "sena", "subaru", "takaharu", "zeno", "hiiragi", "kagerou", "masato", "nagi", "runa", "toki"];

const out: Record<string, unknown> = {};
for (const id of IDS) {
  const c = (CHARACTERS as Record<string, any>)[id];
  const full = tr(c.name);
  const i = full.lastIndexOf("·");
  const short = lang === "en" ? full.split(", ")[0]! : i >= 0 ? full.slice(i + 1) : full;
  // 説明の1文目（短すぎる時は2文）。
  const sents = tr(c.skill.description).split(/(?<=[。.])\s*/).filter(Boolean);
  const first = sents[0]!.length < 18 && sents[1] ? `${sents[0]}${lang === "en" ? " " : ""}${sents[1]}` : sents[0]!;
  out[id] = { short, skill: tr(c.skill.name), first, voice: c.voiceClips?.skillActivate, sfx: c.skillActivateSfx ?? null };
}
writeFileSync(outPath!, JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, "件");
