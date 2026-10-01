import { describe, expect, it } from "vitest";
import { CHARACTER_IDS } from "../src/characters.js";
import {
  CHARACTER_RARITY,
  charactersOfRarity,
  FIRST_GACHA,
  GACHA_RARITY_RATES,
  rarityOf,
  rollGacha,
  STARTER_CHARACTER_IDS,
} from "../src/gacha.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

describe("character rarity", () => {
  it("gives every character exactly one rarity, and nothing else", () => {
    expect(Object.keys(CHARACTER_RARITY).sort()).toEqual([...CHARACTER_IDS].sort());
    for (const r of [1, 2, 3] as const) expect(charactersOfRarity(r).length).toBeGreaterThan(0);
  });

  it("uses existing characters as starters", () => {
    for (const id of STARTER_CHARACTER_IDS) expect(CHARACTER_IDS).toContain(id);
  });

  it("has rates that add up to 1", () => {
    expect(GACHA_RARITY_RATES[1] + GACHA_RARITY_RATES[2] + GACHA_RARITY_RATES[3]).toBeCloseTo(1, 10);
  });
});

describe("rollGacha", () => {
  it("returns real characters", () => {
    const results = rollGacha(makeRng(1), 10);
    expect(results).toHaveLength(10);
    for (const id of results) expect(CHARACTER_IDS).toContain(id);
  });

  it("always includes the guaranteed rarity in the first 10-pull", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const results = rollGacha(makeRng(seed), FIRST_GACHA.count, FIRST_GACHA.guaranteedRarity);
      expect(results.some((id) => rarityOf(id) === 3), `seed ${seed}`).toBe(true);
    }
  });

  it("roughly follows the published rates", () => {
    const rng = makeRng(42);
    const counts = { 1: 0, 2: 0, 3: 0 };
    const n = 50_000;
    for (const id of rollGacha(rng, n)) counts[rarityOf(id)]++;
    expect(counts[3] / n).toBeGreaterThan(0.02);
    expect(counts[3] / n).toBeLessThan(0.04);
    expect(counts[2] / n).toBeGreaterThan(0.16);
    expect(counts[2] / n).toBeLessThan(0.2);
  });
});
