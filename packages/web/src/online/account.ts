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
  type FirstGachaState,
  type GachaRollResponse,
  type JadeBalance,
  type ApiErrorResponse,
  type GuestAccountResponse,
  type MeResponse,
  type RankView,
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
  rank: RankView | null;
  /** 持っているキャラのID。 */
  characters: string[];
  /** 持っているキャラごとの数（1なら0凸）。 */
  characterCopies: Record<string, number>;
  exchangePoints: number;
  firstGacha: FirstGachaState | null;
  jade: JadeBalance | null;
  /** 直前に受け取ったログインボーナス（お知らせを出したら画面側でnullに戻す）。 */
  dailyBonusNotice: number | null;
  error: string | null;
}

export const useAccountStore = create<AccountState>(() => ({
  status: "unknown",
  profile: null,
  rank: null,
  characters: [],
  characterCopies: {},
  exchangePoints: 0,
  firstGacha: null,
  jade: null,
  dailyBonusNotice: null,
  error: null,
}));

/** /api/me 等の返り値をストアに反映する。 */
function applyMe(me: MeResponse) {
  useAccountStore.setState({
    status: "ready",
    profile: me.profile,
    rank: me.rank,
    characters: me.characters,
    characterCopies: me.characterCopies,
    exchangePoints: me.exchangePoints,
    firstGacha: me.firstGacha,
    jade: me.jade,
    ...(me.dailyBonus ? { dailyBonusNotice: me.dailyBonus } : {}),
    error: null,
  });
}

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
  // 読み込み済みのアカウントを最新にするだけ（段位の更新等）なら、画面を「確認中」に戻さない。
  if (useAccountStore.getState().status !== "ready") useAccountStore.setState({ status: "loading", error: null });
  try {
    applyMe(await api<MeResponse>("/me"));
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
    // 段位などはアカウントを作った後に読み込む。
    void loadAccount();
  } catch (err) {
    useAccountStore.setState({ status: "none", error: (err as Error).message });
  }
}

export async function renameAccount(displayName: string): Promise<void> {
  try {
    applyMe(await api<MeResponse>("/me/name", { method: "POST", body: JSON.stringify({ displayName }) }));
  } catch (err) {
    useAccountStore.setState({ error: (err as Error).message });
  }
}

/** 最初の10連を引く（確定するまで何度でも引き直せる）。抽選はサーバーで行う。 */
export async function rollFirstGacha(): Promise<void> {
  try {
    applyMe(await api<MeResponse>("/first-gacha/roll", { method: "POST", body: "{}" }));
  } catch (err) {
    useAccountStore.setState({ error: (err as Error).message });
  }
}

/** 今出ている10連の結果で確定して、キャラを受け取る。 */
export async function confirmFirstGacha(): Promise<void> {
  try {
    applyMe(await api<MeResponse>("/first-gacha/confirm", { method: "POST", body: "{}" }));
  } catch (err) {
    useAccountStore.setState({ error: (err as Error).message });
  }
}

/** 雀玉でガチャを引く（1回または10連）。結果を返す。失敗したらnull（理由はerrorに入る）。 */
export async function rollGacha(count: 1 | 10): Promise<GachaRollResponse | null> {
  try {
    const res = await api<GachaRollResponse>("/gacha/roll", { method: "POST", body: JSON.stringify({ count }) });
    applyMe(res.me);
    return res;
  } catch (err) {
    useAccountStore.setState({ error: (err as Error).message });
    return null;
  }
}

/** 交換ポイントで★3のキャラを1人もらう（天井）。 */
export async function exchangeCharacter(characterId: string): Promise<GachaRollResponse | null> {
  try {
    const res = await api<GachaRollResponse>("/gacha/exchange", { method: "POST", body: JSON.stringify({ characterId }) });
    applyMe(res.me);
    return res;
  } catch (err) {
    useAccountStore.setState({ error: (err as Error).message });
    return null;
  }
}
