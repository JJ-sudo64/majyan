import { CHARACTERS, rarityOf, type Rarity } from "@majyan/core";

export const RARITY_STARS: Record<Rarity, string> = { 1: "★", 2: "★★", 3: "★★★" };

/** ガチャの結果1枠ぶんのカード（最初の10連・通常のガチャで共通）。 */
export function GachaCard({ characterId, index, isNew }: { characterId: string; index: number; isNew?: boolean }) {
  const character = CHARACTERS[characterId];
  const rarity = rarityOf(characterId);
  return (
    <div className={`gacha-card gacha-card--r${rarity}`} style={{ animationDelay: `${index * 60}ms` }}>
      {isNew && <div className="gacha-card__new">NEW</div>}
      <div className="gacha-card__stars">{RARITY_STARS[rarity]}</div>
      {character && <img className="gacha-card__avatar" src={character.avatar} alt="" />}
      <div className="gacha-card__name">{character?.name.split("・").at(-1) ?? characterId}</div>
      <div className="gacha-card__skill">{character?.skill.name}</div>
    </div>
  );
}
