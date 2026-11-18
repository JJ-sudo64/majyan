import { en1 } from "./en-1.js";
import { en2 } from "./en-2.js";
import { en3 } from "./en-3.js";
import { en4 } from "./en-4.js";
import type { MessageKey } from "./ja.js";

/** 英語の文言。ja.ts のキーと同じ。足りないキーは日本語で表示される（check-i18n で抜けを検出）。 */
export const en: Partial<Record<MessageKey, string>> = { ...en1, ...en2, ...en3, ...en4 };
