import { useEffect, useState } from "react";
import { CARDS, CHARACTERS, PLAYER_NAME_MAX_LENGTH, RENAME_PRICE, TRANSFER_PASSWORD_MAX_LENGTH, TRANSFER_PASSWORD_MIN_LENGTH, ROOM_CODE_MAX_LENGTH, SHOP_RETURN_PARAM, suspensionMessage, characterRarity, type CharacterUnit, type MatchFormat } from "@majyan/core";
import { onlineLink, useOnlineStore } from "../online/onlineLink.js";
import { createGuestAccount, fetchTransferCode, loadAccount, renameAccount, setTransferPassword, useAccountStore } from "../online/account.js";
import { FirstGacha } from "./FirstGacha.js";
import { TutorialIntro, introSeen } from "./TutorialIntro.js";
import { GachaScreen } from "./GachaScreen.js";
import { UnitsScreen } from "./UnitsScreen.js";
import { UnitDetail } from "./UnitDetail.js";
import { TransferScreen } from "./TransferScreen.js";
import { HistoryScreen } from "./HistoryScreen.js";
import { InboxScreen, type InboxTab } from "./InboxScreen.js";
import { MissionsScreen } from "./MissionsScreen.js";
import { RankGuideScreen } from "./RankGuideScreen.js";
import { ShopScreen } from "./ShopScreen.js";
import { LegalScreen, TermsConsent } from "./LegalScreen.js";
import { FriendsScreen } from "./FriendsScreen.js";
import { RulesGuide } from "./RulesGuide.js";
import { DevAccountTools } from "./DevAccountTools.js";
import { playUiClickFor } from "../sound.js";

/** 付けているカードの表示（パッシブ・アクティブの順。無ければ「カードなし」）。 */
function cardLabel(cardId: string | null, cardId2: string | null): string {
  const names = [cardId, cardId2].flatMap((id) => (id ? [CARDS[id]?.name ?? "カード"] : []));
  return names.length > 0 ? names.join("＋") : "カードなし";
}

