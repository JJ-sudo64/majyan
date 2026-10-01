import { useState } from "react";
import { CARDS, CHARACTERS, PLAYER_NAME_MAX_LENGTH, ROOM_CODE_MAX_LENGTH, type MatchFormat } from "@majyan/core";
import { onlineLink, useOnlineStore } from "../online/onlineLink.js";

const CHARACTER_LIST = Object.values(CHARACTERS);
const CARD_LIST = Object.values(CARDS);
/** 次回の入力を省くため、名前と合言葉だけ覚えておく（ブラウザごと）。 */
const NAME_KEY = "majyan.online.name";
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
  const [name, setName] = useState(() => loadSaved(NAME_KEY));
  const [roomCode, setRoomCode] = useState(() => loadSaved(ROOM_KEY));
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [continueBelowZero, setContinueBelowZero] = useState(false);

  const inRoom = status === "lobby";
  const me = members.find((m) => m.isYou);

  function join() {
    const trimmedName = name.trim();
    const trimmedRoom = roomCode.trim();
    if (!trimmedName || !trimmedRoom) return;
    save(NAME_KEY, trimmedName);
    save(ROOM_KEY, trimmedRoom);
    onlineLink.join({ room: trimmedRoom, name: trimmedName, characterId, cardId });
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
      <p className="setup-lead">
        ネット対戦（友人戦）: 同じ合言葉を入れた人どうしが同じ卓に座ります。空いた席にはCPUが入ります。
      </p>

      {!inRoom && (
        <div className="online-lobby__form">
          <label className="online-lobby__field">
            <span>名前</span>
            <input value={name} maxLength={PLAYER_NAME_MAX_LENGTH} onChange={(e) => setName(e.target.value)} />
          </label>
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

      {!inRoom && (
        <button
          type="button"
          className="btn btn--primary btn--large"
          disabled={status === "connecting" || !name.trim() || !roomCode.trim()}
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
