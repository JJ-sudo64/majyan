import { useEffect, useState } from "react";
import { CARDS, CHARACTERS, PLAYER_NAME_MAX_LENGTH, ROOM_CODE_MAX_LENGTH, SHOP_RETURN_PARAM, suspensionMessage, characterRarity, type CharacterUnit, type MatchFormat } from "@majyan/core";
import { onlineLink, useOnlineStore } from "../online/onlineLink.js";
import { createGuestAccount, loadAccount, renameAccount, useAccountStore } from "../online/account.js";
import { FirstGacha } from "./FirstGacha.js";
import { GachaScreen } from "./GachaScreen.js";
import { UnitsScreen } from "./UnitsScreen.js";
import { TransferScreen } from "./TransferScreen.js";
import { HistoryScreen } from "./HistoryScreen.js";
import { InboxScreen, type InboxTab } from "./InboxScreen.js";
import { MissionsScreen } from "./MissionsScreen.js";
import { ShopScreen } from "./ShopScreen.js";
import { LegalScreen, TermsConsent } from "./LegalScreen.js";
import { FriendsScreen } from "./FriendsScreen.js";
import { DevAccountTools } from "./DevAccountTools.js";

/** キャラ選択の表示（例: 「★★ 一閃の雷神・ライコ ＋ 点棒吸収」）。 */
function unitLabel(u: CharacterUnit): string {
  const name = CHARACTERS[u.characterId]?.name ?? u.characterId;
  const card = u.cardId ? CARDS[u.cardId]?.name : null;
  return `${"★".repeat(characterRarity(u.characterId))} ${name}${card ? ` ＋ ${card}` : "（カードなし）"}`;
}

/** 上のバー・下のメニューのアイコン（24x24の線画）。 */
const ICON_PATHS = {
  news: "M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3zM10 20a2 2 0 0 0 4 0",
  gift: "M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-7-3-5 0M12 7c2-4 7-3 5 0",
  mission: "M5 4h14v17H5zM9 9l2 2 4-4M9 15h6",
  friends: "M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c2 .8 3.5 2.8 3.5 5.5",
  menu: "M4 6h16M4 12h16M4 18h16",
  gacha: "M12 3l2.6 5.6l6.1 .7l-4.5 4.2l1.2 6l-5.4-3l-5.4 3l1.2-6L3.3 9.3l6.1-.7z",
  units: "M4 5h7v14H4zM13 5h7v14h-7zM6.5 9h2M15.5 9h2",
  history: "M4 20V10M10 20V4M16 20v-7M21 20H3",
  shop: "M12 3l7 5l-7 13L5 8zM5 8h14M9 8l3 13M15 8l-3 13",
} as const;

function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg className="oh-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** 次回の入力を省くため、合言葉を覚えておく（ブラウザごと）。 */
const ROOM_KEY = "majyan.online.room";

function loadSaved(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても入室はできる。
  }
}

/**
 * オンラインの入口（アカウント・段位戦・ガチャ・手持ち・合言葉の友人戦）と待合室。
 * 対局が始まるとサーバーから状態が届き、App.tsxが卓の画面に切り替える。
 * 画面は上のバー（名前・段位・雀玉）、左の立ち絵、右の対戦パネル、下のメニューの4つ。
 */
