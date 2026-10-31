import { useState } from "react";
import { CARDS, cardRarity } from "@majyan/core";
import { KIND_LONG } from "../cardDesign.js";
import { CardFace } from "./CardFace.js";

export type SlotKind = "passive" | "consumable";

const STARS = ["", "★", "★★", "★★★"];

/** 欄の名前（パッシブカード欄／アクティブカード欄）。 */
export function slotLabel(kind: SlotKind): string {
  return `${KIND_LONG[kind]}カード欄`;
}

interface CardSlotProps {
  kind: SlotKind;
  /** 付いているカード。無ければ空の欄（破線の枠）を出す。 */
  cardId: string | null;
  /** 押すと選択画面を開く。渡さなければ表示だけ（押せない）。 */
  onOpen?: () => void;
  /** 空の欄に出す一言（既定は「押して選ぶ」）。付けられるカードが無い時の案内などに使う。 */
  emptyHint?: string;
}

/**
 * カード欄1つ。空なら破線の枠、付いていればそのカード。パッシブは青緑、アクティブは紫の縁で見分ける。
 * 「欄を開いて、その欄に付けられるカードだけから選ぶ」装着の入り口（CardSlotPicker）。
 */
export function CardSlot({ kind, cardId, onOpen, emptyHint }: CardSlotProps) {
  const card = cardId ? CARDS[cardId] : undefined;
  const body = (
    <>
      <span className="cs-slot__label">{slotLabel(kind)}</span>
      {card ? (
        <>
          <span className="cs-slot__face">
            <CardFace cardId={cardId!} compact />
          </span>
          <span className="cs-slot__name">{card.name}</span>
          {onOpen && <span className="cs-slot__edit">変える</span>}
        </>
      ) : (
        <>
          <span className="cs-slot__empty">
            <span className="cs-slot__plus">＋</span>
          </span>
          <span className="cs-slot__hint">{emptyHint ?? (onOpen ? "押して選ぶ" : "なし")}</span>
        </>
      )}
    </>
  );
  return onOpen ? (
    <button type="button" className="cs-slot cs-slot--btn" data-k={kind} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="cs-slot" data-k={kind}>
      {body}
    </div>
  );
}

interface CardSlotPickerProps {
  kind: SlotKind;
  title: string;
  /** 選べるカード（その欄の種類のものだけを渡す）。 */
  candidates: string[];
  /** 手持ちの枚数（あれば、カードの下に「N枚」と出す）。 */
  counts?: Record<string, number>;
  /** 今その欄に付いているカード（あれば最初から選んだ状態にする）。 */
  current?: string | null;
  /** 一度付けたら外せない装着か。trueなら、決める前に確認を挟む。 */
  permanent?: boolean;
  busy?: boolean;
  /** 候補が1枚も無い時の案内。 */
  emptyMessage: string;
  /** 付けるカードが決まった。 */
  onConfirm: (cardId: string) => void;
  /** 欄を空にする（外せる装着の時だけ渡す）。 */
  onClear?: () => void;
  onClose: () => void;
}

/**
 * 欄を開いた時の選択画面。この欄に付けられる種類のカードだけを並べ、押すと下に効果が出る。
 * 決める時は「付ける」。外せない装着（permanent）では、もう一度確認してから付ける。
 */
export function CardSlotPicker({ kind, title, candidates, counts, current, permanent, busy, emptyMessage, onConfirm, onClear, onClose }: CardSlotPickerProps) {
  const [rarity, setRarity] = useState<0 | 1 | 2 | 3>(0);
  const [picked, setPicked] = useState<string | null>(current ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // レア度の高い順、同じレア度は渡された順。
  const sorted = [...candidates].sort((a, b) => cardRarity(b) - cardRarity(a));
  const list = sorted.filter((id) => rarity === 0 || cardRarity(id) === rarity);
  const shownId = hover ?? picked ?? list[0] ?? null;
  const shown = shownId ? CARDS[shownId] : undefined;
  // 決めるのは「選んだカード」。まだ選んでいなければ、いま下に出ているカード。
  const targetId = picked ?? shownId;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="cs-picker" data-k={kind} onClick={(e) => e.stopPropagation()}>
        <div className="cs-picker__header">
          <div className="cs-picker__title">{title}</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        {permanent && <p className="cs-picker__note">一度付けたカードは外せません。</p>}

        {candidates.length === 0 ? (
          <p className="cs-picker__empty">{emptyMessage}</p>
        ) : (
          <>
            <div className="cs-picker__filters">
              {([0, 3, 2, 1] as const).map((r) => (
                <button key={r} type="button" className={`card-picker-filters__chip${rarity === r ? " is-active" : ""}`} onClick={() => setRarity(r)}>
                  {r === 0 ? "すべて" : STARS[r]}
                </button>
              ))}
              <span className="card-picker-filters__count">{list.length}枚</span>
            </div>
            <div className="cs-picker__grid" onPointerLeave={() => setHover(null)}>
              {list.map((id) => (
                <div key={id} className="cs-pick">
                  <CardFace
                    cardId={id}
                    compact
                    selected={picked === id}
                    onClick={() => {
                      setPicked(id);
                      setConfirming(false);
                    }}
                    onHover={() => setHover(id)}
                  />
                  {counts && <span className="cs-pick__count">{counts[id] ?? 0}枚</span>}
                </div>
              ))}
              {list.length === 0 && <p className="cs-picker__empty">このレア度のカードはありません。</p>}
            </div>
            <div className="card-picker-detail cs-picker__detail">
              {shown && shownId ? (
                <>
                  <div className="card-picker-detail__head">
                    <span className="card-picker-detail__name">{shown.name}</span>
                    <span className="card-tile__stars">{STARS[cardRarity(shownId)]}</span>
                    <span className="card-tile__kind">{KIND_LONG[shown.kind]}</span>
                  </div>
                  <p className="card-picker-detail__desc">{shown.description}</p>
                </>
              ) : (
                <p className="card-picker-detail__desc">カードを選ぶと、ここに効果が出ます。</p>
              )}
            </div>
            {confirming && targetId ? (
              <div className="first-gacha__confirm">
                <p>
                  「{CARDS[targetId]?.name}」を付けますか？ <strong>一度付けると外せません。</strong>
                </p>
                <div className="setup-buttons">
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onConfirm(targetId)}>
                    付ける
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)}>
                    やめる
                  </button>
                </div>
              </div>
            ) : (
              <div className="cs-picker__actions">
                {onClear && (
                  <button type="button" className="card-picker-filters__chip" onClick={onClear}>
                    なしにする
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!targetId || busy}
                  onClick={() => (permanent ? setConfirming(true) : targetId && onConfirm(targetId))}
                >
                  {permanent ? "付ける" : "このカードにする"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
