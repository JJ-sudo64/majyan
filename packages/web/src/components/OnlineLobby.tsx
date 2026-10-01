import { useEffect, useState } from "react";
import { CARDS, CHARACTERS, PLAYER_NAME_MAX_LENGTH, ROOM_CODE_MAX_LENGTH, characterRarity, type CharacterUnit, type MatchFormat } from "@majyan/core";
import { onlineLink, useOnlineStore } from "../online/onlineLink.js";
import { createGuestAccount, loadAccount, renameAccount, useAccountStore } from "../online/account.js";
import { FirstGacha } from "./FirstGacha.js";
import { GachaScreen } from "./GachaScreen.js";
import { UnitsScreen } from "./UnitsScreen.js";

/** キャラ選択の表示（例: 「★★ 一閃の雷神・ライコ ＋ 点棒吸収」）。 */
function unitLabel(u: CharacterUnit): string {
  const name = CHARACTERS[u.characterId]?.name ?? u.characterId;
  const card = u.cardId ? CARDS[u.cardId]?.name : null;
  return `${"★".repeat(characterRarity(u.characterId))} ${name}${card ? ` ＋ ${card}` : "（カードなし）"}`;
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

  const inRoom = status === "lobby";
  const queued = status === "queued";
  const busy = inRoom || queued || status === "connecting";
  const me = members.find((m) => m.isYou);

  useEffect(() => {
    // 段位戦の後に戻ってきた時などに段位を最新にするため、開くたびに読み直す。
    void loadAccount();
  }, []);

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
    } else {
      await createGuestAccount(trimmed);
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

  return (
    <div className="setup-screen online-lobby">
      <button type="button" className="setup-back-btn" onClick={back}>
        ← 戻る
      </button>
      <p className="setup-lead">オンライン: 段位戦で知らない人と打つか、合言葉で友人と同じ卓に座ります。</p>

      {(accountStatus === "unknown" || accountStatus === "loading") && !accountError && <p className="setup-lead">アカウントを確認しています…</p>}
      {accountStatus === "unknown" && accountError && (
        <>
          <p className="online-lobby__error">{accountError}</p>
          <button type="button" className="btn" onClick={() => void loadAccount()}>
            もう一度試す
          </button>
        </>
      )}

      {(accountStatus === "none" || renaming) && (
        <div className="online-lobby__form">
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
          <button type="button" className="btn btn--primary" disabled={!name.trim()} onClick={() => void submitName()}>
            {profile ? "変更する" : "はじめる"}
          </button>
          {renaming && (
            <button type="button" className="btn btn--secondary" onClick={() => setRenaming(false)}>
              やめる
            </button>
          )}
        </div>
      )}
      {accountStatus === "none" && (
        <p className="setup-lead">アカウントはこのブラウザに保存されます（ブラウザのデータを消すと戻れなくなります）。</p>
      )}
      {accountStatus === "none" && accountError && <p className="online-lobby__error">{accountError}</p>}

      {profile && !renaming && (
        <div className="online-lobby__account">
          {profile.displayName} さん
          {!busy && (
            <button
              type="button"
              className="btn online-lobby__rename"
              onClick={() => {
                setName(profile.displayName);
                setRenaming(true);
              }}
            >
              名前を変える
            </button>
          )}
        </div>
      )}
      {profile && renaming && accountError && <p className="online-lobby__error">{accountError}</p>}
      {needsFirstGacha && <FirstGacha />}
      {!needsFirstGacha && profile && rank && (
        <div className="online-lobby__rank">
          <span className="online-lobby__rank-label">{rank.label}</span>
          <span className="online-lobby__rank-points">
            {rank.maxPoints === null ? `${rank.points} pt` : `${rank.points} / ${rank.maxPoints} pt`}
          </span>
          <span className="online-lobby__rank-games">{rank.gamesPlayed}戦</span>
          {jade && <span className="online-lobby__jade">雀玉 {(jade.free + jade.paid).toLocaleString()}</span>}
          {!busy && (
            <button type="button" className="btn online-lobby__gacha-btn" onClick={() => setShowGacha(true)}>
              ガチャ
            </button>
          )}
        </div>
      )}
      {!needsFirstGacha && dailyBonusNotice !== null && (
        <div className="online-lobby__notice" onClick={() => useAccountStore.setState({ dailyBonusNotice: null })}>
          ログインボーナス：雀玉 {dailyBonusNotice} を受け取りました（タップで閉じる）
        </div>
      )}
      {showGacha && <GachaScreen onClose={() => setShowGacha(false)} />}
      {showUnits && <UnitsScreen onClose={() => setShowUnits(false)} />}

      {ready && !busy && (
        <div className="online-lobby__section">
          <div className="online-lobby__section-title">段位戦</div>
          <div className="setup-buttons">
            <button className="btn btn--primary btn--large" onClick={() => onlineLink.queueRanked("tonpuusen", unitId)}>
              東風戦
            </button>
            <button className="btn btn--primary btn--large" onClick={() => onlineLink.queueRanked("hanchan", unitId)}>
              半荘戦
            </button>
          </div>
        </div>
      )}
      {queued && queue && (
        <div className="online-lobby__section">
          <div className="online-lobby__section-title">
            段位戦（{queue.format === "hanchan" ? "半荘戦" : "東風戦"}）の相手を探しています… {Math.floor((now - queue.since) / 1000)}秒
          </div>
          <p className="setup-lead">
            {Math.max(0, Math.ceil((queue.cpuFillInMs - (now - queue.since)) / 1000))}秒たっても4人そろわなければ、空いた席にCPUが入って始まります。
          </p>
          <button type="button" className="btn btn--secondary" onClick={() => onlineLink.cancelQueue()}>
            やめる
          </button>
        </div>
      )}

      {ready && !busy && <div className="online-lobby__section-title">友人戦</div>}
      {ready && !busy && (
        <div className="online-lobby__form">
          <label className="online-lobby__field">
            <span>合言葉</span>
            <input
              value={roomCode}
              maxLength={ROOM_CODE_MAX_LENGTH}
              onChange={(e) => setRoomCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") join();
              }}
            />
          </label>
        </div>
      )}

      {ready && (
      <div className="online-lobby__form">
        <label className="online-lobby__field">
          <span>対局に出すキャラ（付けたカードごと出ます）</span>
          <select value={unitId ?? ""} onChange={(e) => changeLoadout(e.target.value || null)}>
            <option value="">おまかせ（手持ちからランダム）</option>
            {units.map((u) => (
              <option key={u.unitId} value={u.unitId}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
        {!busy && (
          <button type="button" className="btn online-lobby__units-btn" onClick={() => setShowUnits(true)}>
            手持ち・カードを付ける
          </button>
        )}
      </div>
      )}

      {ready && !inRoom && !queued && (
        <button
          type="button"
          className="btn btn--primary btn--large"
          disabled={status === "connecting" || !roomCode.trim()}
          onClick={join}
        >
          {status === "connecting" ? "接続中…" : "部屋に入る"}
        </button>
      )}
      {error && <p className="online-lobby__error">{error}</p>}

      {inRoom && (
        <>
          <div className="online-lobby__room">
            合言葉「{room}」の部屋（{members.length}/4人）
          </div>
          <ul className="online-lobby__members">
            {members.map((m) => (
              <li key={m.name} className={m.isYou ? "online-lobby__member--you" : undefined}>
                {m.isHost ? "★ " : ""}
                {m.name}
                {m.isYou ? "（あなた）" : ""}
                <span className="online-lobby__loadout">
                  {m.characterId ? CHARACTERS[m.characterId]?.name : "おまかせ"} ／ {m.cardId ? CARDS[m.cardId]?.name : "カードなし"}
                </span>
              </li>
            ))}
            {Array.from({ length: 4 - members.length }, (_, i) => (
              <li key={`cpu-${i}`} className="online-lobby__member--cpu">
                （空き席：開始するとCPUが入ります）
              </li>
            ))}
          </ul>
          {me?.isHost ? (
            <>
              <div className="setup-buttons">
                <button className="btn btn--primary btn--large" onClick={() => start("tonpuusen")}>
                  東風戦で開始
                </button>
                <button className="btn btn--primary btn--large" onClick={() => start("hanchan")}>
                  半荘戦で開始
                </button>
              </div>
              <label className="setup-debug-toggle">
                <input type="checkbox" checked={continueBelowZero} onChange={(e) => setContinueBelowZero(e.target.checked)} />
                箱下続行
              </label>
            </>
          ) : (
            <p className="setup-lead">部屋主（★）が開始するのを待っています…</p>
          )}
        </>
      )}
    </div>
  );
}
