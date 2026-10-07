import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { AccountService } from "../src/accounts.js";
import { CollectionService } from "../src/collection.js";
import { WalletService } from "../src/wallet.js";
import { GiftError, InboxService } from "../src/inbox.js";
import { endOfJstDay, resolveUserId, runAdmin } from "../src/admin.js";

const DAY = 24 * 60 * 60_000;

function setup() {
  let t = 1_000_000;
  const now = () => t;
  const db = openDatabase(":memory:");
  const accounts = new AccountService(db, now);
  const wallet = new WalletService(db, now);
  const collections = new CollectionService(db, Math.random, now, wallet);
  const inbox = new InboxService(db, collections, wallet, now);
  return { db, accounts, wallet, collections, inbox, now, advance: (ms: number) => (t += ms) };
}

describe("announcements", () => {
  it("shows only announcements that are live, newest first", () => {
    const { inbox, advance } = setup();
    const a = inbox.postAnnouncement({ title: "メンテ", body: "10/8 に行います" });
    advance(1000);
    const b = inbox.postAnnouncement({ title: "新キャラ", body: "マサト登場", endsAt: 1_000_000 + 5000 });
    inbox.postAnnouncement({ title: "予告", body: "まだ", publishedAt: 1_000_000 + 10 * DAY });
    expect(inbox.announcements().map((x) => x.id)).toEqual([b, a]);
    expect(inbox.latestAnnouncementId()).toBe(b);
    advance(5000);
    expect(inbox.announcements().map((x) => x.id)).toEqual([a]);
    expect(inbox.endAnnouncement(a)).toBe(true);
    expect(inbox.latestAnnouncementId()).toBeNull();
    expect(() => inbox.postAnnouncement({ title: " ", body: "x" })).toThrow(GiftError);
  });
});

describe("gifts", () => {
  it("gives an all-players gift only to accounts that existed when it was sent, once each", () => {
    const { accounts, inbox, wallet, collections, advance } = setup();
    const old = accounts.createGuest("古参").profile;
    const startJade = wallet.balance(old.id).free;
    advance(1000);
    const id = inbox.sendGift({ title: "お詫び", message: "障害のお詫びです", jade: 300, items: [{ kind: "character", id: "masato" }] });
    advance(1000);
    const newcomer = accounts.createGuest("新人").profile;

    expect(inbox.unclaimedCount(old.id)).toBe(1);
    expect(inbox.unclaimedCount(newcomer.id)).toBe(0);
    expect(inbox.claim(old.id, id)).toEqual({ jade: 300, items: [{ kind: "character", id: "masato" }] });
    expect(wallet.balance(old.id).free).toBe(startJade + 300);
    expect(collections.units(old.id).map((u) => u.characterId)).toEqual(["masato"]);
    // 2回目は受け取れない。
    expect(() => inbox.claim(old.id, id)).toThrow(GiftError);
    expect(inbox.claim(old.id, null)).toEqual({ jade: 0, items: [] });
    expect(inbox.unclaimedCount(old.id)).toBe(0);
  });

  it("can include new accounts, target one person, expire, and be cancelled", () => {
    const { accounts, inbox, advance } = setup();
    const a = accounts.createGuest("A").profile;
    const b = accounts.createGuest("B").profile;
    advance(1000);
    const forAll = inbox.sendGift({ title: "記念", jade: 100, includeNewAccounts: true, expiresAt: 1_000_000 + 2 * DAY });
    const forA = inbox.sendGift({ title: "個別", jade: 50, targetUserId: a.id });
    const cancelled = inbox.sendGift({ title: "誤送信", jade: 99999 });
    expect(inbox.cancelGift(cancelled)).toBe(true);
    advance(1000);
    const c = accounts.createGuest("C").profile;

    expect(inbox.claimable(a.id).map((g) => g.id)).toEqual([forAll, forA]);
    expect(inbox.claimable(b.id).map((g) => g.id)).toEqual([forAll]);
    expect(inbox.claimable(c.id).map((g) => g.id)).toEqual([forAll]);
    expect(inbox.claim(a.id, null).jade).toBe(150);

    advance(2 * DAY);
    expect(inbox.claimable(b.id)).toEqual([]);
    expect(inbox.allGifts().find((g) => g.id === forAll)?.claimedCount).toBe(1);
  });

  it("rejects gifts with nothing in them, unknown items or a typo-sized amount", () => {
    const { inbox } = setup();
    expect(() => inbox.sendGift({ title: "空" })).toThrow(GiftError);
    expect(() => inbox.sendGift({ title: "x", items: [{ kind: "card", id: "no-such-card" }] })).toThrow(GiftError);
    expect(() => inbox.sendGift({ title: "x", jade: 1_000_000 })).toThrow(GiftError);
    expect(() => inbox.sendGift({ title: "x", jade: 1, targetUserId: "nobody" })).toThrow(GiftError);
  });
});

describe("admin command", () => {
  it("posts news and sends gifts from the command line", () => {
    const { db, accounts, inbox, now } = setup();
    const a = accounts.createGuest("テスト").profile;
    expect(runAdmin(db, ["news", "add", "--title", "お知らせ", "--body", "1行目\n2行目"], now)[0]).toMatch(/#1/);
    expect(inbox.announcements()[0]!.body).toBe("1行目\n2行目");
    runAdmin(db, ["gift", "send", "--title", "個別", "--jade", "10", "--card", "point-drain", "--to", a.id.slice(0, 8)], now);
    const [gift] = inbox.claimable(a.id);
    expect(gift).toMatchObject({ jade: 10, items: [{ kind: "card", id: "point-drain" }], expiresAt: now() + 30 * DAY });
    expect(runAdmin(db, ["gift", "list"], now)[0]).toMatch(/個別.*受け取り0人/);
    expect(runAdmin(db, ["user", "find", "テス"], now)[0]).toContain(a.id);
    expect(() => runAdmin(db, ["gift", "send", "--title", "x", "--jade", "1", "--to", "abc"], now)).toThrow(/8文字以上/);
    expect(() => resolveUserId(db, "ffffffff")).toThrow(/見つかりません/);
    expect(endOfJstDay("2026-10-31")).toBe(Date.parse("2026-11-01T00:00:00+09:00"));
  });
});
