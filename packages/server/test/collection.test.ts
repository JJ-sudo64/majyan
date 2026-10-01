import { describe, expect, it } from "vitest";
import { rarityOf, STARTER_CHARACTER_IDS } from "@majyan/core";
import { AccountService } from "../src/accounts.js";
import { CollectionService, GachaError } from "../src/collection.js";
import { openDatabase } from "../src/db.js";

function setup() {
  const db = openDatabase(":memory:");
  let t = 1_000_000;
  const now = () => (t += 1000); // 呼ぶたびに1秒進む（引き直しの間隔制限に引っかからないように）
  const accounts = new AccountService(db, now);
  const collections = new CollectionService(db, Math.random, now);
  const { profile } = accounts.createGuest("A");
  return { db, collections, userId: profile.id };
}

describe("CollectionService", () => {
  it("gives the starter characters to every account", () => {
    const { collections, userId } = setup();
    expect([...collections.owned(userId)].sort()).toEqual([...STARTER_CHARACTER_IDS].sort());
  });

  it("lets the first 10-pull be rerolled until confirmed, then grants it once", () => {
    const { db, collections, userId } = setup();
    expect(collections.firstGachaState(userId)).toEqual({ confirmed: false, pending: null, rolls: 0 });
    expect(() => collections.confirmFirstGacha(userId)).toThrow(GachaError);

    collections.rollFirstGacha(userId);
    const second = collections.rollFirstGacha(userId);
    expect(second.rolls).toBe(2);
    expect(second.pending).toHaveLength(10);
    expect(second.pending!.some((id) => rarityOf(id) === 3)).toBe(true);
    // 引いただけではまだ自分のものにならない。
    expect(collections.owned(userId)).toHaveLength(STARTER_CHARACTER_IDS.length);

    const done = collections.confirmFirstGacha(userId);
    expect(done.confirmed).toBe(true);
    const owned = collections.owned(userId);
    for (const id of second.pending!) expect(owned).toContain(id);
    expect(() => collections.rollFirstGacha(userId)).toThrow(GachaError);
    expect(() => collections.confirmFirstGacha(userId)).toThrow(GachaError);

    // 重なったキャラは数が増える（行は1つのまま）。記録も1件残る。
    const copies = db.prepare("SELECT SUM(copies) AS n FROM user_characters WHERE user_id = ?").get(userId) as { n: number };
    expect(copies.n).toBe(STARTER_CHARACTER_IDS.length + 10);
    const logs = db.prepare("SELECT COUNT(*) AS n FROM gacha_log WHERE user_id = ?").get(userId) as { n: number };
    expect(logs.n).toBe(1);
  });

  it("refuses rerolls that come too fast", () => {
    const db = openDatabase(":memory:");
    const { profile } = new AccountService(db).createGuest("A");
    const collections = new CollectionService(db, Math.random, () => 5000); // 時刻が進まない
    collections.rollFirstGacha(profile.id);
    expect(() => collections.rollFirstGacha(profile.id)).toThrow(GachaError);
  });

  it("only lets players use characters they own", () => {
    const { collections, userId } = setup();
    expect(collections.resolveCharacter(userId, "nagi")).toBe("nagi");
    for (let i = 0; i < 20; i++) {
      expect(STARTER_CHARACTER_IDS).toContain(collections.resolveCharacter(userId, "zeno"));
      expect(STARTER_CHARACTER_IDS).toContain(collections.resolveCharacter(userId, null));
    }
  });
});
