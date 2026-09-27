import type { StateStorage } from "zustand/middleware";

/**
 * zustand persist用のストレージ。調整値をブラウザのlocalStorageではなく
 * 開発サーバー経由でリポジトリ内のファイル(packages/web/tuning/<ストア名>.json、
 * tuningFilePlugin.ts参照)に保存し、どのブラウザで開いても同じ値にする。
 * localStorageはブラウザごとに別物なので、Edgeで詰めた河の配置がAvastでは
 * 反映されない、という事故が実際に起きたため。
 *
 * ・共有モード(tuning/に1つでもファイルがある)：読み込みはファイルだけを
 *   見る。そのブラウザのlocalStorageは一切見ない（古い値が混ざらないように）。
 *   ファイルが無いストアは初期値のまま始まり、最初の変更でファイルが作られる。
 * ・tuning/が空、またはサーバーAPIが無い(ビルド版をファイルで開いた等)時は、
 *   従来どおりそのブラウザのlocalStorageだけを使う。
 * ・最初の1回だけ、調整済みのブラウザで `?seed-tuning` を付けて開くと、その
 *   ブラウザのlocalStorageの値をファイルへ書き出す（既存ファイルは上書きしない）。
 *
 * ストアは生成された瞬間に同期的にhydrateするので、ファイルの中身は
 * main.tsxでストアを含むモジュールを読み込む前に loadSharedTuning() で
 * 先読みしておく（非同期hydrateにすると一瞬初期値で描画されてしまう）。
 */

/** ファイル共有の対象にするpersistストアのname。 */
const SHARED_STORE_NAMES = ["tile3d-debug-store", "background-debug-store", "table-background-store"] as const;

const WRITE_DEBOUNCE_MS = 400;

let sharedMode = false;
const cache = new Map<string, string>();
const pendingWrites = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function safeLocalGet(name: string): string | null {
  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

function safeLocalSet(name: string, value: string): void {
  try {
    window.localStorage.setItem(name, value);
  } catch {
    // プライベートブラウジング等で使えなくても、ファイル側に保存できれば問題ない
  }
}

async function fetchAll(): Promise<Record<string, string> | null> {
  try {
    const res = await fetch("/__tuning", { cache: "no-store" });
    if (!res.ok || !res.headers.get("Content-Type")?.includes("application/json")) return null;
    return (await res.json()) as Record<string, string>;
  } catch {
    return null;
  }
}

function put(name: string, value: string, opts: { onlyIfMissing?: boolean; keepalive?: boolean } = {}): Promise<Response> {
  const q = opts.onlyIfMissing ? "?onlyIfMissing=1" : "";
  return fetch(`/__tuning/${name}${q}`, { method: "PUT", body: value, keepalive: opts.keepalive });
}

function flush(keepalive = false): void {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  for (const [name, value] of pendingWrites) {
    put(name, value, { keepalive }).catch((e) => console.error(`[tuning] ${name} の保存に失敗`, e));
  }
  pendingWrites.clear();
}

export async function loadSharedTuning(): Promise<void> {
  let files = await fetchAll();
  if (!files) return;

  const params = new URLSearchParams(window.location.search);
  if (params.has("seed-tuning")) {
    for (const name of SHARED_STORE_NAMES) {
      const local = safeLocalGet(name);
      if (local !== null && files[name] === undefined) await put(name, local, { onlyIfMissing: true });
    }
    params.delete("seed-tuning");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    files = (await fetchAll()) ?? files;
  }

  if (Object.keys(files).length === 0) return;
  sharedMode = true;
  for (const [name, value] of Object.entries(files)) cache.set(name, value);

  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

export const sharedTuningStorage: StateStorage = {
  getItem: (name) => (sharedMode ? cache.get(name) ?? null : safeLocalGet(name)),
  setItem: (name, value) => {
    safeLocalSet(name, value);
    if (!sharedMode) return;
    cache.set(name, value);
    pendingWrites.set(name, value);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(), WRITE_DEBOUNCE_MS);
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // 何もしない
    }
  },
};
