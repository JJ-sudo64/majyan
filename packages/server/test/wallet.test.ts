import { describe, expect, it } from "vitest";
import { DAILY_LOGIN_JADE, GACHA_PRICE, RANKED_JADE_DAILY_CAP, STARTING_JADE, rarityOf } from "@majyan/core";
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

  it("grants the reward for the same match only once", () => {
    const { wallet, userId } = setup();
    const first = wallet.grantRankedReward(userId, "tonpuusen", 1, "same-match");
    expect(first).toBeGreaterThan(0);
    // 再起動で対局を戻し、終了の処理がもう一度走っても二重には渡さない。
    expect(wallet.grantRankedReward(userId, "tonpuusen", 1, "same-match")).toBe(0);
  });
});

describe("paid gacha", () => {
  it("spends jade and grants the characters and cards", () => {
    const { wallet, collections, userId, db } = setup();
    const unitsBefore = collections.units(userId).length;
    const { results, isNew } = collections.rollGacha(userId, 10, wallet);
    expect(results).toHaveLength(10);
    expect(isNew).toHaveLength(10);
    expect(results.some((i) => rarityOf(i) >= 2)).toBe(true);
    expect(wallet.balance(userId).free).toBe(STARTING_JADE - GACHA_PRICE.ten);
    const chars = results.filter((i) => i.kind === "character").length;
    const cards = results.filter((i) => i.kind === "card").length;
    expect(collections.units(userId)).toHaveLength(unitsBefore + chars);
    expect(Object.values(collections.cards(userId)).reduce((a, b) => a + b, 0)).toBe(cards);
    const logs = db.prepare("SELECT kind FROM gacha_log WHERE user_id = ?").all(userId) as { kind: string }[];
    expect(logs.map((l) => l.kind)).toEqual(["gacha-10"]);
  });

  it("does nothing at all when the player cannot afford it", () => {
    const { wallet, collections, userId, db } = setup();
    collections.rollGacha(userId, 10, wallet); // 残り0
    const unitsBefore = collections.units(userId);
    const cardsBefore = collections.cards(userId);
    expect(() => collections.rollGacha(userId, 1, wallet)).toThrow(InsufficientJadeError);
    expect(collections.units(userId)).toEqual(unitsBefore);
    expect(collections.cards(userId)).toEqual(cardsBefore);
    expect(collections.exchangePoints(userId)).toBe(10);
    const logs = db.prepare("SELECT COUNT(*) AS n FROM gacha_log WHERE user_id = ?").get(userId) as { n: number };
    expect(logs.n).toBe(1);
  });
});
