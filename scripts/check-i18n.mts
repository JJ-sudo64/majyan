// 言語辞書の抜け・余り・差し込み欄の食い違いを調べる。使い方: npx tsx scripts/check-i18n.mts
import { ja } from "../packages/web/src/i18n/ja.ts";
import { en } from "../packages/web/src/i18n/en.ts";
import { zh } from "../packages/web/src/i18n/zh.ts";
import { zhHant } from "../packages/web/src/i18n/zh-hant.ts";
import { zhHantData } from "../packages/web/src/i18n/zh-hant-data.ts";
import { enData } from "../packages/web/src/i18n/en-data.ts";
import { zhData } from "../packages/web/src/i18n/zh-data.ts";
import { dataSourceTexts } from "../packages/web/src/i18n/dataOverlay.ts";

const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort().join(",");
let bad = 0;
for (const [name, dict] of [["en", en], ["zh", zh], ["zh-Hant", zhHant]] as const) {
  const missing = Object.keys(ja).filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !(k in ja));
  const mismatch = Object.keys(dict).filter((k) => k in ja && slots((ja as Record<string, string>)[k]!) !== slots((dict as Record<string, string>)[k]!));
  console.log(`${name}: 抜け ${missing.length} / 余り ${extra.length} / 差し込み欄の不一致 ${mismatch.length}`);
  for (const k of missing.slice(0, 20)) console.log("  抜け", k);
  for (const k of extra) console.log("  余り", k);
  for (const k of mismatch) console.log("  不一致", k, slots((ja as Record<string, string>)[k]!), "→", slots((dict as Record<string, string>)[k]!));
  bad += missing.length + extra.length + mismatch.length;
}
// キャラクター・カード・役名・チュートリアルなどの対訳表（原文 → 各言語）の抜け・余り
const sources = new Set(dataSourceTexts());
for (const [name, table] of [["en-data", enData], ["zh-data", zhData], ["zh-hant-data", zhHantData]] as const) {
  const missing = [...sources].filter((t) => !(t in table) || !(table as Record<string, string>)[t]);
  const extra = Object.keys(table).filter((t) => !sources.has(t));
  console.log(`${name}: 抜け ${missing.length} / 余り ${extra.length}`);
  for (const t of missing.slice(0, 10)) console.log("  抜け", t.slice(0, 40));
  for (const t of extra.slice(0, 10)) console.log("  余り", t.slice(0, 40));
  bad += missing.length + extra.length;
}
process.exit(bad ? 1 : 0);
