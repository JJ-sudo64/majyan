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
  rollGacha,
  STARTER_CHARACTER_IDS,
  TEN_PULL_GUARANTEE,
  type GachaItem,
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

  it("uses existing characters as starters", () => {
    for (const id of STARTER_CHARACTER_IDS) expect(CHARACTER_IDS).toContain(id);
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

  it("always includes a ★3 character in the first 10-pull", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const results = rollGacha(makeRng(seed), FIRST_GACHA.count, FIRST_GACHA.guarantee);
      expect(results.some((i) => i.kind === "character" && rarityOf(i) === 3), `seed ${seed}`).toBe(true);
    }
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
