import { CARDS, CHARACTERS, cardRarity, characterRarity } from "@majyan/core";
import { RARITY_STARS } from "./GachaCard.js";

/**
 * キャラ1体の詳しい中身: 立ち絵・必殺技の説明・付けているカードの説明。
 * オンラインの「手持ち・カード」とホームの「詳しく見る」から出す（説明はここでしか読めない）。
 */
export function UnitDetail({ characterId, cardId }: { characterId: string; cardId: string | null }) {
  const character = CHARACTERS[characterId];
  if (!character) return null;
  const card = cardId ? CARDS[cardId] : undefined;
  return (
    <div className="unit-detail">
      <img className="unit-detail__art" src={character.cutin ?? character.avatar} alt="" />
      <div className="unit-detail__body">
        <div className="unit-detail__name">
          <span className="unit-detail__stars">{RARITY_STARS[characterRarity(characterId)]}</span>
          {character.name}
        </div>
        <div className="unit-detail__box">
          <div className="unit-detail__label">必殺技「{character.skill.name}」</div>
          <p className="unit-detail__text">{character.skill.description}</p>
        </div>
        <div className="unit-detail__box unit-detail__box--card">
          {card ? (
            <>
              <div className="unit-detail__label">
                カード <span className="unit-detail__stars">{RARITY_STARS[cardRarity(cardId!)]}</span>「{card.name}」
              </div>
              <p className="unit-detail__text">{card.description}</p>
            </>
          ) : (
            <div className="unit-detail__label unit-detail__label--none">カードなし</div>
          )}
        </div>
      </div>
    </div>
  );
}
