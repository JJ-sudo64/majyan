/**
 * カードの見た目の設定と、カード面に出す短い説明・系統・アイコン。
 *
 * 見た目は2種類を用意してあり、CARD_DESIGN を変えるだけで全画面（ガチャ・選択・手持ち・対局中）が切り替わる。
 *   "B": トレカ風（パッシブは青緑、アクティブは紫の地。名前の帯・イラスト窓・効果の枠）。採用中。
 *   "A": 金墨（黒地に金・銀・銅の二重の枠、種類は朱と緑の落款）。差し替え用に残してある。
 * 見た目のCSSは styles.css の「カードの見た目」の節（.cf-a / .cf-b）。
 */
export type CardDesign = "A" | "B";
export const CARD_DESIGN: CardDesign = "B";

/** カードの効果の系統。カード面の中央に出すアイコンの種類になる。 */
export type CardCategory = "deal" | "dora" | "gauge" | "score" | "bonus" | "info" | "guard" | "han";

const CATEGORY_IDS: Record<CardCategory, string[]> = {
  // 配牌を整える
  deal: [
    "meld-guarantee", "pair-guarantee", "yakuhai-guarantee", "tanyao-guarantee", "pair-guarantee-lite", "tanyao-step",
    "yakuhai-seed", "suit-lean", "seat-wind-pair", "dragon-pair", "honor-sweep", "terminal-sweep", "pair-step",
    "round-wind-pair", "triplet-seed", "hand-lift", "hand-lift-big",
  ],
  // ドラに関わる
  dora: ["dora-guarantee", "dora-guarantee-2", "dora-neighbor", "red-guarantee", "extra-dora", "double-ura-dora"],
  // 必殺技ゲージ
  gauge: [
    "gauge-fill", "gauge-fill-small", "gauge-fill-tiny", "gauge-fill-half", "gauge-boost", "gauge-boost-small",
    "gauge-savings", "opening-gauge", "dealer-gauge", "last-stand", "last-stand-small",
  ],
  // 点棒のやりとり
  score: [
    "point-drain-tiny", "point-drain-small", "point-drain", "dealer-tithe", "dealer-collection", "dealer-big-collection",
    "dealer-extort", "kyotaku-collector", "dealer-honba-boost", "no-cost-riichi",
  ],
  // 終局時の点数補正
  bonus: [
    "participation-prize", "top-place-trim", "round-up-bonus", "close-race", "soften-defeat", "big-win-afterglow",
    "origin-blessing", "last-place-small", "last-place-bonus", "catch-up-small", "catch-up", "second-place-small",
    "second-place-pride", "third-place-small", "third-place-grit",
  ],
  // 情報を見る
  info: ["peek-once", "future-sight", "future-sight-double", "insight", "insight-3", "tile-count-insight"],
  // 守る・無効にする
  guard: [
    "nullify", "nullify-double", "houjuu-guard", "tenpai-insurance", "bust-guard", "furiten-clear", "uncallable-yakuhai",
    "ippatsu-extend",
  ],
  // 和了の翻・得点を上げる
  han: ["dealer-boon", "riichi-boon", "tsumo-boon", "ron-boon", "menzen-boon", "han-up-1", "han-up-2", "han-up-3", "score-double"],
};

const CATEGORY_OF: Record<string, CardCategory> = {};
for (const [category, ids] of Object.entries(CATEGORY_IDS) as [CardCategory, string[]][]) {
  for (const id of ids) CATEGORY_OF[id] = category;
}

/** カードの系統。一覧に無い新しいカードは「配牌」扱い（アイコンが出るだけで困らない）。 */
export function cardCategory(cardId: string): CardCategory {
  return CATEGORY_OF[cardId] ?? "deal";
}

/** 系統ごとのアイコン（24x24の線画）。 */
export const CARD_ICON_PATH: Record<CardCategory, string> = {
  deal: "M3.5 5.5h5v13h-5z M9.5 5.5h5v13h-5z M15.5 5.5h5v13h-5z",
  dora: "M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z",
  gauge: "M13 2L4.5 13.5H11L10 22l8.5-11.5H12.5z",
  score: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M9 9h6v6H9z",
  bonus: "M12 3.8a5.2 5.2 0 1 0 0 10.4a5.2 5.2 0 0 0 0-10.4z M8.6 13.4L7 22l5-3 5 3-1.6-8.6",
  info: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z",
  guard: "M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z",
  han: "M12 20V5 M5.5 11.5L12 5l6.5 6.5 M6 20h12",
};

export const KIND_SHORT = { passive: "常時", consumable: "消費" } as const;
export const KIND_LONG = { passive: "パッシブ", consumable: "アクティブ" } as const;

/**
 * カード面に出す説明。カードの説明文（cards.tsのdescription）自体を、1〜2文の短い言葉で書いてあるので、
 * そのまま使う（以前はカード面専用の短い版を別に持っていたが、元の文を短くしたので1つにした）。
 */
export function cardShort(_cardId: string, description: string): string {
  return description;
}