export function OnlineLobby({ onBack }: { onBack: () => void }) {
  const status = useOnlineStore((s) => s.status);
  const room = useOnlineStore((s) => s.room);
  const members = useOnlineStore((s) => s.members);
  const error = useOnlineStore((s) => s.error);
  const accountStatus = useAccountStore((s) => s.status);
  const profile = useAccountStore((s) => s.profile);
  const accountError = useAccountStore((s) => s.error);
  const rank = useAccountStore((s) => s.rank);
  const units = useAccountStore((s) => s.units);
  const [showUnits, setShowUnits] = useState(false);
  const firstGacha = useAccountStore((s) => s.firstGacha);
  const jade = useAccountStore((s) => s.jade);
  const dailyBonusNotice = useAccountStore((s) => s.dailyBonusNotice);
  const [showGacha, setShowGacha] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [inboxTab, setInboxTab] = useState<InboxTab | null>(null);
  const unclaimedGifts = useAccountStore((s) => s.unclaimedGifts);
  const claimableMissions = useAccountStore((s) => s.claimableMissions);
  const [showMissions, setShowMissions] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  /** 支払いのページから戻ってきた時の印（?shop=done / cancel）。読んだらURLからは消す。 */
  const [shopReturn] = useState(() => new URLSearchParams(window.location.search).get(SHOP_RETURN_PARAM));
  const [showShop, setShowShop] = useState(shopReturn !== null);
  const [showLegal, setShowLegal] = useState(false);
  /** アカウントを作る時の「同意する」のチェック。 */
  const [agreed, setAgreed] = useState(false);
  const termsAccepted = useAccountStore((s) => s.termsAccepted);
  const incomingFriendRequests = useAccountStore((s) => s.incomingFriendRequests);
  const hasUnreadNews = useAccountStore((s) => s.latestAnnouncementId !== null && s.latestAnnouncementId > s.seenAnnouncementId);
  // 最初の10連を確定するまでは、ネット対戦の代わりにガチャ画面を出す。
  const needsFirstGacha = accountStatus === "ready" && firstGacha !== null && !firstGacha.confirmed;
  /** ネット対戦の操作（段位戦・友人戦）を出してよいか。 */
  const ready = !!profile && !needsFirstGacha;
  const queue = useOnlineStore((s) => s.queue);
  const [now, setNow] = useState(() => performance.now());
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [roomCode, setRoomCode] = useState(() => loadSaved(ROOM_KEY));
  /** 対局に出す手持ちのキャラ（付いているカードごと出る）。null=おまかせ。 */
  const [unitId, setUnitId] = useState<string | null>(null);
  const [continueBelowZero, setContinueBelowZero] = useState(false);
  /** 上のバーの「その他」（名前の変更・引き継ぎ・規約）を開いているか。 */
  const [showMenu, setShowMenu] = useState(false);

  const inRoom = status === "lobby";
  const queued = status === "queued";
  const busy = inRoom || queued || status === "connecting";
  const me = members.find((m) => m.isYou);

  useEffect(() => {
    // 段位戦の後に戻ってきた時などに段位を最新にするため、開くたびに読み直す。
    void loadAccount();
  }, []);

  useEffect(() => {
    if (shopReturn === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(SHOP_RETURN_PARAM);
    window.history.replaceState(null, "", url);
  }, [shopReturn]);

  useEffect(() => {
    if (!queued) return;
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, [queued]);

  function join() {
    const trimmedRoom = roomCode.trim();
    if (!trimmedRoom || !profile) return;
    save(ROOM_KEY, trimmedRoom);
    onlineLink.join({ room: trimmedRoom, unitId });
  }

  async function submitName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (profile) {
      await renameAccount(trimmed);
      setRenaming(false);
    } else if (agreed) {
      await createGuestAccount(trimmed);
      // 作った後は欄を空にしておく（開発用の「新しいアカウントで始める」で戻った時に前の名前が残らないように）。
      if (useAccountStore.getState().status !== "none") setName("");
    }
  }

  function changeLoadout(nextUnitId: string | null) {
    setUnitId(nextUnitId);
    if (inRoom) onlineLink.send({ t: "setLoadout", unitId: nextUnitId });
  }

  function start(format: MatchFormat) {
    onlineLink.send({ t: "start", format, continueBelowZero });
  }

  function back() {
    onlineLink.close();
    onBack();
  }

  // 立ち絵に出すキャラ。おまかせの時は手持ちの先頭を薄く出す（誰が出るかは始まるまで決まらない）。
  const shownUnit = units.find((u) => u.unitId === unitId) ?? units[0] ?? null;
  const shownCharacter = shownUnit ? CHARACTERS[shownUnit.characterId] : undefined;
  const chosen = unitId !== null && shownUnit?.unitId === unitId && shownCharacter ? { unit: shownUnit, character: shownCharacter } : null;
  const rankProgress = rank && rank.maxPoints ? Math.min(1, Math.max(0, rank.points / rank.maxPoints)) : 1;

  const overlays = (
    <>
      {showGacha && <GachaScreen onClose={() => setShowGacha(false)} />}
      {showUnits && <UnitsScreen onClose={() => setShowUnits(false)} />}
      {showTransfer && <TransferScreen onClose={() => setShowTransfer(false)} />}
      {showHistory && <HistoryScreen onClose={() => setShowHistory(false)} />}
      {inboxTab && <InboxScreen initialTab={inboxTab} onClose={() => setInboxTab(null)} />}
      {showMissions && <MissionsScreen onClose={() => setShowMissions(false)} />}
      {showLegal && <LegalScreen onClose={() => setShowLegal(false)} />}
      {profile && !termsAccepted && <TermsConsent />}
      {showShop && profile && !needsFirstGacha && <ShopScreen returned={shopReturn} onClose={() => setShowShop(false)} />}
      {showFriends && (
        <FriendsScreen
          onClose={() => setShowFriends(false)}
          onJoinRoom={(code) => {
            setShowFriends(false);
            setRoomCode(code);
            save(ROOM_KEY, code);
            onlineLink.join({ room: code, unitId });
          }}
          onSpectate={(friendCode) => {
            setShowFriends(false);
            onlineLink.spectate(friendCode);
          }}
        />
      )}
    </>
  );

  // アカウントがまだ無い・確認中・名前の変更中・最初の10連は、中央に1枚だけ出す。
  if (!profile || !ready || renaming) {
    return (
      <div className="online-home online-lobby online-home--gate">
        <header className="oh-top">
          <button type="button" className="oh-back" onClick={back}>
            ← 戻る
          </button>
          <div className="oh-top__title">ONLINE</div>
        </header>
        <main className="oh-gate">
          {(accountStatus === "unknown" || accountStatus === "loading") && !accountError && <p className="oh-note">アカウントを確認しています…</p>}
          {accountStatus === "unknown" && accountError && (
            <div className="oh-card oh-card--form">
              <p className="online-lobby__error">{accountError}</p>
              <button type="button" className="oh-cta" onClick={() => void loadAccount()}>
                もう一度試す
              </button>
            </div>
          )}
          {(accountStatus === "none" || renaming) && (
            <div className="oh-card oh-card--form">
              <div className="oh-card__head">
                <span className="oh-card__title">{profile ? "名前を変える" : "はじめる"}</span>
                <span className="oh-card__en">{profile ? "RENAME" : "NEW PLAYER"}</span>
              </div>
              <label className="online-lobby__field">
                <span>{profile ? "新しい名前" : "名前（あとで変えられます）"}</span>
                <input
                  value={name}
                  maxLength={PLAYER_NAME_MAX_LENGTH}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitName();
                  }}
                />
              </label>
              {!profile && (
                <label className="online-lobby__agree">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>
                    <button type="button" className="online-lobby__link" onClick={() => setShowLegal(true)}>
                      利用規約とプライバシーポリシー
                    </button>
                    に同意する
                  </span>
                </label>
              )}
              <div className="oh-card__actions">
                <button type="button" className="oh-cta" disabled={!name.trim() || (!profile && !agreed)} onClick={() => void submitName()}>
                  {profile ? "変更する" : "はじめる"}
                </button>
                {renaming && (
                  <button type="button" className="oh-ghost" onClick={() => setRenaming(false)}>
                    やめる
                  </button>
                )}
              </div>
              {accountError && <p className="online-lobby__error">{accountError}</p>}
              {accountStatus === "none" && (
                <>
                  <p className="oh-note">
                    アカウントはこのブラウザに保存されます。ブラウザのデータを消しても戻れるように、はじめた後で「引き継ぎ」からパスワードを決めておくのがおすすめです。
                  </p>
                  <button type="button" className="oh-ghost" onClick={() => setShowTransfer(true)}>
                    引き継ぎコードで戻る
                  </button>
                </>
              )}
            </div>
          )}
          {needsFirstGacha && !renaming && <FirstGacha />}
        </main>
        {overlays}
      </div>
    );
  }

  return (
    <div className="online-home online-lobby">
      <header className="oh-top">
        <button type="button" className="oh-back" onClick={back}>
          ← 戻る
        </button>
        <div className="oh-player">
          {shownCharacter && <img className="oh-player__avatar" src={shownCharacter.avatar} alt="" />}
          <div className="oh-player__text">
            <div className="oh-player__name">{profile.displayName}</div>
            {rank && (
              <div className="oh-player__rank">
                <span className="oh-player__rank-label">{rank.label}</span>
                <span className="oh-player__rank-bar">
                  <span style={{ width: `${rankProgress * 100}%` }} />
                </span>
                <span className="oh-player__rank-points">
                  {rank.maxPoints === null ? `${rank.points} pt` : `${rank.points} / ${rank.maxPoints}`}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="oh-top__spacer" />
        {jade && (
          <button type="button" className="oh-jade" disabled={busy} onClick={() => setShowShop(true)} title="雀玉を買う">
            <span className="oh-jade__gem" />
            <span className="oh-jade__amount">{(jade.free + jade.paid).toLocaleString()}</span>
            <span className="oh-jade__plus">＋</span>
          </button>
        )}
        <div className="oh-top__icons">
          <button type="button" className="oh-iconbtn" disabled={busy} onClick={() => setInboxTab("news")}>
            <Icon name="news" />
            <span>お知らせ</span>
            {hasUnreadNews && <span className="online-lobby__badge online-lobby__badge--dot" />}
          </button>
          <button type="button" className="oh-iconbtn" disabled={busy} onClick={() => setInboxTab("gifts")}>
            <Icon name="gift" />
            <span>プレゼント</span>
            {unclaimedGifts > 0 && <span className="online-lobby__badge">{unclaimedGifts}</span>}
          </button>
          <button type="button" className="oh-iconbtn" disabled={busy} onClick={() => setShowMissions(true)}>
            <Icon name="mission" />
            <span>ミッション</span>
            {claimableMissions > 0 && <span className="online-lobby__badge">{claimableMissions}</span>}
          </button>
          <button type="button" className="oh-iconbtn" disabled={busy} onClick={() => setShowFriends(true)}>
            <Icon name="friends" />
            <span>フレンド</span>
            {incomingFriendRequests > 0 && <span className="online-lobby__badge">{incomingFriendRequests}</span>}
          </button>
          <div className="oh-menu">
            <button type="button" className="oh-iconbtn" disabled={busy} onClick={() => setShowMenu((v) => !v)}>
              <Icon name="menu" />
              <span>その他</span>
            </button>
            {showMenu && !busy && (
              <>
                <div className="oh-menu__backdrop" onClick={() => setShowMenu(false)} />
                <div className="oh-menu__list">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      setName(profile.displayName);
                      setRenaming(true);
                    }}
                  >
                    名前を変える
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      setShowTransfer(true);
                    }}
                  >
                    引き継ぎ・退会
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      setShowLegal(true);
                    }}
                  >
                    規約
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="oh-main">
        <section className="oh-stage">
          {shownCharacter && (
            <img
              key={shownCharacter.id}
              className={`oh-stage__art${shownCharacter.cutin ? "" : " oh-stage__art--avatar"}${chosen ? "" : " oh-stage__art--random"}`}
              src={shownCharacter.cutin ?? shownCharacter.avatar}
              alt=""
            />
          )}
          <div className="oh-plate">
            <div className="oh-plate__label">対局に出すキャラ</div>
            <div className="oh-plate__name">
              {chosen ? (
                <>
                  <span className="oh-plate__stars">{"★".repeat(characterRarity(chosen.unit.characterId))}</span>
                  {chosen.character.name}
                </>
              ) : (
                "おまかせ"
              )}
            </div>
            <div className="oh-plate__sub">
              {chosen
                ? `必殺技「${chosen.character.skill.name}」／${chosen.unit.cardId ? (CARDS[chosen.unit.cardId]?.name ?? "カード") : "カードなし"}`
                : "手持ちからランダムに出ます"}
            </div>
            <select value={unitId ?? ""} aria-label="対局に出すキャラ" onChange={(e) => changeLoadout(e.target.value || null)}>
              <option value="">おまかせ（手持ちからランダム）</option>
              {units.map((u) => (
                <option key={u.unitId} value={u.unitId}>
                  {unitLabel(u)}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="oh-panel">
          {profile.suspendedUntil !== null && (
            <p className="online-lobby__error">{suspensionMessage(profile.suspendedUntil)}。対戦と雀玉の購入はできません。</p>
          )}
          {dailyBonusNotice !== null && (
            <div className="online-lobby__notice" onClick={() => useAccountStore.setState({ dailyBonusNotice: null })}>
              ログインボーナス：雀玉 {dailyBonusNotice} を受け取りました（タップで閉じる）
            </div>
          )}

          {!busy && (
            <div className="oh-card oh-card--ranked">
              <div className="oh-card__head">
                <span className="oh-card__title">段位戦</span>
                <span className="oh-card__en">RANKED MATCH</span>
              </div>
              <p className="oh-card__lead">
                段位の近い相手と自動で卓を組みます。{rank ? `現在 ${rank.label}・${rank.gamesPlayed}戦` : ""}
              </p>
              <div className="oh-modes">
                <button type="button" className="oh-mode" onClick={() => onlineLink.queueRanked("tonpuusen", unitId)}>
                  <span className="oh-mode__kanji">東</span>
                  <span className="oh-mode__name">東風戦</span>
                  <span className="oh-mode__sub">東場のみ・短め</span>
                </button>
                <button type="button" className="oh-mode" onClick={() => onlineLink.queueRanked("hanchan", unitId)}>
                  <span className="oh-mode__kanji">南</span>
                  <span className="oh-mode__name">半荘戦</span>
                  <span className="oh-mode__sub">東場＋南場・じっくり</span>
                </button>
              </div>
            </div>
          )}

          {queued && queue && (
            <div className="oh-card oh-card--queue">
              <div className="oh-card__head">
                <span className="oh-card__title">段位戦（{queue.format === "hanchan" ? "半荘戦" : "東風戦"}）</span>
                <span className="oh-card__en">MATCHING</span>
              </div>
              <div className="oh-queue">
                <div className="oh-queue__ring" />
                <div className="oh-queue__time">{Math.max(0, Math.floor((now - queue.since) / 1000))}秒</div>
              </div>
              <p className="oh-card__lead">
                相手を探しています… {Math.max(0, Math.ceil((queue.cpuFillInMs - (now - queue.since)) / 1000))}
                秒たっても4人そろわなければ、空いた席にCPUが入って始まります。
              </p>
              <button type="button" className="oh-ghost" onClick={() => onlineLink.cancelQueue()}>
                やめる
              </button>
            </div>
          )}

          {!inRoom && !queued && (
            <div className="oh-card">
              <div className="oh-card__head">
                <span className="oh-card__title">友人戦</span>
                <span className="oh-card__en">FRIEND MATCH</span>
              </div>
              <p className="oh-card__lead">同じ合言葉を入れた人どうしで同じ卓に座ります。</p>
              <div className="oh-room-join">
                <input
                  value={roomCode}
                  placeholder="合言葉"
                  aria-label="合言葉"
                  maxLength={ROOM_CODE_MAX_LENGTH}
                  onChange={(e) => setRoomCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") join();
                  }}
                />
                <button type="button" className="oh-cta" disabled={status === "connecting" || !roomCode.trim()} onClick={join}>
                  {status === "connecting" ? "接続中…" : "部屋に入る"}
                </button>
              </div>
            </div>
          )}

          {inRoom && (
            <div className="oh-card oh-card--room">
              <div className="oh-card__head">
                <span className="oh-card__title">合言葉「{room}」の部屋</span>
                <span className="oh-card__en">{members.length} / 4</span>
              </div>
              <ul className="oh-seats">
                {members.map((m) => {
                  const character = m.characterId ? CHARACTERS[m.characterId] : undefined;
                  return (
                    <li key={m.name} className={`oh-seat${m.isYou ? " oh-seat--you" : ""}`}>
                      {character ? (
                        <img className="oh-seat__avatar" src={character.avatar} alt="" />
                      ) : (
                        <span className="oh-seat__avatar oh-seat__avatar--none">？</span>
                      )}
                      <span className="oh-seat__text">
                        <span className="oh-seat__name">
                          {m.isHost ? "★ " : ""}
                          {m.name}
                          {m.isYou ? "（あなた）" : ""}
                        </span>
                        <span className="oh-seat__loadout">
                          {character ? character.name : "おまかせ"} ／ {m.cardId ? CARDS[m.cardId]?.name : "カードなし"}
                        </span>
                      </span>
                    </li>
                  );
                })}
                {Array.from({ length: 4 - members.length }, (_, i) => (
                  <li key={`cpu-${i}`} className="oh-seat oh-seat--cpu">
                    <span className="oh-seat__avatar oh-seat__avatar--none">CPU</span>
                    <span className="oh-seat__text">
                      <span className="oh-seat__name">空き席</span>
                      <span className="oh-seat__loadout">開始するとCPUが入ります</span>
                    </span>
                  </li>
                ))}
              </ul>
              {me?.isHost ? (
                <>
                  <div className="oh-modes">
                    <button type="button" className="oh-mode" onClick={() => start("tonpuusen")}>
                      <span className="oh-mode__kanji">東</span>
                      <span className="oh-mode__name">東風戦で開始</span>
                    </button>
                    <button type="button" className="oh-mode" onClick={() => start("hanchan")}>
                      <span className="oh-mode__kanji">南</span>
                      <span className="oh-mode__name">半荘戦で開始</span>
                    </button>
                  </div>
                  <label className="setup-debug-toggle">
                    <input type="checkbox" checked={continueBelowZero} onChange={(e) => setContinueBelowZero(e.target.checked)} />
                    箱下続行
                  </label>
                </>
              ) : (
                <p className="oh-card__lead">部屋主（★）が開始するのを待っています…</p>
              )}
            </div>
          )}

          {error && <p className="online-lobby__error">{error}</p>}
          {import.meta.env.DEV && !busy && <DevAccountTools />}
        </section>
      </main>

      <nav className="oh-dock">
        <button type="button" className="oh-dock__btn oh-dock__btn--gacha" disabled={busy} onClick={() => setShowGacha(true)}>
          <Icon name="gacha" />
          <span>ガチャ</span>
        </button>
        <button type="button" className="oh-dock__btn" disabled={busy} onClick={() => setShowUnits(true)}>
          <Icon name="units" />
          <span>手持ち・カード</span>
        </button>
        <button type="button" className="oh-dock__btn" disabled={busy} onClick={() => setShowHistory(true)}>
          <Icon name="history" />
          <span>戦績</span>
        </button>
        <button type="button" className="oh-dock__btn" disabled={busy} onClick={() => setShowShop(true)}>
          <Icon name="shop" />
          <span>雀玉ショップ</span>
        </button>
      </nav>
      {overlays}
    </div>
  );
}
