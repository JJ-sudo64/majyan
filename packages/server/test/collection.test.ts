import { describe, expect, it } from "vitest";
import { CARD_IDS, EXCHANGE_COST, gachaPool, rarityOf, STARTER_CHARACTER_IDS } from "@majyan/core";
import { AccountService } from "../src/accounts.js";
import { CollectionService, GachaError } from "../src/collection.js";
import { openDatabase } from "../src/db.js";
import { WalletService } from "../src/wallet.js";

function setup() {
  const db = openDatabase(":memory:");
  let t = 1_000_000;
  const now = () => (t += 1000); // 呼ぶたびに1秒進む（引き直しの間隔制限に引っかからないように）
  const accounts = new AccountService(db, now);
  const wallet = new WalletService(db, now);
  const collections = new CollectionService(db, Math.random, now, wallet);
  const { profile } = accounts.createGuest("A");
  /** テスト用にカードを直接持たせる。 */
  const giveCard = (cardId: string, count = 1) =>
    db
      .prepare("INSERT INTO user_cards (user_id, card_id, count) VALUES (?, ?, ?) ON CONFLICT(user_id, card_id) DO UPDATE SET count = count + excluded.count")
      .run(profile.id, cardId, count);
  const setPoints = (points: number) =>
    db.prepare("INSERT INTO gacha_points (user_id, points) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET points = excluded.points").run(profile.id, points);
  return { db, collections, wallet, userId: profile.id, giveCard, setPoints };
}

describe("units and cards", () => {
  it("gives the starter characters (without cards) to every account, once", () => {
    const { collections, userId } = setup();
    const units = collections.units(userId);
    expect(units.map((u) => u.characterId).sort()).toEqual([...STARTER_CHARACTER_IDS].sort());
    expect(units.every((u) => u.cardId === null)).toBe(true);
    expect(collections.units(userId)).toEqual(units);
    expect(collections.cards(userId)).toEqual({});
  });

  it("keeps duplicate characters as separate units", () => {
    const { collections, userId, setPoints } = setup();
    const star3 = gachaPool(3, "character")[0]!;
    setPoints(EXCHANGE_COST * 2);
    collections.exchange(userId, star3);
    collections.exchange(userId, star3);
    const same = collections.units(userId).filter((u) => u.characterId === star3.id);
    expect(same).toHaveLength(2);
    expect(same[0]!.unitId).not.toBe(same[1]!.unitId);
  });

  it("equips a card permanently, using one from the inventory", () => {
    const { collections, userId, giveCard } = setup();
    const cardId = CARD_IDS[0]!;
    giveCard(cardId, 2);
    const [first, second] = collections.units(userId);
    collections.equipCard(userId, first!.unitId, cardId);
    expect(collections.units(userId).find((u) => u.unitId === first!.unitId)?.cardId).toBe(cardId);
    expect(collections.cards(userId)[cardId]).toBe(1);
    // 付けたカードは外せない（上書きもできない）。
    expect(() => collections.equipCard(userId, first!.unitId, cardId)).toThrow(GachaError);
    // 同じカードをもう1体に付けられる。使い切ったら付けられない。
    collections.equipCard(userId, second!.unitId, cardId);
    expect(collections.cards(userId)[cardId]).toBeUndefined();
    const third = collections.units(userId)[2]!;
    expect(() => collections.equipCard(userId, third.unitId, cardId)).toThrow(GachaError);
  });

  it("does not let a player equip someone else's unit", () => {
    const { db, collections, userId, giveCard } = setup();
    const other = new AccountService(db).createGuest("B").profile.id;
    const theirUnit = collections.units(other)[0]!;
    giveCard(CARD_IDS[0]!);
    expect(() => collections.equipCard(userId, theirUnit.unitId, CARD_IDS[0]!)).toThrow(GachaError);
    expect(collections.units(other)[0]!.cardId).toBeNull();
  });

  it("puts the chosen unit (with its card) into a match, or a random own unit", () => {
    const { collections, userId, giveCard } = setup();
    const cardId = CARD_IDS[3]!;
    giveCard(cardId);
    const unit = collections.units(userId)[1]!;
    collections.equipCard(userId, unit.unitId, cardId);
    expect(collections.resolveUnit(userId, unit.unitId)).toEqual({ characterId: unit.characterId, cardId });
    for (let i = 0; i < 20; i++) {
      const picked = collections.resolveUnit(userId, "not-my-unit");
      expect(STARTER_CHARACTER_IDS).toContain(picked.characterId);
    }
  });
});

