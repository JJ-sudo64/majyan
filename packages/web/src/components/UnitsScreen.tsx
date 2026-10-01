import { useState } from "react";
import { CARDS, CHARACTERS, cardRarity, characterRarity, type CharacterUnit } from "@majyan/core";
import { equipCard, useAccountStore } from "../online/account.js";
import { RARITY_STARS } from "./GachaCard.js";

/**
 * 手持ちのキャラとカード。カードを付けていないキャラに、手持ちのカードを1枚付けられる。
 * 一度付けたカードは外せないので、付ける前に必ず確認を挟む。
 */
export function UnitsScreen({ onClose }: { onClose: () => void }) {
  const units = useAccountStore((s) => s.units);
  const cards = useAccountStore((s) => s.cards);
  const error = useAccountStore((s) => s.error);
  const [selectedUnit, setSelectedUnit] = useState<CharacterUnit | null>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardIds = Object.keys(cards).sort((a, b) => cardRarity(b) - cardRarity(a));

  async function confirmEquip() {
    if (!selectedUnit || !selectedCard) return;
    setBusy(true);
    useAccountStore.setState({ error: null });
    try {
      if (await equipCard(selectedUnit.unitId, selectedCard)) {
        setSelectedUnit(null);
        setSelectedCard(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">手持ち（{units.length}体）</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="setup-lead">カードはキャラ1体に1枚だけ付けられます。一度付けたカードは外せません。</p>
        {error && <p className="online-lobby__error">{error}</p>}

        <div className="units-screen__grid">
          {units.map((u) => {
            const character = CHARACTERS[u.characterId];
            const card = u.cardId ? CARDS[u.cardId] : undefined;
            const selectable = !u.cardId && cardIds.length > 0;
            return (
              <button
                key={u.unitId}
                type="button"
                className={`units-screen__unit${selectedUnit?.unitId === u.unitId ? " units-screen__unit--selected" : ""}`}
                disabled={!selectable}
                onClick={() => {
                  setSelectedUnit(u);
                  setSelectedCard(null);
                }}
              >
                {character && <img src={character.avatar} alt="" />}
                <span className="units-screen__stars">{RARITY_STARS[characterRarity(u.characterId)]}</span>
                <span className="units-screen__name">{character?.name.split("・").at(-1) ?? u.characterId}</span>
                <span className={`units-screen__card${card ? "" : " units-screen__card--none"}`}>
                  {card ? `${RARITY_STARS[cardRarity(u.cardId!)]} ${card.name}` : "カードなし"}
                </span>
              </button>
            );
          })}
        </div>

        {selectedUnit && (
          <div className="units-screen__equip">
            <div className="online-lobby__section-title">
              {CHARACTERS[selectedUnit.characterId]?.name} に付けるカード
            </div>
            <div className="units-screen__cards">
              {cardIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`units-screen__card-choice${selectedCard === id ? " units-screen__card-choice--selected" : ""}`}
                  title={CARDS[id]?.description}
                  onClick={() => setSelectedCard(id)}
                >
                  {RARITY_STARS[cardRarity(id)]} {CARDS[id]?.name ?? id}（{cards[id]}枚）
                  <span className="units-screen__card-desc">{CARDS[id]?.description}</span>
                </button>
              ))}
            </div>
            {selectedCard && (
              <div className="first-gacha__confirm">
                <p>
                  {CHARACTERS[selectedUnit.characterId]?.name} に「{CARDS[selectedCard]?.name}」を付けますか？
                  <strong>一度付けると外せません。</strong>
                </p>
                <div className="setup-buttons">
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void confirmEquip()}>
                    付ける
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => setSelectedCard(null)}>
                    やめる
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {cardIds.length === 0 && <p className="setup-lead">付けられるカードを持っていません（カードはガチャで手に入ります）。</p>}
      </div>
    </div>
  );
}
