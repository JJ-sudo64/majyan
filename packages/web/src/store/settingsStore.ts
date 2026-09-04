import { create } from "zustand";

const STORAGE_KEY = "majyan.bgmVolume";
// 以前は0.35固定だったが「音量がデカすぎる」との指摘を受けて控えめな値に
// 下げつつ、ユーザーが自分で調整できるようにする（下のuseSettingsStore参照）。
const DEFAULT_BGM_VOLUME = 0.15;
const AUTO_TSUMOGIRI_KEY = "majyan.autoTsumogiri";
const AUTO_WIN_KEY = "majyan.autoWin";

function loadInitialVolume(): number {
  if (typeof window === "undefined") return DEFAULT_BGM_VOLUME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_BGM_VOLUME;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_BGM_VOLUME;
  } catch {
    return DEFAULT_BGM_VOLUME;
  }
}

function loadInitialBoolean(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

interface SettingsState {
  /** BGM音量(0〜1)。localStorageに保存し、対局をまたいで（タイトルへ戻っても）覚えておく。 */
  bgmVolume: number;
  setBgmVolume: (volume: number) => void;
  /** ONの間、自分の手番でツモった牌に他の選択肢（和了・リーチ等）が無ければ
      少し待ってから自動でツモ切りする（じゃんたま等の「自動ツモ切り」相当）。 */
  autoTsumogiri: boolean;
  setAutoTsumogiri: (value: boolean) => void;
  /** ONの間、ツモ和了・ロンが可能になった瞬間、ボタンを押さず自動で和了する
      （じゃんたま等の「自動和了」相当）。 */
  autoWin: boolean;
  setAutoWin: (value: boolean) => void;
}

function persistBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // プライベートブラウジング等でlocalStorageが使えなくても、今回のセッション中は
    // 通常通り効くので黙って無視する。
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  bgmVolume: loadInitialVolume(),
  setBgmVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ bgmVolume: clamped });
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // プライベートブラウジング等でlocalStorageが使えなくても、今回のセッション中は
      // 通常通り効くので黙って無視する。
    }
  },
  autoTsumogiri: loadInitialBoolean(AUTO_TSUMOGIRI_KEY),
  setAutoTsumogiri: (value) => {
    set({ autoTsumogiri: value });
    persistBoolean(AUTO_TSUMOGIRI_KEY, value);
  },
  autoWin: loadInitialBoolean(AUTO_WIN_KEY),
  setAutoWin: (value) => {
    set({ autoWin: value });
    persistBoolean(AUTO_WIN_KEY, value);
  },
}));
