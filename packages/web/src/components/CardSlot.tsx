import { useEffect, useState, type ReactNode } from "react";
import { CARDS, cardRarity } from "@majyan/core";
import { KIND_LONG } from "../cardDesign.js";
import { CardFace } from "./CardFace.js";
import { useT, useTn, type Translate } from "../i18n/index.js";

export type SlotKind = "passive" | "consumable";

const STARS = ["", "★", "★★", "★★★"];

/** 欄の名前（パッシブカード欄／アクティブカード欄）。 */
export function slotLabel(kind: SlotKind, t: Translate): string {
  return t("card.slotLabel", { kind: t(KIND_LONG[kind]) });
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
  const t = useT();
  const card = cardId ? CARDS[cardId] : undefined;
  const body = (
    <>
      <span className="cs-slot__label">{slotLabel(kind, t)}</span>
      {card ? (
        <>
          <span className="cs-slot__face">
            <CardFace cardId={cardId!} compact />
          </span>
          <span className="cs-slot__name">{card.name}</span>
          {onOpen && <span className="cs-slot__edit">{t("cardSlot.t1")}</span>}
        </>
      ) : (
        <>
          <span className="cs-slot__empty">
            <span className="cs-slot__plus">＋</span>
          </span>
          <span className="cs-slot__hint">{emptyHint ?? (onOpen ? t("cardSlot.t9") : t("cardSlot.t10"))}</span>
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
  /** 見出しの下に出す案内（装着の練習の説明など）。 */
  banner?: ReactNode;
  /** 今どの段階か（browse=選んでいる／picked=1枚選んだ／confirm=「付けますか？」の確認中）を知らせる。練習の案内用。 */
  onStage?: (stage: "browse" | "picked" | "confirm") => void;
}

/**
 * 欄を開いた時の選択画面。この欄に付けられる種類のカードだけを並べ、押すと下に効果が出る。
 * 決める時は「付ける」。外せない装着（permanent）では、もう一度確認してから付ける。
 */
export function CardSlotPicker({ kind, title, candidates, counts, current, permanent, busy, emptyMessage, onConfirm, onClear, onClose, banner, onStage }: CardSlotPickerProps) {
  const tn = useTn();
  const t = useT();
  const [rarity, setRarity] = useState<0 | 1 | 2 | 3>(0);
  const [picked, setPicked] = useState<string | null>(current ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 段階を親へ知らせる（練習の案内が、今やることを出し分けるため）。
  useEffect(() => {
    onStage?.(confirming ? "confirm" : picked ? "picked" : "browse");
  }, [confirming, picked, onStage]);

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
        {banner}
        {permanent && <p className="cs-picker__note">{t("cardSlot.t2")}</p>}

        {candidates.length === 0 ? (
          <p className="cs-picker__empty">{emptyMessage}</p>
        ) : (
          <>
            <div className="cs-picker__filters">
              {([0, 3, 2, 1] as const).map((r) => (
                <button key={r} type="button" className={`card-picker-filters__chip${rarity === r ? " is-active" : ""}`} onClick={() => setRarity(r)}>
                  {r === 0 ? t("cardSlot.t11") : STARS[r]}
                </button>
              ))}
              <span className="card-picker-filters__count">{t("cardSlot.t12", { length: list.length })}</span>
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
                  {counts && <span className="cs-pick__count">{t("cardSlot.t13", { v1: counts[id] ?? 0 })}</span>}
                </div>
              ))}
              {list.length === 0 && <p className="cs-picker__empty">{t("cardSlot.t3")}</p>}
            </div>
            <div className="card-picker-detail cs-picker__detail">
              {shown && shownId ? (
                <>
                  <div className="card-picker-detail__head">
                    <span className="card-picker-detail__name">{shown.name}</span>
                    <span className="card-tile__stars">{STARS[cardRarity(shownId)]}</span>
                    <span className="card-tile__kind">{t(KIND_LONG[shown.kind])}</span>
                  </div>
                  <p className="card-picker-detail__desc">{shown.description}</p>
                </>
              ) : (
                <p className="card-picker-detail__desc">{t("cardSlot.t4")}</p>
              )}
            </div>
            {confirming && targetId ? (
              <div className="first-gacha__confirm">
                <p>{tn("cardSlot.t15", { name: CARDS[targetId]?.name, strong: <strong>{t("cardSlot.t5")}</strong> })}</p>
                <div className="setup-buttons">
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onConfirm(targetId)}>
                    {t("cardSlot.t6")}
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)}>
                    {t("cardSlot.t7")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="cs-picker__actions">
                {onClear && (
                  <button type="button" className="card-picker-filters__chip" onClick={onClear}>
                    {t("cardSlot.t8")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!targetId || busy}
                  onClick={() => (permanent ? setConfirming(true) : targetId && onConfirm(targetId))}
                >
                  {permanent ? t("cardSlot.t6") : t("cardSlot.t14")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
