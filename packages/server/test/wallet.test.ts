import { describe, expect, it } from "vitest";
import {
  DAILY_LOGIN_JADE,
  EXCHANGE_COST,
  GACHA_PRICE,
  OVERFLOW_JADE,
  RANKED_JADE_DAILY_CAP,
  STARTING_JADE,
  charactersOfRarity,
  rarityOf,
} from "@majyan/core";
import { GachaError } from "../src/collection.js";
import { AccountService } from "../src/accounts.js";
import { CollectionService } from "../src/collection.js";
import { openDatabase } from "../src/db.js";
import { InsufficientJadeError, WalletService } from "../src/wallet.js";

function setup(startMs = Date.UTC(2026, 9, 1, 3, 0, 0)) {
  const db = openDatabase(":memory:");
  const clock = { t: startMs };
  const now = () => clock.t;
  const { profile } = new AccountService(db, now).createGuest("A");
  const wallet = new WalletService(db, now);
  const collections = new CollectionService(db, Math.random, now, wallet);
  const ledger = () =>
    db.prepare("SELECT free_delta, paid_delta, reason FROM jade_ledger WHERE user_id = ? ORDER BY id").all(profile.id) as {
      free_delta: number;
      paid_delta: number;
      reason: string;
    }[];
  const setPaid = (paid: number) => db.prepare("UPDATE wallets SET paid_jade = ? WHERE user_id = ?").run(paid, profile.id);
  return { db, clock, userId: profile.id, wallet, collections, ledger, setPaid };
}

describe("WalletService", () => {
  it("starts every account with the starting jade, recorded once", () => {
    const { wallet, userId, ledger } = setup();
    expect(wallet.balance(userId)).toEqual({ free: STARTING_JADE, paid: 0 });
    expect(wallet.balance(userId)).toEqual({ free: STARTING_JADE, paid: 0 });
    expect(ledger()).toEqual([{ free_delta: STARTING_JADE, paid_delta: 0, reason: "starting-bonus" }]);
  });

  it("spends free jade before paid jade", () => {
    const { wallet, userId, setPaid, ledger } = setup();
    wallet.balance(userId);
    setPaid(1000);
    expect(wallet.spend(userId, 1200, "test")).toEqual({ free: 300, paid: 1000 });
    expect(wallet.spend(userId, 500, "test")).toEqual({ free: 0, paid: 800 });
    expect(ledger().at(-1)).toEqual({ free_delta: -300, paid_delta: -200, reason: "test" });
  });

  it("refuses to spend more than the balance and changes nothing", () => {
    const { wallet, userId, ledger } = setup();
    wallet.balance(userId);
    const before = ledger().length;
    expect(() => wallet.spend(userId, STARTING_JADE + 1, "test")).toThrow(InsufficientJadeError);
    expect(wallet.balance(userId)).toEqual({ free: STARTING_JADE, paid: 0 });
    expect(ledger()).toHaveLength(before);
    expect(() => wallet.spend(userId, -5, "test")).toThrow();
  });

  it("gives the login bonus once per Japan-time day", () => {
    const { wallet, userId, clock } = setup(Date.UTC(2026, 9, 1, 14, 0, 0)); // 23:00 JST
    expect(wallet.claimDailyLogin(userId)).toBe(DAILY_LOGIN_JADE);
    expect(wallet.claimDailyLogin(userId)).toBeNull();
    clock.t = Date.UTC(2026, 9, 1, 15, 30, 0); // 翌日 00:30 JST
    expect(wallet.claimDailyLogin(userId)).toBe(DAILY_LOGIN_JADE);
    expect(wallet.balance(userId).free).toBe(STARTING_JADE + 2 * DAILY_LOGIN_JADE);
  });

  it("caps ranked rewards per day", () => {
    const { wallet, userId, clock } = setup();
    let total = 0;
    for (let i = 0; i < 20; i++) total += wallet.grantRankedReward(userId, "hanchan", 1, `m${i}`);
    expect(total).toBe(RANKED_JADE_DAILY_CAP);
    clock.t += 24 * 60 * 60_000;
    expect(wallet.grantRankedReward(userId, "tonpuusen", 2, "next-day")).toBe(30);
  });
});

