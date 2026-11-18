import { create } from "zustand";
import { ja, type MessageKey } from "./ja.js";

/** 対応言語。新しい言語を足すときは、ここに足して dictionaries に辞書を登録する。 */
export const LOCALES = [{ id: "ja", label: "日本語" }] as const;
export type Locale = (typeof LOCALES)[number]["id"];

type Dictionary = Partial<Record<MessageKey, string>>;
const dictionaries: Record<Locale, Dictionary> = { ja };

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

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: typeof window === "undefined" ? "ja" : loadInitialLocale(),
  setLocale: (locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // 保存できなくても、このセッション中は切り替わる
    }
    set({ locale });
  },
}));

/** 文言を引く。選んだ言語に無ければ日本語、日本語にも無ければキー名を返す。{name} は params で差し込む。 */
export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const raw = dictionaries[locale][key] ?? ja[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
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

export type { MessageKey };
