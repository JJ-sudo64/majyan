import { create } from "zustand";

const STORAGE_KEY = "majyan.bgmVolume";
// 以前は0.35固定だったが「音量がデカすぎる」との指摘を受けて控えめな値に
// 下げつつ、ユーザーが自分で調整できるようにする（下のuseSettingsStore参照）。
const DEFAULT_BGM_VOLUME = 0.15;
const SE_STORAGE_KEY = "majyan.seVolume";
// 打牌/ツモ/リーチ棒等の効果音、キャラのボイス・掛け声のTTSが対象。
// BGMより前面で聞こえてほしいのでBGMのデフォルトより高めにしておく。
const DEFAULT_SE_VOLUME = 0.6;
const AUTO_TSUMOGIRI_KEY = "majyan.autoTsumogiri";
const AUTO_WIN_KEY = "majyan.autoWin";
const TILE3D_ENABLED_KEY = "majyan.tile3dEnabled";

function loadInitialBooleanDefaultTrue(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

function loadInitialVolume(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  } catch {
    return fallback;
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
  /** 効果音・ボイス音量(0〜1)。打牌/ツモ/リーチ棒等の効果音と、キャラの
      収録ボイス・掛け声のTTS音量の両方に効く（BGMとは独立）。 */
  seVolume: number;
  setSeVolume: (volume: number) => void;
  /** ONの間、自分の手番でツモった牌に他の選択肢（和了・リーチ等）が無ければ
      少し待ってから自動でツモ切りする（じゃんたま等の「自動ツモ切り」相当）。 */
  autoTsumogiri: boolean;
  setAutoTsumogiri: (value: boolean) => void;
  /** ONの間、ツモ和了・ロンが可能になった瞬間、ボタンを押さず自動で和了する
      （じゃんたま等の「自動和了」相当）。 */
  autoWin: boolean;
  setAutoWin: (value: boolean) => void;
  /** ONの間、下家・上家の伏せ手牌をCSS 3D(Tile3D)の立体牌で表示する。
      OFFの間は従来の2D（帯だけの表現）にフォールバックする。GPUの合成
      負荷が高い環境（弱いGPU、ハードウェアアクセラレーションが実質使えない
      ブラウザ等）でタブが真っ白のまま固まる/開けなくなる不具合が実機で
      発覚したため、ユーザー自身がいつでも切り替えられるようにした。
      既定はtrue（既存の見た目を維持）。 */
  tile3dEnabled: boolean;
  setTile3dEnabled: (value: boolean) => void;
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
  bgmVolume: loadInitialVolume(STORAGE_KEY, DEFAULT_BGM_VOLUME),
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
  seVolume: loadInitialVolume(SE_STORAGE_KEY, DEFAULT_SE_VOLUME),
  setSeVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ seVolume: clamped });
    try {
      window.localStorage.setItem(SE_STORAGE_KEY, String(clamped));
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
  tile3dEnabled: loadInitialBooleanDefaultTrue(TILE3D_ENABLED_KEY),
  setTile3dEnabled: (value) => {
    set({ tile3dEnabled: value });
    persistBoolean(TILE3D_ENABLED_KEY, value);
  },
}));
