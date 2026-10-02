/**
 * ガチャと、キャラ・カードのレア度（数値・振り分けはここに集めてあるので、調整は
 * このファイルだけで済む）。
 *
 * - ガチャからはキャラとカードが混ざって出る。同じキャラが出たら1体ずつ別に持つ
 *   （凸のような「重ねて強くする」仕組みは無い）。カードは手持ちのキャラ1体に
 *   1枚だけ付けられ、付けたら外せない。何のカードを付けたかで同じキャラにも
 *   別々の価値が生まれる
 * - レア度: ★1〜★3。局の結果を大きく動かすものほど高い
 * - 最初から持っているキャラは無い。最初の10連（FIRST_GACHA）: 何度でも引き直せて、確定するとその
 *   結果がもらえる。マサト（FIRST_GACHA.fixed）が必ず1枠入り、残りの9枠は確定枠なしの完全ランダム
 * - 天井: 通常のガチャを引くと交換ポイントがたまり、★3のキャラかカードを1つ選んでもらえる
 *
 * 抽選そのもの（rollGacha）は乱数を引数で受け取る純粋関数で、実際に引くのは
 * サーバーだけ（画面側で引くと結果を書き換えられるため）。
 */
import { CHARACTER_IDS } from "./characters.js";
import { CARD_IDS } from "./cards.js";

export type Rarity = 1 | 2 | 3;

/** ガチャから出るもの1つ。 */
export interface GachaItem {
  kind: "character" | "card";
  id: string;
}

export const CHARACTER_RARITY: Record<string, Rarity> = {
  // ★3: 和了を直接引き寄せる・相手の行動を封じる等、局の結果を大きく動かす
  zeno: 3,
  raiko: 3,
  koki: 3,
  kagerou: 3,
  kaede: 3,
  // ★2: 強いが条件付き、または情報・守りで有利になる
  ren: 2,
  karin: 2,
  takaharu: 2,
  mirai: 2,
  runa: 2,
  jin: 2,
  mio: 2,
  naoki: 2,
  saki: 2,
  nyanjiro: 2,
  kagami: 2,
  toki: 2,
  mebius: 2,
  // ★1: 効果が控えめ・運次第・見た目だけ等
  hiiragi: 1,
  nagi: 1,
  sena: 1,
  subaru: 1,
  masato: 1,
  tomohiro: 1,
};

export const CARD_RARITY: Record<string, Rarity> = {
  // ★3: 点数や局の結果を大きく動かす
  "score-double": 3,
  "point-drain": 3,
  "han-up-2": 3,
  nullify: 3,
  "dora-guarantee": 3,
  // ★2: 毎局効く、または狙った場面で確実に得をする
  "meld-guarantee": 2,
  "han-up-1": 2,
  "future-sight": 2,
  insight: 2,
  "double-ura-dora": 2,
  "houjuu-guard": 2,
  "last-place-bonus": 2,
  "kyotaku-collector": 2,
  "last-stand": 2,
  "ippatsu-extend": 2,
  // ★1: 1回きりの保険・場面が限られる
  "tenpai-insurance": 1,
  "bust-guard": 1,
  "tile-count-insight": 1,
  "furiten-clear": 1,
  "uncallable-yakuhai": 1,
  "no-cost-riichi": 1,
  "dealer-honba-boost": 1,
};

/** 1回引いた時に各レア度が出る確率（合計1）。同じレア度の中ではキャラ・カードを区別せず均等。 */
export const GACHA_RARITY_RATES: Record<Rarity, number> = { 3: 0.03, 2: 0.18, 1: 0.79 };

export interface GachaGuarantee {
  rarity: Rarity;
  /** 指定するとその種類（キャラ/カード）に限る。 */
  kind?: GachaItem["kind"];
}

export const FIRST_GACHA: { count: number; fixed: GachaItem } = {
  count: 10,
  // 最初から持っているキャラは無いので、対局に出せるキャラが必ず1人はいるように、
  // マサトを必ず1枠入れる。残りは確定枠なしの完全ランダム（何度でも引き直せるので、
  // 好きな結果が出るまで粘れる）。
  fixed: { kind: "character", id: "masato" },
};

export function rarityOf(item: GachaItem): Rarity {
  return (item.kind === "character" ? CHARACTER_RARITY[item.id] : CARD_RARITY[item.id]) ?? 1;
}

export function characterRarity(characterId: string): Rarity {
  return CHARACTER_RARITY[characterId] ?? 1;
}

export function cardRarity(cardId: string): Rarity {
  return CARD_RARITY[cardId] ?? 1;
}

