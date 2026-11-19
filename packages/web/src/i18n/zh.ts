import { zh1 } from "./zh-1.js";
import { zh2 } from "./zh-2.js";
import { zh3 } from "./zh-3.js";
import { zh4 } from "./zh-4.js";
import type { MessageKey } from "./ja.js";

/** 简体中文的文案。键与 ja.ts 相同。缺少的键会以日语显示（用 check-i18n 检测缺漏）。 */
export const zh: Partial<Record<MessageKey, string>> = { ...zh1, ...zh2, ...zh3, ...zh4 };
