import { useEffect, useRef, useState } from "react";
import { CHARACTERS, type RoundState } from "@majyan/core";

const SHOW_MS = 2200;

/**
 * カードやキャラの自動効果（一閃の盾が当たり牌を防いだ、など）が働いた時に出す短い札。
 * RoundState.cardTrigger のseqが変わった瞬間に出す。操作を邪魔しないよう
 * 卓の中央上寄りに小さく出し、クリックは通す。
 */
export function CardTriggerToast({ round }: { round: RoundState }) {
  const trigger = round.cardTrigger;
  // seqは局ごとに1から数え直すので、局の識別も混ぜて前局との取り違えを防ぐ。
  const seq = trigger ? `${round.roundWind}-${round.roundNumber}-${round.honba}-${trigger.seq}` : "";
  const shownRef = useRef(seq);
  const [shown, setShown] = useState<{ title: string; detail: string; who: string; key: number } | null>(null);
  const keyRef = useRef(0);

  useEffect(() => {
    if (!trigger || seq === shownRef.current) {
      shownRef.current = seq;
      return undefined;
    }
    shownRef.current = seq;
    keyRef.current += 1;
    const who = CHARACTERS[round.characterIds[trigger.seat]!]?.name ?? "";
    setShown({ title: trigger.title, detail: trigger.detail, who, key: keyRef.current });
    const timer = setTimeout(() => setShown(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [seq]);

  if (!shown) return null;
  return (
    <div className="card-trigger-toast" key={shown.key} role="status">
      <b>{shown.title}</b>
      <span>
        {shown.who}：{shown.detail}
      </span>
    </div>
  );
}
