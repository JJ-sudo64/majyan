import { describe, expect, it } from "vitest";
import { CHARACTER_IDS } from "../src/characters.js";
import { CARD_IDS } from "../src/cards.js";
import {
  CARD_RARITY,
  CHARACTER_RARITY,
  FIRST_GACHA,
  GACHA_RARITY_RATES,
  gachaPool,
  itemRate,
  jstDate,
  rankedJadeReward,
  rarityOf,
  rollFirstGacha,
  rollGacha,
  PICKUP_SHARE,
  pickupItemsOf,
  TEN_PULL_GUARANTEE,
  type GachaItem,
  type GachaPickup,
} from "../src/gacha.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

describe("rarity", () => {
  it("gives every character and every card exactly one rarity, and nothing else", () => {
    expect(Object.keys(CHARACTER_RARITY).sort()).toEqual([...CHARACTER_IDS].sort());
    expect(Object.keys(CARD_RARITY).sort()).toEqual([...CARD_IDS].sort());
    for (const r of [1, 2, 3] as const) {
      expect(gachaPool(r, "character").length).toBeGreaterThan(0);
      expect(gachaPool(r, "card").length).toBeGreaterThan(0);
    }
  });

  it("fixes an existing character into the first 10-pull", () => {
    expect(FIRST_GACHA.fixed.kind).toBe("character");
    expect(CHARACTER_IDS).toContain(FIRST_GACHA.fixed.id);
  });

  it("has rates that add up to 1, per rarity and per item", () => {
    expect(GACHA_RARITY_RATES[1] + GACHA_RARITY_RATES[2] + GACHA_RARITY_RATES[3]).toBeCloseTo(1, 10);
    const all: GachaItem[] = [...gachaPool(1), ...gachaPool(2), ...gachaPool(3)];
    expect(all.reduce((sum, item) => sum + itemRate(item), 0)).toBeCloseTo(1, 10);
  });
});

describe("rollGacha", () => {
  it("returns real characters and cards", () => {
    const results = rollGacha(makeRng(1), 200);
    for (const item of results) expect(item.kind === "character" ? CHARACTER_IDS : CARD_IDS).toContain(item.id);
    expect(results.some((i) => i.kind === "character")).toBe(true);
    expect(results.some((i) => i.kind === "card")).toBe(true);
  });

  it("always includes Masato in the first 10-pull, the other 9 slots fully random", () => {
    let withoutStar3 = 0;
    const positions = new Set<number>();
    for (let seed = 1; seed <= 100; seed++) {
      const results = rollFirstGacha(makeRng(seed));
      expect(results).toHaveLength(FIRST_GACHA.count);
      const at = results.findIndex((i) => i.kind === "character" && i.id === FIRST_GACHA.fixed.id);
      expect(at).toBeGreaterThanOrEqual(0);
      positions.add(at);
      // 残りの9枠には確定枠が無いので、★3が1つも無い結果も普通に出る。
      if (!results.some((i) => rarityOf(i) === 3)) withoutStar3++;
    }
    expect(withoutStar3).toBeGreaterThan(0);
    expect(positions.size).toBeGreaterThan(1); // いつも同じ場所に出るわけではない
  });

  it("guarantees ★2 or better in a normal 10-pull", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const results = rollGacha(makeRng(seed), 10, TEN_PULL_GUARANTEE);
      expect(results.some((i) => rarityOf(i) >= 2)).toBe(true);
    }
  });

  it("roughly follows the published rates", () => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    const n = 50_000;
    for (const item of rollGacha(makeRng(42), n)) counts[rarityOf(item)]++;
    expect(counts[3] / n).toBeGreaterThan(0.02);
    expect(counts[3] / n).toBeLessThan(0.04);
    expect(counts[2] / n).toBeGreaterThan(0.16);
    expect(counts[2] / n).toBeLessThan(0.2);
  });
});

describe("jade helpers", () => {
  it("doubles ranked rewards for hanchan", () => {
    expect(rankedJadeReward("tonpuusen", 1)).toBe(50);
    expect(rankedJadeReward("hanchan", 4)).toBe(20);
  });

  it("splits days at midnight Japan time", () => {
    // 2026-10-01 14:59:59Z = 23:59:59 JST, 15:00:00Z = 翌日 00:00 JST
    expect(jstDate(Date.UTC(2026, 9, 1, 14, 59, 59))).toBe("2026-10-01");
    expect(jstDate(Date.UTC(2026, 9, 1, 15, 0, 0))).toBe("2026-10-02");
  });
});

describe("pickup", () => {
  const pickup: GachaPickup = {
    id: 1,
    title: "テスト",
    items: [
      { kind: "character", id: "zeno" },
      { kind: "card", id: "han-up-1" },
      { kind: "character", id: "no-such-character" },
    ],
    startsAt: 0,
    endsAt: 1,
  };
  const all: GachaItem[] = [...gachaPool(1), ...gachaPool(2), ...gachaPool(3)];

  it("keeps rarity rates and the total at 1 while raising only the featured items", () => {
    expect(all.reduce((sum, item) => sum + itemRate(item, pickup), 0)).toBeCloseTo(1, 10);
    for (const r of [1, 2, 3] as const) {
      expect(gachaPool(r).reduce((sum, item) => sum + itemRate(item, pickup), 0)).toBeCloseTo(GACHA_RARITY_RATES[r], 10);
    }
    const zeno: GachaItem = { kind: "character", id: "zeno" };
    // ★3の半分がピックアップの1人に集まる。
    expect(itemRate(zeno, pickup)).toBeCloseTo(GACHA_RARITY_RATES[3] * PICKUP_SHARE + itemRate(zeno) * (1 - PICKUP_SHARE), 10);
    expect(itemRate({ kind: "character", id: "raiko" }, pickup)).toBeCloseTo(itemRate({ kind: "character", id: "raiko" }) * (1 - PICKUP_SHARE), 10);
    // 対象のいない★1はふだんどおり。知らないIDは無視する。
    expect(itemRate({ kind: "character", id: "masato" }, pickup)).toBe(itemRate({ kind: "character", id: "masato" }));
    expect(pickupItemsOf(pickup, 3)).toEqual([zeno]);
  });

  it("rolls at the displayed rates", () => {
    const n = 60_000;
    const results = rollGacha(makeRng(7), n, undefined, pickup);
    const count = (item: GachaItem) => results.filter((r) => r.kind === item.kind && r.id === item.id).length / n;
    for (const item of [
      { kind: "character", id: "zeno" },
      { kind: "card", id: "han-up-1" },
      { kind: "character", id: "raiko" },
      { kind: "character", id: "masato" },
    ] as GachaItem[]) {
      const expected = itemRate(item, pickup);
      expect(Math.abs(count(item) - expected)).toBeLessThan(4 * Math.sqrt((expected * (1 - expected)) / n) + 1e-4);
    }
  });
});
