/**
 * ネット対戦用のアカウント（ゲストアカウント＋引き継ぎコード）。
 *
 * サーバーから受け取ったログイン用の鍵をこのブラウザに保存しておき、次回からは
 * それで本人確認する。鍵が消える（ブラウザのデータを消した等）と、引き継ぎの
 * パスワードを決めていない限りアカウントに戻れない。
 */
import { create } from "zustand";
import {
  ONLINE_API_PREFIX,
  type AccountProfile,
  type CharacterUnit,
  type GachaItem,
  type FirstGachaState,
  type GachaRollResponse,
  type GiftClaimResponse,
  type MissionClaimResponse,
  type MissionsResponse,
  type InboxResponse,
  type JadeBalance,
  type ApiErrorResponse,
  type GuestAccountResponse,
  type MeResponse,
  type RankView,
  type RankedHistoryResponse,
  type RecordsResponse,
  type RankingResponse,
  type TransferCodeResponse,
} from "@majyan/core";

const TOKEN_KEY = "majyan.account.token";
/** 最後に読んだお知らせのID（未読の印を消すため。ブラウザごとでよい）。 */
const SEEN_NEWS_KEY = "majyan.news.seen";

function loadSeenAnnouncementId(): number {
  try {
    return Number(localStorage.getItem(SEEN_NEWS_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** お知らせを開いたら、今出ている分を読んだことにする。 */
export function markAnnouncementsSeen(latestId: number | null) {
  if (latestId === null || latestId <= useAccountStore.getState().seenAnnouncementId) return;
  useAccountStore.setState({ seenAnnouncementId: latestId });
  try {
    localStorage.setItem(SEEN_NEWS_KEY, String(latestId));
  } catch {
    // 保存できなくても、このページを開いている間は既読になる。
  }
}

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
  /** 手持ちのキャラ（同じキャラでも1体ずつ別。付けたカードも入る）。 */
  units: CharacterUnit[];
  /** まだどのキャラにも付けていないカードの枚数。 */
  cards: Record<string, number>;
  exchangePoints: number;
  firstGacha: FirstGachaState | null;
  jade: JadeBalance | null;
  /** 直前に受け取ったログインボーナス（お知らせを出したら画面側でnullに戻す）。 */
  dailyBonusNotice: number | null;
  /** 受け取っていないプレゼントの数。 */
  unclaimedGifts: number;
  /** 今出ているお知らせの一番新しいID（未読の印に使う）。 */
  latestAnnouncementId: number | null;
  /** このブラウザで最後に読んだお知らせのID。 */
  seenAnnouncementId: number;
  /** 達成して報酬を受け取っていないミッションの数。 */
  claimableMissions: number;
  error: string | null;
}

export const useAccountStore = create<AccountState>(() => ({
  status: "unknown",
  profile: null,
  rank: null,
  units: [],
  cards: {},
  exchangePoints: 0,
  firstGacha: null,
  jade: null,
  dailyBonusNotice: null,
  unclaimedGifts: 0,
  latestAnnouncementId: null,
  seenAnnouncementId: loadSeenAnnouncementId(),
  claimableMissions: 0,
  error: null,
}));

/** /api/me 等の返り値をストアに反映する。 */
function applyMe(me: MeResponse) {
  useAccountStore.setState({
    status: "ready",
    profile: me.profile,
    rank: me.rank,
    units: me.units,
    cards: me.cards,
    exchangePoints: me.exchangePoints,
    firstGacha: me.firstGacha,
    jade: me.jade,
    unclaimedGifts: me.unclaimedGifts,
    latestAnnouncementId: me.latestAnnouncementId,
    claimableMissions: me.claimableMissions,
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

/** 交換ポイントで★3のキャラかカードを1つもらう（天井）。 */
export async function exchangeItem(item: GachaItem): Promise<GachaRollResponse | null> {
  try {
    const res = await api<GachaRollResponse>("/gacha/exchange", { method: "POST", body: JSON.stringify({ item }) });
    applyMe(res.me);
    return res;
  } catch (err) {
    useAccountStore.setState({ error: (err as Error).message });
    return null;
  }
}

/** 手持ちのキャラにカードを付ける（一度付けたら外せない）。成功したらtrue。 */
export async function equipCard(unitId: string, cardId: string): Promise<boolean> {
  try {
    applyMe(await api<MeResponse>("/units/equip", { method: "POST", body: JSON.stringify({ unitId, cardId }) }));
    return true;
  } catch (err) {
    useAccountStore.setState({ error: (err as Error).message });
    return false;
  }
}

/** 引き継ぎコード（パスワードをまだ決めていなければnull）。読めなければ例外。 */
/** お知らせと、受け取れるプレゼント。 */
export async function fetchInbox(): Promise<InboxResponse> {
  return api<InboxResponse>("/inbox");
}

/** プレゼントを受け取る（giftIdがnullなら全部）。受け取った中身を返す。 */
export async function claimGifts(giftId: number | null): Promise<GiftClaimResponse> {
  const res = await api<GiftClaimResponse>("/gifts/claim", { method: "POST", body: JSON.stringify(giftId === null ? {} : { giftId }) });
  applyMe(res.me);
  return res;
}

/** 雀玉の増減とガチャの結果の履歴。 */
export async function fetchRecords(): Promise<RecordsResponse> {
  return api<RecordsResponse>("/me/records");
}

/** 今日のデイリーミッション。 */
export async function fetchMissions(): Promise<MissionsResponse> {
  return api<MissionsResponse>("/missions");
}

/** 達成したミッションの報酬を受け取る（missionIdがnullなら全部）。 */
export async function claimMissions(missionId: string | null): Promise<MissionClaimResponse> {
  const res = await api<MissionClaimResponse>("/missions/claim", {
    method: "POST",
    body: JSON.stringify(missionId === null ? {} : { missionId }),
  });
  applyMe(res.me);
  return res;
}

/** 段位のランキング。 */
export async function fetchRanking(): Promise<RankingResponse> {
  return api<RankingResponse>("/ranking");
}

/** 退会する（取り消せない）。成功したらこのブラウザからもアカウントを外す。失敗したら例外。 */
export async function deleteAccount(confirm: string): Promise<void> {
  await api<object>("/me/delete", { method: "POST", body: JSON.stringify({ confirm }) });
  clearLocalAccount();
}

/** 段位戦の戦績。 */
export async function fetchRankedHistory(): Promise<RankedHistoryResponse> {
  return api<RankedHistoryResponse>("/me/history");
}

export async function fetchTransferCode(): Promise<string | null> {
  return (await api<TransferCodeResponse>("/me/transfer")).code;
}

/** 引き継ぎのパスワードを決めて（変えて）、引き継ぎコードを返す。失敗したら例外（理由はmessage）。 */
export async function setTransferPassword(password: string): Promise<string> {
  const { code } = await api<TransferCodeResponse>("/me/transfer", { method: "POST", body: JSON.stringify({ password }) });
  if (!code) throw new Error("引き継ぎコードを作れませんでした");
  return code;
}

/**
 * 引き継ぎコードとパスワードでアカウントに入る。このブラウザに今のアカウントが
 * あれば、それとは入れ替わる（今のアカウントの鍵は消える）。失敗したら例外。
 */
export async function loginWithTransfer(code: string, password: string): Promise<void> {
  const { token, profile } = await api<GuestAccountResponse>("/transfer", {
    method: "POST",
    body: JSON.stringify({ code, password }),
  });
  memoryToken = token;
  saveToken(token);
  useAccountStore.setState({ status: "ready", profile, error: null });
  await loadAccount();
}

/**
 * 開発用: このブラウザからアカウントを外して、名前入力（新しいアカウント作り）からやり直す。
 * サーバー側のアカウントは残るので、引き継ぎのパスワードを決めてあれば戻れる。
 */
export function forgetAccountForTesting(): void {
  clearLocalAccount();
}

/** このブラウザからアカウントの鍵と読み込んだ中身を消す。 */
function clearLocalAccount(): void {
  memoryToken = null;
  saveToken(null);
  useAccountStore.setState({
    status: "none",
    profile: null,
    rank: null,
    units: [],
    cards: {},
    exchangePoints: 0,
    firstGacha: null,
    jade: null,
    dailyBonusNotice: null,
    unclaimedGifts: 0,
    latestAnnouncementId: null,
    claimableMissions: 0,
    error: null,
  });
}

/**
 * 開発用: 手持ちと最初の10連を、アカウントを作った直後の状態に戻す（サーバーが --dev-tools の時だけ）。
 * 失敗したら例外（理由はmessage）。
 */
export async function resetCollectionForTesting(): Promise<void> {
  try {
    applyMe(await api<MeResponse>("/dev/reset-collection", { method: "POST", body: "{}" }));
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      throw new Error("ゲームサーバーが開発用の設定で起動していません（start-game.bat か npm run dev:server で起動し直してください）");
    }
    throw err;
  }
}
