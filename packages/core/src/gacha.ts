/**
 * キャラクターのレア度とガチャ（数値・振り分けはここに集めてあるので、調整はこの
 * ファイルだけで済む）。
 *
 * - レア度: ★1〜★3。必殺技が局の結果を大きく動かすキャラほど高い
 * - 最初から全員が持っているキャラ（STARTER_CHARACTER_IDS）
 * - 最初の10連（FIRST_GACHA）: 何度でも引き直せて、確定するとその結果がもらえる。★3が1人確定
 *
 * 抽選そのもの（rollGacha）は乱数を引数で受け取る純粋関数で、実際に引くのは
 * サーバーだけ（画面側で引くと結果を書き換えられるため）。
 */
import { CHARACTER_IDS } from "./characters.js";

export type Rarity = 1 | 2 | 3;

export const CHARACTER_RARITY: Record<string, Rarity> = {
  // ★3: 和了を直接引き寄せる・相手の行動を封じる等、局の結果を大きく動かす
  zeno: 3,
  raiko: 3,
  koki: 3,
  nyanjiro: 3,
  toki: 3,
  saki: 3,
  kagami: 3,
  // ★2: 強いが条件付き、または情報・守りで有利になる
  kaede: 2,
  ren: 2,
  karin: 2,
  takaharu: 2,
  kagerou: 2,
  mirai: 2,
  runa: 2,
  jin: 2,
  mio: 2,
  naoki: 2,
  // ★1: 効果が控えめ・運次第・見た目だけ等
  hiiragi: 1,
  nagi: 1,
  sena: 1,
  subaru: 1,
  masato: 1,
  tomohiro: 1,
  mebius: 1,
};

/** 新しいアカウントが最初から持っているキャラ。扱いやすく、攻め（ドラ増やし・
    引き直し）と守り（様子見）がそろう3人。 */
export const STARTER_CHARACTER_IDS: readonly string[] = ["hiiragi", "nagi", "sena"];

/** 1回引いた時に各レア度が出る確率（合計1）。 */
export const GACHA_RARITY_RATES: Record<Rarity, number> = { 3: 0.03, 2: 0.18, 1: 0.79 };

export const FIRST_GACHA = {
  count: 10,
  /** この中に最低1人入る（入らなければ最後の1枠をこのレア度で引き直す）。 */
  guaranteedRarity: 3 as Rarity,
};

export function rarityOf(characterId: string): Rarity {
  return CHARACTER_RARITY[characterId] ?? 1;
}

export function charactersOfRarity(rarity: Rarity): string[] {
  return CHARACTER_IDS.filter((id) => rarityOf(id) === rarity);
}

function pickRarity(rng: () => number): Rarity {
  const r = rng();
  if (r < GACHA_RARITY_RATES[3]) return 3;
  if (r < GACHA_RARITY_RATES[3] + GACHA_RARITY_RATES[2]) return 2;
  return 1;
}

function pickCharacter(rng: () => number, rarity: Rarity): string {
  const pool = charactersOfRarity(rarity);
  return pool[Math.floor(rng() * pool.length)]!;
}

/**
 * ガチャをcount回引く。guaranteedRarityを渡すと、その結果に一度もそのレア度
 * 以上が無かった場合に最後の1枠をそのレア度で引き直す（「★3が1人確定」）。
 */
export function rollGacha(rng: () => number, count: number, guaranteedRarity?: Rarity): string[] {
  const results: string[] = [];
  for (let i = 0; i < count; i++) results.push(pickCharacter(rng, pickRarity(rng)));
  if (guaranteedRarity && count > 0 && !results.some((id) => rarityOf(id) >= guaranteedRarity)) {
    results[count - 1] = pickCharacter(rng, guaranteedRarity);
  }
  return results;
}