describe("first 10-pull", () => {
  it("can be rerolled until confirmed, then grants characters and cards once", () => {
    const { db, collections, userId } = setup();
    expect(collections.firstGachaState(userId)).toEqual({ confirmed: false, pending: null, rolls: 0 });
    expect(() => collections.confirmFirstGacha(userId)).toThrow(GachaError);

    collections.rollFirstGacha(userId);
    const second = collections.rollFirstGacha(userId);
    expect(second.rolls).toBe(2);
    expect(second.pending).toHaveLength(10);
    expect(second.pending!.some((i) => i.kind === "character" && rarityOf(i) === 3)).toBe(true);
    // 引いただけではまだ自分のものにならない。
    expect(collections.units(userId)).toHaveLength(STARTER_CHARACTER_IDS.length);

    collections.confirmFirstGacha(userId);
    const chars = second.pending!.filter((i) => i.kind === "character");
    const cards = second.pending!.filter((i) => i.kind === "card");
    expect(collections.units(userId)).toHaveLength(STARTER_CHARACTER_IDS.length + chars.length);
    expect(Object.values(collections.cards(userId)).reduce((a, b) => a + b, 0)).toBe(cards.length);
    expect(() => collections.rollFirstGacha(userId)).toThrow(GachaError);
    expect(() => collections.confirmFirstGacha(userId)).toThrow(GachaError);
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
});

describe("pity exchange", () => {
  it("earns one exchange point per paid pull", () => {
    const { collections, userId } = setup();
    collections.rollGacha(userId, 10);
    expect(collections.exchangePoints(userId)).toBe(10);
  });

  it("trades points for a chosen ★3 character or card, and only a ★3", () => {
    const { collections, userId, setPoints } = setup();
    const star3Card = gachaPool(3, "card")[0]!;
    const star1Char = gachaPool(1, "character")[0]!;
    expect(() => collections.exchange(userId, star3Card)).toThrow(GachaError); // ポイント不足
    setPoints(EXCHANGE_COST + 5);
    expect(() => collections.exchange(userId, star1Char)).toThrow(GachaError);
    expect(() => collections.exchange(userId, { kind: "card", id: "no-such-card" })).toThrow(GachaError);
    expect(collections.exchange(userId, star3Card)).toEqual({ results: [star3Card], isNew: [true] });
    expect(collections.cards(userId)[star3Card.id]).toBe(1);
    expect(collections.exchangePoints(userId)).toBe(5);
  });

  it("marks only first-time items as new", () => {
    const { collections, userId, setPoints } = setup();
    setPoints(EXCHANGE_COST * 2);
    const card = gachaPool(3, "card")[1]!;
    expect(collections.exchange(userId, card).isNew).toEqual([true]);
    expect(collections.exchange(userId, card).isNew).toEqual([false]);
  });
});

describe("migration to units", () => {
  it("expands old duplicate counts into separate units", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createRequire } = await import("node:module");
    const { MIGRATIONS } = await import("../src/db.js");
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const dir = mkdtempSync(join(tmpdir(), "majyan-migrate-"));
    try {
      const path = join(dir, "old.db");
      // バージョン5までのDBを作り、昔の形（重なった数）でキャラを持たせる。
      const old = new DatabaseSync(path);
      old.exec("CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (5);");
      for (const sql of MIGRATIONS.slice(0, 5)) old.exec(sql);
      old.exec("INSERT INTO users VALUES ('u1', 'A', 0, 0)");
      old.exec(
        "INSERT INTO user_characters VALUES ('u1', 'nagi', 3, 'starter', 1), ('u1', 'hiiragi', 1, 'starter', 1), ('u1', 'zeno', 2, 'gacha', 2)",
      );
      old.close();

      const db = openDatabase(path);
      const units = new CollectionService(db).units("u1");
      expect(units.map((u) => u.characterId).sort()).toEqual(["hiiragi", "nagi", "nagi", "nagi", "zeno", "zeno"]);
      expect(new Set(units.map((u) => u.unitId)).size).toBe(6);
      // 初期キャラは移行済みなので、もう一度は配られない。
      expect(units.filter((u) => u.characterId === "sena")).toHaveLength(0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