describe("paid gacha", () => {
  it("spends jade, grants the characters and reports which are new", () => {
    const { wallet, collections, userId, db } = setup();
    const { results, newCharacterIds } = collections.rollGacha(userId, 10, wallet);
    expect(results).toHaveLength(10);
    expect(results.some((id) => rarityOf(id) >= 2)).toBe(true);
    expect(wallet.balance(userId).free).toBe(STARTING_JADE - GACHA_PRICE.ten);
    const owned = collections.owned(userId);
    for (const id of results) expect(owned).toContain(id);
    for (const id of newCharacterIds) expect(["hiiragi", "nagi", "sena"]).not.toContain(id);
    const logs = db.prepare("SELECT kind FROM gacha_log WHERE user_id = ?").all(userId) as { kind: string }[];
    expect(logs.map((l) => l.kind)).toEqual(["gacha-10"]);
  });

  it("does nothing at all when the player cannot afford it", () => {
    const { wallet, collections, userId, db } = setup();
    collections.rollGacha(userId, 10, wallet);
    // 凸の上限を超えた分が雀玉で戻ることがあるので、残りを使い切っておく。
    const left = wallet.balance(userId).free;
    if (left > 0) wallet.spend(userId, left, "test");
    const ownedBefore = collections.owned(userId);
    expect(() => collections.rollGacha(userId, 1, wallet)).toThrow(InsufficientJadeError);
    expect(collections.owned(userId)).toEqual(ownedBefore);
    const logs = db.prepare("SELECT COUNT(*) AS n FROM gacha_log WHERE user_id = ?").get(userId) as { n: number };
    expect(logs.n).toBe(1);
  });
});

describe("pity exchange and limit break", () => {
  const setPoints = (db: ReturnType<typeof setup>["db"], userId: string, points: number) =>
    db.prepare("INSERT INTO gacha_points (user_id, points) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET points = excluded.points").run(userId, points);

  it("earns one exchange point per pull", () => {
    const { wallet, collections, userId } = setup();
    collections.rollGacha(userId, 10, wallet);
    expect(collections.exchangePoints(userId)).toBe(10);
  });

  it("trades exchange points for a chosen ★3, and only a ★3", () => {
    const { collections, userId, db } = setup();
    const star3 = charactersOfRarity(3)[0]!;
    const star1 = charactersOfRarity(1)[0]!;
    expect(() => collections.exchange(userId, star3)).toThrow(GachaError); // ポイント不足
    setPoints(db, userId, EXCHANGE_COST + 5);
    expect(() => collections.exchange(userId, star1)).toThrow(GachaError);
    expect(() => collections.exchange(userId, "no-such-character")).toThrow(GachaError);
    const out = collections.exchange(userId, star3);
    expect(out).toEqual({ results: [star3], newCharacterIds: [star3], overflowJade: 0 });
    expect(collections.owned(userId)).toContain(star3);
    expect(collections.exchangePoints(userId)).toBe(5);
  });

  it("counts duplicates up to 4 limit breaks, then pays jade instead", () => {
    const { collections, userId, db, wallet } = setup();
    const star3 = charactersOfRarity(3)[0]!;
    setPoints(db, userId, EXCHANGE_COST * 7);
    for (let i = 0; i < 5; i++) expect(collections.exchange(userId, star3).overflowJade).toBe(0);
    expect(collections.copies(userId)[star3]).toBe(5);
    expect(collections.gaugeBonus(userId, star3)).toBe(0.2);
    const before = wallet.balance(userId).free;
    expect(collections.exchange(userId, star3).overflowJade).toBe(OVERFLOW_JADE[3]);
    expect(collections.copies(userId)[star3]).toBe(5);
    expect(wallet.balance(userId).free).toBe(before + OVERFLOW_JADE[3]);
    expect(rarityOf(star3)).toBe(3);
  });

  it("gives no gauge bonus to a character owned once or not at all", () => {
    const { collections, userId } = setup();
    expect(collections.gaugeBonus(userId, "nagi")).toBe(0);
    expect(collections.gaugeBonus(userId, "zeno")).toBe(0);
  });
});
