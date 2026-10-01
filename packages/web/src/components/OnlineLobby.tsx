import { useEffect, useState } from "react";
import { CARDS, CHARACTERS, PLAYER_NAME_MAX_LENGTH, ROOM_CODE_MAX_LENGTH, type MatchFormat } from "@majyan/core";
import { onlineLink, useOnlineStore } from "../online/onlineLink.js";
import { createGuestAccount, loadAccount, renameAccount, useAccountStore } from "../online/account.js";

const CHARACTER_LIST = Object.values(CHARACTERS);
const CARD_LIST = Object.values(CARDS);
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
 * ネット対戦の入口（合言葉で友人と同じ部屋に入る）と待合室。
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
  const queue = useOnlineStore((s) => s.queue);
  const [now, setNow] = useState(() => performance.now());
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [roomCode, setRoomCode] = useState(() => loadSaved(ROOM_KEY));
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
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
    onlineLink.join({ room: trimmedRoom, characterId, cardId });
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

  function changeLoadout(nextCharacterId: string | null, nextCardId: string | null) {
    setCharacterId(nextCharacterId);
    setCardId(nextCardId);
    if (inRoom) onlineLink.send({ t: "setLoadout", characterId: nextCharacterId, cardId: nextCardId });
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
      <p className="setup-lead">ネット対戦: 段位戦で知らない人と打つか、合言葉で友人と同じ卓に座ります。</p>

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
      {profile && rank && (
        <div className="online-lobby__rank">
          <span className="online-lobby__rank-label">{rank.label}</span>
          <span className="online-lobby__rank-points">
            {rank.maxPoints === null ? `${rank.points} pt` : `${rank.points} / ${rank.maxPoints} pt`}
          </span>
          <span className="online-lobby__rank-games">{rank.gamesPlayed}戦</span>
        </div>
      )}

      {profile && !busy && (
        <div className="online-lobby__section">
          <div className="online-lobby__section-title">段位戦</div>
          <div className="setup-buttons">
            <button className="btn btn--primary btn--large" onClick={() => onlineLink.queueRanked("tonpuusen", characterId, cardId)}>
              東風戦
            </button>
            <button className="btn btn--primary btn--large" onClick={() => onlineLink.queueRanked("hanchan", characterId, cardId)}>
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

      {profile && !busy && <div className="online-lobby__section-title">友人戦</div>}
      {profile && !busy && (
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

      <div className="online-lobby__form">
        <label className="online-lobby__field">
          <span>キャラクター</span>
          <select value={characterId ?? ""} onChange={(e) => changeLoadout(e.target.value || null, cardId)}>
            <option value="">おまかせ</option>
            {CHARACTER_LIST.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="online-lobby__field">
          <span>カード</span>
          <select value={cardId ?? ""} onChange={(e) => changeLoadout(characterId, e.target.value || null)}>
            <option value="">なし</option>
            {CARD_LIST.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {profile && !inRoom && !queued && (
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
