import { create } from "zustand";
import { Fragment, createElement, type ReactNode } from "react";
import { ja, type MessageKey } from "./ja.js";
import { en } from "./en.js";
import { enData } from "./en-data.js";
import { applyDataLocale } from "./dataOverlay.js";

/** 対応言語。新しい言語を足すときは、ここに足して dictionaries に辞書を登録する。 */
export const LOCALES = [
  { id: "ja", label: "日本語", tag: "ja-JP" },
  { id: "en", label: "English", tag: "en-US" },
] as const;
export type Locale = (typeof LOCALES)[number]["id"];

type Dictionary = Partial<Record<MessageKey, string>>;
const dictionaries: Record<Locale, Dictionary> = { ja, en };
/** キャラクター・カードの日本語原文 → 翻訳。日本語は原文のままなので空。 */
const dataTables: Record<Locale, Record<string, string>> = { ja: {}, en: enData };

const STORAGE_KEY = "majyan.locale";

function loadInitialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in dictionaries) return saved as Locale;
  } catch {
    // localStorageが使えない環境では既定の日本語で始める
  }
  return "ja";
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const initialLocale: Locale = typeof window === "undefined" ? "ja" : loadInitialLocale();
applyDataLocale(dataTables[initialLocale]);

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // 保存できなくても、このセッション中は切り替わる
    }
    applyDataLocale(dataTables[locale]);
    set({ locale });
  },
}));

/** 日付・数字の書式に使う言語タグ（例: ja-JP）。 */
export function localeTag(locale: Locale): string {
  return LOCALES.find((l) => l.id === locale)!.tag;
}

/** コンポーネント用。選んでいる言語の書式タグ。 */
export function useLocaleTag(): string {
  return localeTag(useLocaleStore((s) => s.locale));
}

/** 文言を引く。選んだ言語に無ければ日本語、日本語にも無ければキー名を返す。{name} は params で差し込む。 */
export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const raw = dictionaries[locale][key] ?? ja[key] ?? key;
  const out = params ? raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : raw;
  // 差し込み欄が残っているのは、呼び出し側の渡し忘れ（または要素を渡すべき所に t を使った）。開発中だけ知らせる。
  if (import.meta.env.DEV && /\{\w+\}/.test(out)) console.warn(`[i18n] 差し込み欄が残っています: ${key} → ${out}`);
  return out;
}

/** 文言の中に太字などの要素を差し込む版。{名前} の所に、params の要素（ReactNode）が入る。 */
export function translateNode(locale: Locale, key: MessageKey, params: Record<string, ReactNode> = {}): ReactNode {
  const raw = dictionaries[locale][key] ?? ja[key] ?? key;
  const parts = raw.split(/(\{\w+\})/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m && m[1]! in params) return createElement(Fragment, { key: i }, params[m[1]!]);
      return part ? createElement(Fragment, { key: i }, part) : null;
    }),
  );
}

/** コンポーネント用。言語を切り替えると、使っている画面が再描画される。 */
export function useT(): (key: MessageKey, params?: Record<string, string | number>) => string {
  const locale = useLocaleStore((s) => s.locale);
  return (key, params) => translate(locale, key, params);
}

/** 風（1=東 2=南 3=西 4=北）の表示用キー。 */
export function windKey(wind: 1 | 2 | 3 | 4): MessageKey {
  return `wind.${wind}` as MessageKey;
}

/** 座席（0=自分 1=下家 2=対面 3=上家）の呼び名のキー。 */
export function seatKey(seat: number): MessageKey {
  return `seat.${seat}` as MessageKey;
}

/** CPU席（1=下家 2=対面 3=上家）の呼び名のキー。 */
export function cpuSeatKey(seat: number): MessageKey {
  return `seat.cpu${seat}` as MessageKey;
}

/** コンポーネントの外（ストアなど）用。今選んでいる言語で文言を引く。 */
export function tr(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(useLocaleStore.getState().locale, key, params);
}

/** coreが日本語で出してくる文言（役名・満貫などの名前）を、今の言語に直す。対訳が無ければそのまま。 */
export function tx(text: string): string {
  return dataTables[useLocaleStore.getState().locale][text] ?? text;
}

/** 要素を差し込める版を返す。言語を切り替えると再描画される。 */
export function useTn(): (key: MessageKey, params?: Record<string, ReactNode>) => ReactNode {
  const locale = useLocaleStore((s) => s.locale);
  return (key, params) => translateNode(locale, key, params);
}

/** 文言を引く関数の型（部品の外の補助関数に渡す用）。 */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export type { MessageKey };

/** 段位名（「雀帝3」など）を今の言語に直す。段位名の部分だけ対訳表で直し、段の数字は残す。 */
export function txRank(label: string): string {
  const m = /^(下雀|中雀|上雀|雀王|雀帝|雀神)(\d*)$/.exec(label);
  if (!m) return label;
  const name = tx(m[1]!);
  return name === m[1] ? label : m[2] ? `${name} ${m[2]}` : name;
}
