// 簡体字の辞書（zh.ts・zh-data.ts）から、繁体字（台湾向け）の辞書を機械変換で作る。
// 使い方: 変換ライブラリを一時フォルダに入れて、その場所を OPENCC_DIR で渡す。
//   npm i --prefix <一時フォルダ> opencc-js
//   OPENCC_DIR=<一時フォルダ> npx tsx scripts/gen-zh-hant.mts
// 出力: packages/web/src/i18n/zh-hant.ts と zh-hant-data.ts（生成物。簡体字を直したら作り直す）
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { zh } from "../packages/web/src/i18n/zh.ts";
import { zhData } from "../packages/web/src/i18n/zh-data.ts";
import { ZH } from "./official-zh.mjs";

const dir = process.env.OPENCC_DIR;
if (!dir) throw new Error("OPENCC_DIR（opencc-js を入れたフォルダ）を指定してください");
const OpenCC = await import(pathToFileURL(join(dir, "node_modules/opencc-js/dist/esm/full.js")).href);
const convert = OpenCC.Converter({ from: "cn", to: "twp" });
// 変換後の手直し（台湾での表記に合わせる）
const fix = (s: string) => convert(s).replaceAll("賬", "帳");

const body = (obj: Record<string, string>, convertKeys: boolean) =>
  Object.entries(obj)
    .map(([k, v]) => `  ${JSON.stringify(convertKeys ? fix(k) : k)}: ${JSON.stringify(fix(v))},`)
    .join("\n");

writeFileSync(
  "packages/web/src/i18n/zh-hant.ts",
  `import type { MessageKey } from "./ja.js";\n\n/** 繁體中文文案。由 scripts/gen-zh-hant.mts 從簡體（zh-1〜4.ts）機械轉換而成，請勿手動編輯。 */\nexport const zhHant: Partial<Record<MessageKey, string>> = {\n${body(zh as Record<string, string>, false)}\n};\n`,
);
writeFileSync(
  "packages/web/src/i18n/zh-hant-data.ts",
  `/** 角色・卡牌・役名等的對譯（日語原文 → 繁體中文）。由 scripts/gen-zh-hant.mts 從 zh-data.ts 機械轉換而成。 */\nexport const zhHantData: Record<string, string> = {\n${body(zhData, false)}\n};\n`,
);
// 公式ページ（/zh-tw/）の置き換え表
writeFileSync(
  "scripts/official-zh-hant.mjs",
  `/** 公式ページ繁体字版（/zh-tw/）の文言。official-zh.mjs を scripts/gen-zh-hant.mts で機械変換したもの（手で直さない）。 */\nexport const ZH_HANT = [\n${ZH.map((v: string) => `  ${JSON.stringify(fix(v))},`).join("\n")}\n];\n`,
);
console.log("生成しました");
