import { useEffect, useRef, useState } from "react";
import { CHARACTERS, type RoundState } from "@majyan/core";
import { CardFace } from "./CardFace.js";

const SHOW_MS = 2200;
/** カードの絵つきの演出は、札だけの時より少し長く見せる。 */
const SHOW_CARD_MS = 2800;

const KIND_LABEL = { use: "カード使用", auto: "カード発動" } as const;

interface Shown {
  title: string;
  detail: string;
  who: string;
  key: number;
  cardId?: string;
  kind: "use" | "auto";
  /** 見る人から見た座席（0=自分、1=右、2=向かい、3=左）。カードが飛んでくる向きに使う。 */
  seat: number;
}

/**
 * カードやキャラの自動効果が働いた時・カードを使った時の演出。
 * RoundState.cardTrigger のseqが変わった瞬間に出す。操作を邪魔しないよう
 * クリックは通す。
 *   カードの絵がある時（cardIdあり）: 「カード使用」の文字とカードの絵を、使った人の席の方向から
 *     飛んでくるように画面中央へ出す。他の人が使った時も、誰が何を使ったか分かる。
 *   絵が無い時（キャラの自動効果など）: 卓の中央上寄りに小さな札だけを出す。
 */
export function CardTriggerToast({ round }: { round: RoundState }) {
  const trigger = round.cardTrigger;
  // seqは局ごとに1から数え直すので、局の識別も混ぜて前局との取り違えを防ぐ。
  const seq = trigger ? `${round.roundWind}-${round.roundNumber}-${round.honba}-${trigger.seq}` : "";
  const shownRef = useRef(seq);
  const [shown, setShown] = useState<Shown | null>(null);
  const keyRef = useRef(0);

  useEffect(() => {
    if (!trigger || seq === shownRef.current) {
      shownRef.current = seq;
      return undefined;
    }
    shownRef.current = seq;
    keyRef.current += 1;
    const who = CHARACTERS[round.characterIds[trigger.seat]!]?.name ?? "";
    setShown({
      title: trigger.title,
      detail: trigger.detail,
      who,
      key: keyRef.current,
      cardId: trigger.cardId,
      kind: trigger.kind ?? "auto",
      seat: trigger.seat,
    });
    const timer = setTimeout(() => setShown(null), trigger.cardId ? SHOW_CARD_MS : SHOW_MS);
    return () => clearTimeout(timer);
  }, [seq]);

  if (!shown) return null;

  if (shown.cardId) {
    return (
      <div className={`card-use-stage card-use-stage--${shown.kind} card-use-stage--seat${shown.seat}`} key={shown.key} role="status">
        <div className="card-use-stage__label">{KIND_LABEL[shown.kind]}</div>
        <div className="card-use-stage__who">{shown.who}</div>
        <div className="card-use-stage__card">
          <CardFace cardId={shown.cardId} />
        </div>
        <div className="card-use-stage__detail">{shown.detail}</div>
      </div>
    );
  }

  return (
    <div className="card-trigger-toast" key={shown.key} role="status">
      <b>{shown.title}</b>
      <span>
        {shown.who}：{shown.detail}
      </span>
    </div>
  );
}
