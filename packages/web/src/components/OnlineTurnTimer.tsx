import { useEffect, useState } from "react";
import { useGameStore } from "../store/gameStore.js";

/** OpponentArea.tsx等と同じ呼び方（自分から見た座席番号）。 */
const SEAT_LABELS = ["あなた", "下家", "対面", "上家"];

/**
 * ネット対戦の制限時間の表示。サーバーから届いた「残り時間」を、受信して
 * からの経過時間ぶん手元で減らして見せる（端末の時計はサーバーとずれて
 * いることがあるため、時刻ではなく残りの長さで受け取っている）。
 * 毎回もらえる時間 ＋ 持ち時間 の形で出す。
 */
export function OnlineTurnTimer() {
  const clock = useGameStore((s) => s.clock);
  const seats = useGameStore((s) => s.onlineSeats);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!clock) return;
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, [clock]);

  if (!clock) return null;
  const elapsed = Math.max(0, now - clock.receivedAt);
  const base = Math.max(0, clock.baseRemainingMs - elapsed);
  const bank = Math.max(0, clock.bankRemainingMs - Math.max(0, elapsed - clock.baseRemainingMs));
  const mine = clock.seat === 0;
  const who = mine ? "あなた" : (seats?.[clock.seat]?.name ?? SEAT_LABELS[clock.seat]);
  const urgent = base === 0 && bank < 5000;

  return (
    <div className={`online-turn-timer${mine ? " online-turn-timer--mine" : ""}${urgent ? " online-turn-timer--urgent" : ""}`}>
      <span className="online-turn-timer__who">
        {who}
        {clock.kind === "call" ? "の鳴き判断" : "の手番"}
      </span>
      <span className="online-turn-timer__time">
        {Math.ceil(base / 1000)}
        <span className="online-turn-timer__bank"> + {Math.ceil(bank / 1000)}</span>
      </span>
    </div>
  );
}
