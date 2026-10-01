/**
 * ネット対戦用のアカウント（今はゲストアカウントだけ）。
 *
 * サーバーから受け取ったログイン用の鍵をこのブラウザに保存しておき、次回からは
 * それで本人確認する。鍵が消える（ブラウザのデータを消した等）とアカウントに
 * 戻れなくなるため、いずれ引き継ぎコードやGoogle等でのログインを足す。
 */
import { create } from "zustand";
import {
  ONLINE_API_PREFIX,
  type AccountProfile,
  type ApiErrorResponse,
  type GuestAccountResponse,
  type MeResponse,
} from "@majyan/core";

const TOKEN_KEY = "majyan.account.token";

type AccountStatus =
  /** まだ保存済みの鍵を確かめていない */
  | "unknown"
  | "loading"
  /** アカウントが無い（名前を決めて作る） */
  | "none"
  | "ready";

interface AccountState {
  status: AccountStatus;
  profile: AccountProfile | null;
  error: string | null;
}

export const useAccountStore = create<AccountState>(() => ({ status: "unknown", profile: null, error: null }));

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 保存できない環境（プライベートブラウズ等）では、ページを開いている間だけ使える。
  }
}

/** 保存できなかった時のための、このページを開いている間の控え。 */
let memoryToken: string | null = null;

export function accountToken(): string | null {
  return memoryToken ?? loadToken();
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = accountToken();
  const res = await fetch(`${ONLINE_API_PREFIX}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorResponse>) | null;
  if (!res.ok || !body) {
    const error = new Error(body?.error ?? "サーバーにつながりませんでした（サーバーが起動しているか確認してください）");
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return body;
}

/** 保存済みの鍵があれば、そのアカウントを読み込む。 */
export async function loadAccount(): Promise<void> {
  if (!accountToken()) {
    useAccountStore.setState({ status: "none", profile: null, error: null });
    return;
  }
  useAccountStore.setState({ status: "loading", error: null });
  try {
    const { profile } = await api<MeResponse>("/me");
    useAccountStore.setState({ status: "ready", profile });
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      // サーバー側にアカウントが無い（鍵が古い等）。作り直してもらう。
      saveToken(null);
      memoryToken = null;
      useAccountStore.setState({ status: "none", profile: null, error: null });
    } else {
      useAccountStore.setState({ status: "unknown", error: (err as Error).message });
    }
  }
}

export async function createGuestAccount(displayName: string): Promise<void> {
  useAccountStore.setState({ status: "loading", error: null });
  try {
    const { token, profile } = await api<GuestAccountResponse>("/guest", {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    memoryToken = token;
    saveToken(token);
    useAccountStore.setState({ status: "ready", profile });
  } catch (err) {
    useAccountStore.setState({ status: "none", error: (err as Error).message });
  }
}

export async function renameAccount(displayName: string): Promise<void> {
  try {
    const { profile } = await api<MeResponse>("/me/name", { method: "POST", body: JSON.stringify({ displayName }) });
    useAccountStore.setState({ profile, error: null });
  } catch (err) {
    useAccountStore.setState({ error: (err as Error).message });
  }
}
