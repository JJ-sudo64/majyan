import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { CARDS, cardRarity } from "@majyan/core";
import { CARD_DESIGN, CARD_ICON_PATH, KIND_LONG, KIND_SHORT, cardCategory, cardShort } from "../cardDesign.js";

const stars = (rarity: number) => "★".repeat(rarity);

/** 系統ごとのアイコン（線画）。色は親のstrokeに従う。 */
export function CardIcon({ cardId }: { cardId: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={CARD_ICON_PATH[cardCategory(cardId)]} />
    </svg>
  );
}

interface CardFaceProps {
  cardId: string;
  /** 小さく出す（名前・アイコン・星だけ。効果の文字は出さない）。一覧や手持ち向け。 */
  compact?: boolean;
  selected?: boolean;
  focused?: boolean;
  onClick?: () => void;
  /** カーソルを乗せた時（一覧で、下の説明欄に効果を出すのに使う）。 */
  onHover?: () => void;
  /** カードの下に、効果の短い説明を文字で出す（compactの時は、カード面の中に説明が入らないため）。 */
  caption?: boolean;
  /** 右上などに重ねる飾り（NEWの札など）。 */
  badge?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * カード1枚の見た目（縦長のカード）。見た目の種類は cardDesign.ts の CARD_DESIGN で切り替わる。
 * 幅は親が決める（親の幅に合わせて文字・枠の大きさも変わる＝コンテナクエリ）。
 */
export function CardFace({ cardId, compact, selected, focused, onClick, onHover, caption, badge, className, style }: CardFaceProps) {
  const card = CARDS[cardId];
  if (!card) return null;
  const rarity = cardRarity(cardId);
  const kind = card.kind === "passive" ? "passive" : "active";
  const short = cardShort(cardId, card.description);

  const classes = ["cf", compact ? "cf--compact" : "", onClick ? "cf--btn" : "", selected ? "cf--selected" : "", focused ? "cf--focused" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const interactive = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};

  // ★3のトレカ風だけ、カーソルに合わせて傾け、光の点を追わせる。
  const tilt =
    CARD_DESIGN === "B" && rarity === 3
      ? {
          onPointerMove: (e: PointerEvent<HTMLElement>) => {
            const card = e.currentTarget.querySelector<HTMLElement>(".cf-b");
            if (!card) return;
            const r = card.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width;
            const y = (e.clientY - r.top) / r.height;
            card.style.setProperty("--ry", `${((x - 0.5) * 16).toFixed(1)}deg`);
            card.style.setProperty("--rx", `${((0.5 - y) * 16).toFixed(1)}deg`);
            card.style.setProperty("--mx", `${(x * 100).toFixed(0)}%`);
            card.style.setProperty("--my", `${(y * 100).toFixed(0)}%`);
          },
          onPointerLeave: (e: PointerEvent<HTMLElement>) => {
            const card = e.currentTarget.querySelector<HTMLElement>(".cf-b");
            card?.style.removeProperty("--rx");
            card?.style.removeProperty("--ry");
          },
        }
      : {};

  return (
    <div className={classes} style={style} {...interactive} {...tilt} onPointerEnter={onHover} title={card.description}>
      {CARD_DESIGN === "B" ? (
        <article className="cf-b" data-r={rarity} data-k={kind} aria-label={card.name}>
          <div className="cf-b__face">
            <div className="cf-b__name">
              <h3>{card.name}</h3>
              <span className="cf-b__gem" />
            </div>
            <div className="cf-b__window">
              <CardIcon cardId={cardId} />
            </div>
            <div className="cf-b__type">
              <span>{KIND_LONG[card.kind]}</span>
              <span className="cf-b__stars">{stars(rarity)}</span>
            </div>
            <div className="cf-b__text">
              <p>{short}</p>
            </div>
            <div className="cf-b__fx" />
            <div className="cf-b__spot" />
          </div>
        </article>
      ) : (
        <article className="cf-a" data-r={rarity} data-k={kind} aria-label={card.name}>
          <div className="cf-a__top">
            <span className="cf-a__stars">{stars(rarity)}</span>
            <span className={`cf-seal cf-seal--${kind}`}>{KIND_SHORT[card.kind]}</span>
          </div>
          <div className="cf-a__art">
            <CardIcon cardId={cardId} />
          </div>
          <h3>{card.name}</h3>
          <p>{short}</p>
        </article>
      )}
      {caption && <p className="cf-caption">{short}</p>}
      {badge}
    </div>
  );
}

/** 対局中の小さい表示（カード欄の1枚）。色・縁はカード面と同じ規則（種類で地の色、レア度で縁の色）。 */
export function CardChip({ cardId, note, ready, onClick }: { cardId: string; note: string; ready?: boolean; onClick?: () => void }) {
  const card = CARDS[cardId];
  if (!card) return null;
  const rarity = cardRarity(cardId);
  const kind = card.kind === "passive" ? "passive" : "active";
  const classes = ["cf-chip", ready ? "cf-chip--ready" : "", onClick ? "cf-chip--btn" : ""].filter(Boolean).join(" ");
  const body = (
    <>
      <CardIcon cardId={cardId} />
      <b>{card.name}</b>
      <small>{note}</small>
      <span className={`cf-seal cf-seal--${kind}`}>{KIND_SHORT[card.kind]}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={classes} data-r={rarity} data-k={kind} title={card.description} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={classes} data-r={rarity} data-k={kind} title={card.description}>
      {body}
    </span>
  );
}
