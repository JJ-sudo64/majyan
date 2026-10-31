import { useState } from "react";
import { CARDS, CHARACTERS, cardRarity, characterRarity } from "@majyan/core";
import { equipCard, useAccountStore } from "../online/account.js";
import { RARITY_STARS } from "./GachaCard.js";
import { UnitDetail } from "./UnitDetail.js";
import { CardSlotPicker, slotLabel, type SlotKind } from "./CardSlot.js";

/**
 * 手持ちのキャラとカード。キャラを押すと必殺技と付けたカードの説明が出る。
 * カードはパッシブ欄・アクティブ欄に1枚ずつ。空の欄を押すと、その欄に付けられる（種類が合う・持っている）
 * カードだけが開く。一度付けたカードは外せないので、付ける前に必ず確認を挟む。
 */
export function UnitsScreen({ onClose }: { onClose: () => void }) {
  const units = useAccountStore((s) => s.units);
  const cards = useAccountStore((s) => s.cards);
  const error = useAccountStore((s) => s.error);
  // 選んでいるキャラはIDで持つ（装着のたびにunitsが新しくなっても、最新の中身を読めるように）。
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [openSlot, setOpenSlot] = useState<SlotKind | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedUnit = units.find((u) => u.unitId === selectedUnitId) ?? null;
  const ownedCardIds = Object.keys(cards);

  function closeDetail() {
    setSelectedUnitId(null);
    setOpenSlot(null);
  }

  async function confirmEquip(cardId: string) {
    if (!selectedUnit) return;
    setBusy(true);
    useAccountStore.setState({ error: null });
    try {
      // 付けられたら欄の選択画面を閉じる（キャラの詳細は開いたまま。付いたカードがそこに出る）。
      if (await equipCard(selectedUnit.unitId, cardId)) setOpenSlot(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="gacha-screen" onClick={(e) => e.stopPropagation()}>
          <div className="setup-picker-modal__header">
            <div className="setup-character-select__label">手持ち（{units.length}体）</div>
            <button type="button" className="setup-picker-modal__close" onClick={onClose}>
              ×
            </button>
          </div>
          <p className="setup-lead">キャラを押すと、パッシブカード欄・アクティブカード欄にカードを付けられます。一度付けたカードは外せません。</p>
          {error && !selectedUnit && <p className="online-lobby__error">{error}</p>}

          <div className="units-screen__grid">
            {units.map((u) => {
              const character = CHARACTERS[u.characterId];
              const card = u.cardId ? CARDS[u.cardId] : undefined;
              const card2 = u.cardId2 ? CARDS[u.cardId2] : undefined;
              return (
                <button
                  key={u.unitId}
                  type="button"
                  className={`units-screen__unit${selectedUnitId === u.unitId ? " units-screen__unit--selected" : ""}`}
                  onClick={() => {
                    setSelectedUnitId(u.unitId);
                    setOpenSlot(null);
                  }}
                >
                  {character && <img src={character.avatar} alt="" />}
                  <span className="units-screen__stars">{RARITY_STARS[characterRarity(u.characterId)]}</span>
                  <span className="units-screen__name">{character?.name.split("・").at(-1) ?? u.characterId}</span>
                  <span className={`units-screen__card${card ? "" : " units-screen__card--none"}`}>
                    {card ? `${RARITY_STARS[cardRarity(u.cardId!)]} ${card.name}` : "パッシブなし"}
                  </span>
                  <span className={`units-screen__card${card2 ? "" : " units-screen__card--none"}`}>
                    {card2 ? `${RARITY_STARS[cardRarity(u.cardId2!)]} ${card2.name}` : "アクティブなし"}
                  </span>
                </button>
              );
            })}
          </div>

          {ownedCardIds.length === 0 && <p className="setup-lead">付けられるカードを持っていません（カードはガチャで手に入ります）。</p>}
        </div>
      </div>
      {selectedUnit && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="gacha-screen units-screen__detail" onClick={(e) => e.stopPropagation()}>
            <div className="setup-picker-modal__header">
              <div className="setup-character-select__label">キャラの詳細</div>
              <button type="button" className="setup-picker-modal__close" onClick={closeDetail}>
                ×
              </button>
            </div>
            {error && <p className="online-lobby__error">{error}</p>}
            <UnitDetail
              characterId={selectedUnit.characterId}
              cardId={selectedUnit.cardId}
              cardId2={selectedUnit.cardId2}
              onOpenSlot={setOpenSlot}
            />
          </div>
        </div>
      )}
      {selectedUnit && openSlot && (
        <CardSlotPicker
          kind={openSlot}
          title={`${CHARACTERS[selectedUnit.characterId]?.name ?? ""} の${slotLabel(openSlot)}に付けるカード`}
          // この欄に付けられるカード＝持っているカードのうち、この欄の種類のものだけ。
          candidates={ownedCardIds.filter((id) => CARDS[id]?.kind === openSlot)}
          counts={cards}
          permanent
          busy={busy}
          emptyMessage={`付けられる${openSlot === "passive" ? "パッシブ" : "アクティブ"}カードを持っていません（カードはガチャで手に入ります）。`}
          onConfirm={(id) => void confirmEquip(id)}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </>
  );
}
