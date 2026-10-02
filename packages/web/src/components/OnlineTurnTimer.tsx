import { useEffect, useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import { playCountdownBeep } from "../sound.js";

/** 自分の持ち時間がこの秒数以下になったら、1秒ごとに音で知らせる。 */
const BEEP_FROM_SECONDS = 5;

/** OpponentArea.tsx等と同じ呼び方（自分から見た座席番号）。 */
const SEAT_LABELS = ["あなた", "下家", "対面", "上家"];

/**
 * ネット対戦の制限時間の表示。サーバーから届いた「残り時間」を、受信して
 * からの経過時間ぶん手元で減らして見せる（端末の時計はサーバーとずれて
 * いることがあるため、時刻ではなく残りの長さで受け取っている）。
 * 毎回もらえる時間 ＋ 持ち時間 の形で出す。
 * CPUの手番は一瞬で終わり、自分の時計と見間違えやすいので出さない。
 * 自分の時間が残りわずか（時間切れまでBEEP_FROM_SECONDS秒以下）になると、1秒ごとに音を鳴らす。
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

  // カットイン中（holdRemainingMs）は時計が止まっているので、その分は経過に数えない。
  const elapsed = clock ? Math.max(0, now - clock.receivedAt - clock.holdRemainingMs) : 0;
  const base = clock ? Math.max(0, clock.baseRemainingMs - elapsed) : 0;
  const bank = clock ? Math.max(0, clock.bankRemainingMs - Math.max(0, elapsed - clock.baseRemainingMs)) : 0;
  const mine = clock?.seat === 0;
  /** 時間切れまでの残り秒数（自分の時計の時だけ。それ以外はnull）。 */
  const secondsLeft = clock && mine ? Math.ceil((base + bank) / 1000) : null;

  useEffect(() => {
    if (secondsLeft === null || secondsLeft < 1 || secondsLeft > BEEP_FROM_SECONDS) return;
    playCountdownBeep(secondsLeft === 1);
  }, [secondsLeft]);

  if (!clock || seats?.[clock.seat]?.isCpu) return null;
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
