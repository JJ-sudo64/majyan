import { CARDS, CHARACTERS, rarityOf, type GachaItem, type Rarity } from "@majyan/core";
import { CardFace } from "./CardFace.js";

export const RARITY_STARS: Record<Rarity, string> = { 1: "★", 2: "★★", 3: "★★★" };

/** キャラ・カードの表示名（キャラは「異名・名前」の名前部分だけ）。 */
export function itemName(item: GachaItem): string {
  if (item.kind === "character") return CHARACTERS[item.id]?.name.split("・").at(-1) ?? item.id;
  return CARDS[item.id]?.name ?? item.id;
}

/** ガチャの結果1枠ぶん（キャラまたはカード。最初の10連・通常のガチャ・交換で共通）。 */
export function GachaCard({ item, index, isNew }: { item: GachaItem; index: number; isNew?: boolean }) {
  const rarity = rarityOf(item);
  const character = item.kind === "character" ? CHARACTERS[item.id] : undefined;
  const card = item.kind === "card" ? CARDS[item.id] : undefined;
  // カードは、カード面（CardFace）で出す。説明は押さずに読めないので、ホバーで全文が出る。
  if (card) {
    return (
      <div className="gacha-cardface" style={{ animationDelay: `${index * 110}ms` }}>
        <CardFace cardId={item.id} compact caption badge={isNew ? <div className="gacha-card__new">NEW</div> : undefined} />
      </div>
    );
  }
  return (
    <div className={`gacha-card gacha-card--r${rarity}`} style={{ animationDelay: `${index * 110}ms` }} title={character?.skill.description}>
      {isNew && <div className="gacha-card__new">NEW</div>}
      <div className="gacha-card__stars">{RARITY_STARS[rarity]}</div>
      {character && <img className="gacha-card__avatar" src={character.avatar} alt="" />}
      <div className="gacha-card__name">{itemName(item)}</div>
      <div className="gacha-card__skill">{character ? character.skill.name : ""}</div>
    </div>
  );
}
