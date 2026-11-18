// キャラクター・必殺技・カードの日本語原文を、翻訳用の対訳表の雛形として書き出す。
// 使い方: npx tsx scripts/export-data-strings.mts  →  drafts/i18n-data-strings.json
import { writeFileSync } from "node:fs";
import { dataSourceTexts } from "../packages/web/src/i18n/dataOverlay.ts";

const texts = dataSourceTexts();
const table = Object.fromEntries(texts.map((t) => [t, ""]));
writeFileSync("drafts/i18n-data-strings.json", JSON.stringify(table, null, 2) + "\n");
console.log(`${texts.length} 件を書き出しました`);