/** そのレア度で出るもの（キャラ・カード）。kindで絞り込める。 */
export function gachaPool(rarity: Rarity, kind?: GachaItem["kind"]): GachaItem[] {
  const characters = CHARACTER_IDS.filter((id) => characterRarity(id) === rarity).map((id): GachaItem => ({ kind: "character", id }));
  const cards = CARD_IDS.filter((id) => cardRarity(id) === rarity).map((id): GachaItem => ({ kind: "card", id }));
  if (kind === "character") return characters;
  if (kind === "card") return cards;
  return [...characters, ...cards];
}

/** 1回引いた時にそのもの1つが出る確率（提供割合の表示用）。 */
export function itemRate(item: GachaItem): number {
  const rarity = rarityOf(item);
  return GACHA_RARITY_RATES[rarity] / gachaPool(rarity).length;
}

function pickRarity(rng: () => number): Rarity {
  const r = rng();
  if (r < GACHA_RARITY_RATES[3]) return 3;
  if (r < GACHA_RARITY_RATES[3] + GACHA_RARITY_RATES[2]) return 2;
  return 1;
}

function pickItem(rng: () => number, rarity: Rarity, kind?: GachaItem["kind"]): GachaItem {
  const pool = gachaPool(rarity, kind);
  return pool[Math.floor(rng() * pool.length)]!;
}

const meets = (item: GachaItem, g: GachaGuarantee) => rarityOf(item) >= g.rarity && (!g.kind || item.kind === g.kind);

/**
 * ガチャをcount回引く。guaranteeを渡すと、結果にその条件を満たすものが1つも
 * 無かった場合に、最後の1枠をその条件で引き直す（「10連で★2以上が1つ確定」等）。
 */
export function rollGacha(rng: () => number, count: number, guarantee?: GachaGuarantee): GachaItem[] {
  const results: GachaItem[] = [];
  for (let i = 0; i < count; i++) results.push(pickItem(rng, pickRarity(rng)));
  if (guarantee && count > 0 && !results.some((item) => meets(item, guarantee))) {
    results[count - 1] = pickItem(rng, guarantee.rarity, guarantee.kind);
  }
  return results;
}

/** 最初の10連を引く。FIRST_GACHA.fixedが必ず1つ入り（場所はランダム）、残りは完全ランダム。 */
export function rollFirstGacha(rng: () => number): GachaItem[] {
  const results = rollGacha(rng, FIRST_GACHA.count - 1);
  results.splice(Math.floor(rng() * FIRST_GACHA.count), 0, { ...FIRST_GACHA.fixed });
  return results;
}

// ---------------------------------------------------------------------------
// 雀玉（ゲーム内通貨）と通常のガチャ
// ---------------------------------------------------------------------------

/** 通常のガチャの値段（雀玉）。 */
export const GACHA_PRICE = { single: 150, ten: 1500 } as const;

/** 通常の10連は、この中に最低1つ★2以上が入る（キャラ・カードどちらでも）。 */
export const TEN_PULL_GUARANTEE: GachaGuarantee = { rarity: 2 };

/** アカウントを作った時にもらえる雀玉。 */
export const STARTING_JADE = 1500;

/** 1日1回のログインボーナス（日付は日本時間で区切る）。 */
export const DAILY_LOGIN_JADE = 100;

/** 段位戦1試合の報酬（半荘戦はこの倍）。順位1〜4。 */
export const RANKED_JADE_REWARD_TONPUUSEN: readonly [number, number, number, number] = [50, 30, 20, 10];

/** 段位戦の報酬で1日にもらえる上限（日本時間の日付で区切る）。 */
export const RANKED_JADE_DAILY_CAP = 600;

export function rankedJadeReward(format: "hanchan" | "tonpuusen", place: 1 | 2 | 3 | 4): number {
  const base = RANKED_JADE_REWARD_TONPUUSEN[place - 1]!;
  return format === "hanchan" ? base * 2 : base;
}

/** 日本時間の日付（YYYY-MM-DD）。ログインボーナス等の「1日」の区切りに使う。 */
export function jstDate(epochMs: number): string {
  return new Date(epochMs + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 天井（交換ポイント）
// ---------------------------------------------------------------------------

/** 通常のガチャ1回でたまる交換ポイント（最初の10連は対象外）。 */
export const EXCHANGE_POINTS_PER_PULL = 1;

/** この交換ポイントで★3のキャラかカードを1つ選んでもらえる（天井）。 */
export const EXCHANGE_COST = 200;

/** 交換でもらえるレア度。 */
export const EXCHANGE_RARITY: Rarity = 3;
