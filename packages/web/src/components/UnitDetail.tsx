import { CARDS, CHARACTERS, cardRarity, characterRarity } from "@majyan/core";
import { RARITY_STARS } from "./GachaCard.js";
import { CardFace } from "./CardFace.js";
import { CardSlot, type SlotKind } from "./CardSlot.js";

/**
 * キャラ1体の詳しい中身: 立ち絵・必殺技の説明・付けているカードの説明。
 * オンラインの「手持ち・カード」とホームの「詳しく見る」から出す（説明はここでしか読めない）。
 */
export function UnitDetail({
  characterId,
  cardId,
  cardId2 = null,
  onOpenSlot,
}: {
  characterId: string;
  cardId: string | null;
  cardId2?: string | null;
  /** 渡すと、空のカード欄を押して選択画面を開ける（手持ち画面の装着用）。渡さなければ表示だけ。 */
  onOpenSlot?: (kind: SlotKind) => void;
}) {
  const character = CHARACTERS[characterId];
  if (!character) return null;
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
        {(
          [
            { slot: "パッシブ", kind: "passive", id: cardId },
            { slot: "アクティブ", kind: "consumable", id: cardId2 },
          ] as const
        ).map(({ slot, kind, id }) => {
          const card = id ? CARDS[id] : undefined;
          // 装着できる画面では、空の欄をカード欄として出す（押すと、その欄に付けられるカードだけが開く）。
          if (!card && onOpenSlot) {
            return (
              <div key={slot} className="unit-detail__box unit-detail__box--card unit-detail__box--slot">
                <CardSlot kind={kind} cardId={null} onOpen={() => onOpenSlot(kind)} emptyHint="押して装着する" />
                <p className="unit-detail__text">{slot}カードは付いていません。</p>
              </div>
            );
          }
          return (
            <div key={slot} className="unit-detail__box unit-detail__box--card">
              {card ? (
                <div className="unit-detail__card">
                  <div className="unit-detail__card-face">
                    <CardFace cardId={id!} compact />
                  </div>
                  <div className="unit-detail__card-body">
                    <div className="unit-detail__label">
                      {slot}カード <span className="unit-detail__stars">{RARITY_STARS[cardRarity(id!)]}</span>「{card.name}」
                    </div>
                    <p className="unit-detail__text">{card.description}</p>
                  </div>
                </div>
              ) : (
                <div className="unit-detail__label unit-detail__label--none">{slot}カードなし</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