/** キャラ選択の表示（例: 「★★ 一閃の雷神・ライコ ＋ 面子確約＋点棒吸収」）。 */
function unitLabel(u: CharacterUnit): string {
  const name = CHARACTERS[u.characterId]?.name ?? u.characterId;
  const cards = cardLabel(u.cardId, u.cardId2);
  return `${"★".repeat(characterRarity(u.characterId))} ${name}${u.cardId || u.cardId2 ? ` ＋ ${cards}` : "（カードなし）"}`;
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
/** 前回選んだ「対局に出すキャラ」（手持ちの1体のID）。おまかせの時は保存しない。 */
const UNIT_KEY = "majyan.online.unit";

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
  const lostReason = useAccountStore((s) => s.lostReason);
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
  /** アカウントを作った直後に開いた引き継ぎ画面か（コードを控えるよう強く案内する）。 */
  const [transferJustCreated, setTransferJustCreated] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [inboxTab, setInboxTab] = useState<InboxTab | null>(null);
  const unclaimedGifts = useAccountStore((s) => s.unclaimedGifts);
  const claimableMissions = useAccountStore((s) => s.claimableMissions);
  const [showMissions, setShowMissions] = useState(false);
  const [showRankGuide, setShowRankGuide] = useState(false);
  const [showRulesGuide, setShowRulesGuide] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  /** 支払いのページから戻ってきた時の印（?shop=done / cancel）。読んだらURLからは消す。 */
  const [shopReturn] = useState(() => new URLSearchParams(window.location.search).get(SHOP_RETURN_PARAM));
  const [showShop, setShowShop] = useState(shopReturn !== null);
  const [showLegal, setShowLegal] = useState(false);
  /** アカウントを作る時の「同意する」のチェック。 */
  const [agreed, setAgreed] = useState(false);
  const termsAccepted = useAccountStore((s) => s.termsAccepted);
  const incomingFriendRequests = useAccountStore((s) => s.incomingFriendRequests);
  const runningRanked = useAccountStore((s) => s.runningRanked);
  const hasUnreadNews = useAccountStore((s) => s.latestAnnouncementId !== null && s.latestAnnouncementId > s.seenAnnouncementId);
  // 最初の10連を確定するまでは、ネット対戦の代わりにガチャ画面を出す。
  const needsFirstGacha = accountStatus === "ready" && firstGacha !== null && !firstGacha.confirmed;
  /** ネット対戦の操作（段位戦・友人戦）を出してよいか。 */
  const ready = !!profile && !needsFirstGacha;
  const queue = useOnlineStore((s) => s.queue);
  const [now, setNow] = useState(() => performance.now());
  const [name, setName] = useState("");
  /** アカウントを作る時に一緒に決める、引き継ぎのパスワード（ブラウザのデータが消えても戻れるように、作る時に必ず決めてもらう）。 */
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const newPasswordLength = [...newPassword].length;
  const newPasswordOk = newPasswordLength >= TRANSFER_PASSWORD_MIN_LENGTH && newPasswordLength <= TRANSFER_PASSWORD_MAX_LENGTH && newPassword === newPassword2;
  const [renaming, setRenaming] = useState(false);
  const jadeTotal = (jade?.free ?? 0) + (jade?.paid ?? 0);
  const [roomCode, setRoomCode] = useState(() => loadSaved(ROOM_KEY));
  /** 対局に出す手持ちのキャラ（付いているカードごと出る）。null=おまかせ。 */
  const [unitId, setUnitId] = useState<string | null>(() => loadSaved(UNIT_KEY) || null);
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [showUnitDetail, setShowUnitDetail] = useState(false);
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

  // 引き継ぎのパスワードをまだ決めていないか（決めていないと、ブラウザのデータが消えた時にアカウントへ戻れない）。
  // 引き継ぎ画面を閉じるたびに読み直す。読めない時は注意書きを出さない（null）。
  // アカウントを作った直後（最初の10連の前）に、最初のチュートリアルの案内を1度だけ出す（TutorialIntro.tsx）。
  const [introClosed, setIntroClosed] = useState(false);
  const [needsBackupNotice, setNeedsBackupNotice] = useState<boolean | null>(null);
  const [backupNoticeLater, setBackupNoticeLater] = useState(false);
  useEffect(() => {
    if (accountStatus !== "ready" || !profile || showTransfer) return;
    let cancelled = false;
    fetchTransferCode()
      .then((code) => {
        if (!cancelled) setNeedsBackupNotice(code === null);
      })
      .catch(() => {
        if (!cancelled) setNeedsBackupNotice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountStatus, profile?.id, showTransfer]);

  useEffect(() => {
    // 覚えていたキャラが手持ちに無い時（別のアカウントに替えた等）はおまかせに戻す。
    if (accountStatus === "ready" && unitId !== null && !units.some((u) => u.unitId === unitId)) setUnitId(null);
  }, [accountStatus, units, unitId]);

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

  /** 途中で抜けた段位戦へ戻る。押すまでの間に終わっていたら、新しく並ばずに案内を消すだけにする。 */
  async function returnToRanked() {
    await loadAccount();
    const format = useAccountStore.getState().runningRanked;
    if (format) onlineLink.queueRanked(format, unitId);
  }

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
      if (!newPasswordOk) return;
      await createGuestAccount(trimmed);
      if (useAccountStore.getState().status !== "none") {
        // 作った直後に、引き継ぎのパスワードを決める。決められなくてもアカウントは作れているので、
        // 失敗した時は理由を出し、あとから「引き継ぎ」で決められる（ロビーの案内も出る）。
        try {
          await setTransferPassword(newPassword);
          setTransferJustCreated(true);
          setShowTransfer(true); // 引き継ぎコードを見せる（控えてもらう）
        } catch (err) {
          useAccountStore.setState({ error: `アカウントは作れましたが、引き継ぎのパスワードを決められませんでした（${(err as Error).message}）。あとで「引き継ぎ」から決めてください。` });
        }
        setNewPassword("");
        setNewPassword2("");
      }
      // 作った後は欄を空にしておく（開発用の「新しいアカウントで始める」で戻った時に前の名前が残らないように）。
      if (useAccountStore.getState().status !== "none") setName("");
    }
  }

  function changeLoadout(nextUnitId: string | null) {
    setUnitId(nextUnitId);
    save(UNIT_KEY, nextUnitId ?? "");
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
      {showTransfer && (
        <TransferScreen
          justCreated={transferJustCreated}
          onClose={() => {
            setShowTransfer(false);
            setTransferJustCreated(false);
          }}
        />
      )}
      {showHistory && <HistoryScreen onClose={() => setShowHistory(false)} />}
      {inboxTab && <InboxScreen initialTab={inboxTab} onClose={() => setInboxTab(null)} />}
      {showMissions && <MissionsScreen onClose={() => setShowMissions(false)} />}
      {showRankGuide && <RankGuideScreen rank={rank} onClose={() => setShowRankGuide(false)} />}
      {showRulesGuide && <RulesGuide onClose={() => setShowRulesGuide(false)} />}
      {showLegal && <LegalScreen onClose={() => setShowLegal(false)} />}
      {profile && !termsAccepted && <TermsConsent />}
      {showShop && profile && !needsFirstGacha && <ShopScreen returned={shopReturn} onClose={() => setShowShop(false)} />}
      {showUnitDetail && chosen && (
        <div className="modal-overlay" onClick={() => setShowUnitDetail(false)}>
          <div className="gacha-screen units-screen__detail" onClick={(e) => e.stopPropagation()}>
            <div className="setup-picker-modal__header">
              <div className="setup-character-select__label">対局に出すキャラ</div>
              <button type="button" className="setup-picker-modal__close" onClick={() => setShowUnitDetail(false)}>
                ×
              </button>
            </div>
            <UnitDetail characterId={chosen.unit.characterId} cardId={chosen.unit.cardId} cardId2={chosen.unit.cardId2} />
          </div>
        </div>
      )}
      {showUnitPicker && (
        <div className="modal-overlay" onClick={() => setShowUnitPicker(false)}>
          <div className="gacha-screen" onClick={(e) => e.stopPropagation()}>
            <div className="setup-picker-modal__header">
              <div className="setup-character-select__label">対局に出すキャラ</div>
              <button type="button" className="setup-picker-modal__close" onClick={() => setShowUnitPicker(false)}>
                ×
              </button>
            </div>
            <p className="setup-lead">付けたカードごと対局に出ます。カードは下の「手持ち・カード」から付けられます。</p>
            <div className="units-screen__grid">
              <button
                type="button"
                className={`units-screen__unit${unitId === null ? " units-screen__unit--selected" : ""}`}
                onClick={() => {
                  changeLoadout(null);
                  setShowUnitPicker(false);
                }}
              >
                <span className="oh-unit-random">？</span>
                <span className="units-screen__name">おまかせ</span>
                <span className="units-screen__card units-screen__card--none">手持ちからランダム</span>
              </button>
              {units.map((u) => {
                const character = CHARACTERS[u.characterId];
                return (
                  <button
                    key={u.unitId}
                    type="button"
                    className={`units-screen__unit${unitId === u.unitId ? " units-screen__unit--selected" : ""}`}
                    title={unitLabel(u)}
                    onClick={() => {
                      changeLoadout(u.unitId);
                      setShowUnitPicker(false);
                    }}
                  >
                    {character && <img src={character.avatar} alt="" />}
                    <span className="units-screen__stars">{"★".repeat(characterRarity(u.characterId))}</span>
                    <span className="units-screen__name">{character?.name.split("・").at(-1) ?? u.characterId}</span>
                    <span className={`units-screen__card${u.cardId ? "" : " units-screen__card--none"}`}>
                      {u.cardId ? (CARDS[u.cardId]?.name ?? "カード") : "パッシブなし"}
                    </span>
                    <span className={`units-screen__card${u.cardId2 ? "" : " units-screen__card--none"}`}>
                      {u.cardId2 ? (CARDS[u.cardId2]?.name ?? "カード") : "アクティブなし"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
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
      <div className="online-home online-lobby online-home--gate" onClickCapture={playUiClickFor}>
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
              {profile && (
                <p className="oh-note">
                  名前を変えるには雀玉が{RENAME_PRICE}個かかります（今の所持: {jadeTotal}個）。同じ名前のままなら無料です。
                </p>
              )}
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
              {!profile && (
                <>
                  <p className="oh-note">
                    <strong>引き継ぎのパスワード</strong>も、ここで決めてください。ブラウザのデータが消えた時や、別の端末で遊ぶ時に、これがないとこのアカウント（雀玉・キャラ・段位）に戻れません。忘れないよう控えてください（{TRANSFER_PASSWORD_MIN_LENGTH}文字以上）。
                  </p>
                  <label className="online-lobby__field">
                    <span>引き継ぎのパスワード（{TRANSFER_PASSWORD_MIN_LENGTH}文字以上）</span>
                    <input type="password" autoComplete="new-password" value={newPassword} maxLength={TRANSFER_PASSWORD_MAX_LENGTH} onChange={(e) => setNewPassword(e.target.value)} />
                  </label>
                  <label className="online-lobby__field">
                    <span>もう一度</span>
                    <input type="password" autoComplete="new-password" value={newPassword2} maxLength={TRANSFER_PASSWORD_MAX_LENGTH} onChange={(e) => setNewPassword2(e.target.value)} />
                  </label>
                  {newPasswordLength > 0 && newPassword2 !== "" && newPassword !== newPassword2 && <p className="online-lobby__error">パスワードが一致しません</p>}
                </>
              )}
              <div className="oh-card__actions">
                <button type="button" className="oh-cta" disabled={!name.trim() || (!profile && (!agreed || !newPasswordOk)) || (!!profile && name.trim() !== profile.displayName && jadeTotal < RENAME_PRICE)} onClick={() => void submitName()}>
                  {profile ? (name.trim() === profile.displayName ? "変更する" : `変更する（雀玉${RENAME_PRICE}）`) : "はじめる"}
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
                  {/* 前にここでアカウントを作った形跡があるのに鍵が無い時の案内（新しく作る前に気づけるように）。 */}
                  {lostReason && (
                    <p className="online-lobby__lost" role="alert">
                      {lostReason === "rejected"
                        ? "保存されていたアカウントが、サーバーで見つかりませんでした。"
                        : "前にこのブラウザで作ったアカウントの情報が見当たりません（ブラウザのデータを消した、別のURLやウィンドウで開いた、などの場合）。"}
                      引き継ぎのパスワードを決めてあれば、下の「引き継ぎコードで戻る」から戻れます。新しく作ると、別のアカウントになります。
                    </p>
                  )}
                  <p className="oh-note">
                    アカウントはこのブラウザに保存されます。上で決めたパスワードと、はじめた後に表示される引き継ぎコードで、ブラウザのデータを消しても、別の端末からでも戻れます。
                  </p>
                  <button type="button" className="oh-ghost" onClick={() => setShowTransfer(true)}>
                    引き継ぎコードで戻る
                  </button>
                </>
              )}
            </div>
          )}
          {needsFirstGacha && !renaming && <FirstGacha />}
          {needsFirstGacha && !renaming && !!profile && !introClosed && !introSeen(profile.id) && (
            <TutorialIntro accountId={profile.id} onDone={() => setIntroClosed(true)} />
          )}
        </main>
        {overlays}
      </div>
    );
  }

  return (
    <div className="online-home online-lobby" onClickCapture={playUiClickFor}>
      <header className="oh-top">
        <button type="button" className="oh-back" onClick={back}>
          ← 戻る
        </button>
        <div className="oh-player">
          {shownCharacter && <img className="oh-player__avatar" src={shownCharacter.avatar} alt="" />}
          <div className="oh-player__text">
            <div className="oh-player__name">{profile.displayName}</div>
            {rank && (
              <button type="button" className="oh-player__rank" title="段位のしくみを見る" onClick={() => setShowRankGuide(true)}>
                <span className="oh-player__rank-label">{rank.label}</span>
                <span className="oh-player__rank-bar">
                  <span style={{ width: `${rankProgress * 100}%` }} />
                </span>
                <span className="oh-player__rank-points">
                  {rank.maxPoints === null ? `${rank.points} pt` : `${rank.points} / ${rank.maxPoints}`}
                </span>
                <span className="oh-player__rank-help">?</span>
              </button>
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
                      setShowRulesGuide(true);
                    }}
                  >
                    遊び方・役一覧
                  </button>
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
                  <a href="/about/" target="_blank" rel="noreferrer" onClick={() => setShowMenu(false)}>
                    公式サイト
                  </a>
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
              className={`oh-stage__art${shownCharacter.topArt ? " oh-stage__art--top" : shownCharacter.cutin ? "" : " oh-stage__art--avatar"}${chosen ? "" : " oh-stage__art--random"}`}
              src={shownCharacter.topArt ?? shownCharacter.cutin ?? shownCharacter.avatar}
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
                ? `必殺技「${chosen.character.skill.name}」／${cardLabel(chosen.unit.cardId, chosen.unit.cardId2)}`
                : "手持ちからランダムに出ます"}
            </div>
            <div className="oh-plate__buttons">
              <button type="button" className="oh-ghost oh-plate__change" disabled={status === "connecting" || queued} onClick={() => setShowUnitPicker(true)}>
                キャラを変える
              </button>
              {chosen && (
                <button type="button" className="oh-ghost" onClick={() => setShowUnitDetail(true)}>
                  詳しく見る
                </button>
              )}
            </div>
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
          {needsBackupNotice && !backupNoticeLater && !needsFirstGacha && (
            <div className="online-lobby__backup-notice">
              <p>
                <strong>引き継ぎコードを作って、控えておいてください。</strong>
                ブラウザのデータを消した時や、端末を替えた時に、コードがないとこのアカウント（雀玉・キャラ・段位）に戻れなくなります。
              </p>
              <div className="online-lobby__backup-notice-buttons">
                <button type="button" className="oh-cta" onClick={() => setShowTransfer(true)}>
                  コードを作る
                </button>
                <button type="button" className="oh-ghost" onClick={() => setBackupNoticeLater(true)}>
                  あとで
                </button>
              </div>
            </div>
          )}

          {!busy && runningRanked && (
            <div className="oh-card oh-card--ranked oh-card--resume">
              <div className="oh-card__head">
                <span className="oh-card__title">対局中の段位戦</span>
                <span className="oh-card__en">MATCH IN PROGRESS</span>
              </div>
              <p className="oh-card__lead">
                {runningRanked === "hanchan" ? "半荘戦" : "東風戦"}が続いています。抜けている間は自動で打牌されます。終わるまで新しい段位戦は始められません。
              </p>
              <button type="button" className="btn btn--primary oh-resume" onClick={() => void returnToRanked()}>
                対局に戻る
              </button>
            </div>
          )}

          {!busy && !runningRanked && (
            <div className="oh-card oh-card--ranked">
              <div className="oh-card__head">
                <span className="oh-card__title">段位戦</span>
                <span className="oh-card__en">RANKED MATCH</span>
              </div>
              <p className="oh-card__lead">
                段位の近い相手と自動で卓を組みます。{rank ? `現在 ${rank.label}・${rank.gamesPlayed}戦` : ""}
                <button type="button" className="oh-link" onClick={() => setShowRankGuide(true)}>
                  段位のしくみ
                </button>
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
                          {character ? character.name : "おまかせ"} ／ {cardLabel(m.cardId, m.cardId2)}
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
