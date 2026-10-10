import { useEffect, useState } from "react";
import { CHARACTERS, STAMP_COOLDOWN_MS, STAMPS, stampById } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { onlineLink, setStampsMuted, useOnlineStore } from "../online/onlineLink.js";

/** 届いたスタンプを出しておく時間。 */
const STAMP_SHOW_MS = 3500;

/** OpponentArea.tsx等と同じ呼び方（自分から見た座席番号）。 */
const SEAT_LABELS = ["あなた", "下家", "対面", "上家"];

/**
 * 届いたスタンプの吹き出し。送った人の席の側に数秒出す。卓と一緒に拡大縮小されるよう、
 * Stageの中に置く。「表示しない」にしている間は出さない。
 */
export function OnlineStampBubbles() {
  const stamps = useOnlineStore((s) => s.stamps);
  const muted = useOnlineStore((s) => s.stampsMuted);
  const seats = useGameStore((s) => s.onlineSeats);
  const characterIds = useGameStore((s) => s.match?.round.characterIds);
  const [now, setNow] = useState(() => Date.now());

  // 出ているスタンプがある間だけ時計を回す（消す時刻を知るため）。
  const latest = stamps.at(-1)?.at ?? 0;
  useEffect(() => {
    if (!latest) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    const stop = window.setTimeout(() => window.clearInterval(id), STAMP_SHOW_MS + 500);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [latest]);

  if (muted) return null;
  return (
    <>
      {stamps
        .filter((s) => now - s.at < STAMP_SHOW_MS)
        .map((s) => {
          const stamp = stampById(s.stampId);
          const character = characterIds ? CHARACTERS[characterIds[s.seat]] : undefined;
          if (!stamp) return null;
          return (
            <div key={s.key} className={`online-stamp online-stamp--seat${s.seat}`}>
              {character && <img className="online-stamp__avatar" src={character.avatar} alt="" />}
              <div className="online-stamp__bubble">
                <span className="online-stamp__name">{seats?.[s.seat]?.name ?? SEAT_LABELS[s.seat]}</span>
                <span className="online-stamp__text">{stamp.text}</span>
              </div>
            </div>
          );
        })}
    </>
  );
}

/**
 * スタンプを送るボタン（決まった言葉だけ送れる）。観戦中は送れず、表示の設定だけ変えられる。
 * 「表示しない」は他の人の分も出さなくする、このブラウザだけの設定。
 */
export function OnlineStamps({ canSend }: { canSend: boolean }) {
  const muted = useOnlineStore((s) => s.stampsMuted);
  const [open, setOpen] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // 送った直後、また送れるようになる時刻にボタンを戻す。
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setTimeout(() => setNow(Date.now()), cooldownUntil - Date.now() + 50);
    return () => window.clearTimeout(id);
  }, [cooldownUntil]);

  function send(stampId: string) {
    onlineLink.send({ t: "stamp", stampId });
    setCooldownUntil(Date.now() + STAMP_COOLDOWN_MS);
    setNow(Date.now());
    setOpen(false);
  }

  const cooling = cooldownUntil > now;

  return (
    <div className="online-stamps">
      {open && (
        <div className="online-stamps__panel">
          {canSend &&
            STAMPS.map((stamp) => (
              <button key={stamp.id} type="button" className="online-stamps__choice" disabled={cooling} onClick={() => send(stamp.id)}>
                {stamp.text}
              </button>
            ))}
          <label className="online-stamps__mute">
            <input type="checkbox" checked={muted} onChange={(e) => setStampsMuted(e.target.checked)} />
            スタンプを表示しない
          </label>
        </div>
      )}
      <button type="button" className="online-stamps__toggle" onClick={() => setOpen((v) => !v)}>
        スタンプ
      </button>
    </div>
  );
}
