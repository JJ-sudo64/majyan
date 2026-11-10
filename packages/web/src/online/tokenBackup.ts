/**
 * ログインの鍵（アカウントの本体）をブラウザの外へ失くさないための補助。
 *
 * 鍵は localStorage に1つだけ置いていたため、ブラウザのデータ削除や、localStorageだけが消える
 * 状況で、アカウントがサーバーに残っていても、画面からは「アカウントなし」に見えて戻れなかった。
 * そこで次の3つを足す（どれも失敗しても何も起きない。保存できない環境（プライベートウィンドウ等）では何もしない）:
 *
 * 1. 鍵の控えを IndexedDB にも置く。localStorage だけが消えた時、起動時に自動で戻す。
 * 2. 「このブラウザでアカウントを作ったことがある」という目印を Cookie に残す（鍵そのものは入れない）。
 *    鍵が無いのに目印がある時は、「前のアカウントの情報が消えたようです」と案内できる。
 * 3. ブラウザに「このサイトの保存は消さないで」と申請する（navigator.storage.persist）。
 */

const DB_NAME = "majyan-account";
const STORE = "kv";
const TOKEN_KEY = "token";
const MARKER_COOKIE = "majyan_had_account";
/** 目印の有効期間（約400日。ブラウザが許す上限に近い）。 */
const MARKER_MAX_AGE_S = 400 * 24 * 60 * 60;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbRun<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => {
        db.close();
        resolve(req.result);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** 鍵の控えを IndexedDB に置く（null なら消す）。 */
export async function mirrorToken(token: string | null): Promise<void> {
  if (token) await idbRun("readwrite", (s) => s.put(token, TOKEN_KEY));
  else await idbRun("readwrite", (s) => s.delete(TOKEN_KEY));
}

/** IndexedDB の控えを読む（無い・読めない時は null）。 */
export async function readMirroredToken(): Promise<string | null> {
  const v = await idbRun<unknown>("readonly", (s) => s.get(TOKEN_KEY));
  return typeof v === "string" && v.length >= 20 ? v : null;
}

/** 「このブラウザでアカウントを作った」目印を残す／消す。 */
export function setAccountMarker(on: boolean): void {
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${MARKER_COOKIE}=${on ? "1" : ""}; max-age=${on ? MARKER_MAX_AGE_S : 0}; path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookie が使えない環境では目印なし（案内が出ないだけ）。
  }
}

export function hasAccountMarker(): boolean {
  try {
    return document.cookie.split("; ").some((c) => c === `${MARKER_COOKIE}=1`);
  } catch {
    return false;
  }
}

let persistRequested = false;
/** ブラウザに「このサイトの保存を消さないで」と申請する（ページを開いている間に1回だけ。断られても何も起きない）。 */
export function requestPersistentStorage(): void {
  if (persistRequested) return;
  persistRequested = true;
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // 非対応の環境では何もしない。
  }
}
