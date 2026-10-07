/**
 * 運営からのお知らせと、プレゼントボックス（補填・配布）。
 *
 * どちらも運営が admin.ts（サーバーのコマンド）から出し、遊ぶ人は画面で読む・受け取るだけ。
 * 全員宛てのプレゼントは既定で「送った時点で既にあったアカウント」だけが受け取れる
 * （お詫びの雀玉を、アカウントを作り直して何度も受け取れないように）。
 */
import { CARDS, CHARACTERS, type AdminAnnouncement, type AdminGift, type Announcement, type GachaItem, type Gift } from "@majyan/core";
import { transaction, type Database } from "./db.js";
import type { CollectionService } from "./collection.js";
import type { WalletService } from "./wallet.js";

export class GiftError extends Error {}

/** 1件のプレゼントで渡せる雀玉の上限（打ち間違いで桁を増やした時の歯止め）。 */
export const GIFT_MAX_JADE = 100_000;
/** 1件のプレゼントに入れられるキャラ・カードの数の上限。 */
export const GIFT_MAX_ITEMS = 20;

export interface NewAnnouncement {
  title: string;
  body: string;
  /** 出し始める時刻。省略なら今。 */
  publishedAt?: number;
  /** 出すのをやめる時刻。省略なら出し続ける。 */
  endsAt?: number | null;
}

export interface NewGift {
  title: string;
  message?: string;
  jade?: number;
  items?: GachaItem[];
  /** 特定の1人宛て。省略なら全員宛て。 */
  targetUserId?: string | null;
  /** 全員宛ての時、送った後に作られたアカウントにも渡すか（記念の配布など）。既定false。 */
  includeNewAccounts?: boolean;
  /** 受け取り期限。nullなら無期限。 */
  expiresAt?: number | null;
}

interface AnnouncementRow {
  id: number;
  title: string;
  body: string;
  published_at: number;
  ends_at: number | null;
}

interface GiftRow {
  id: number;
  title: string;
  message: string;
  jade: number;
  items_json: string;
  target_user_id: string | null;
  eligible_created_before: number | null;
  created_at: number;
  expires_at: number | null;
  cancelled_at: number | null;
}

/** 運営の一覧用（受け取った人数つき）。 */
export type GiftSummary = AdminGift;
export type AnnouncementSummary = AdminAnnouncement;

const toAnnouncement = (r: AnnouncementRow): Announcement => ({ id: r.id, title: r.title, body: r.body, publishedAt: r.published_at });

const toGift = (r: GiftRow): Gift => ({
  id: r.id,
  title: r.title,
  message: r.message,
  jade: r.jade,
  items: JSON.parse(r.items_json) as GachaItem[],
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

/** その人がいま受け取れるプレゼント（受け取り済み・期限切れ・取り消しは除く）。 */
const CLAIMABLE_SQL = `
  SELECT g.* FROM gifts g JOIN users u ON u.id = ?1
  WHERE g.cancelled_at IS NULL
    AND g.created_at <= ?2
    AND (g.expires_at IS NULL OR g.expires_at > ?2)
    AND (g.target_user_id = u.id
         OR (g.target_user_id IS NULL AND (g.eligible_created_before IS NULL OR u.created_at <= g.eligible_created_before)))
    AND NOT EXISTS (SELECT 1 FROM gift_claims c WHERE c.gift_id = g.id AND c.user_id = u.id)`;

export class InboxService {
  constructor(
    private readonly db: Database,
    private readonly collections: CollectionService,
    private readonly wallet: WalletService,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------------------
  // お知らせ

  /** いま出ているお知らせ（新しい順）。 */
  announcements(): Announcement[] {
    const t = this.now();
    const rows = this.db
      .prepare(
        `SELECT * FROM announcements WHERE published_at <= ? AND (ends_at IS NULL OR ends_at > ?)
         ORDER BY published_at DESC, id DESC LIMIT 50`,
      )
      .all(t, t) as unknown as AnnouncementRow[];
    return rows.map(toAnnouncement);
  }

  latestAnnouncementId(): number | null {
    return this.announcements()[0]?.id ?? null;
  }

  postAnnouncement(a: NewAnnouncement): number {
    const title = a.title.trim();
    const body = a.body.trim();
    if (!title || !body) throw new GiftError("お知らせの題と本文を入れてください");
    const t = this.now();
    const result = this.db
      .prepare("INSERT INTO announcements (title, body, published_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(title, body, a.publishedAt ?? t, a.endsAt ?? null, t);
    return Number(result.lastInsertRowid);
  }

  /** お知らせを下げる（記録は残す）。 */
  endAnnouncement(id: number): boolean {
    const t = this.now();
    return this.db.prepare("UPDATE announcements SET ends_at = ? WHERE id = ? AND (ends_at IS NULL OR ends_at > ?)").run(t, id, t).changes > 0;
  }

  /** 運営の一覧用（下げたものも含めて新しい順）。 */
  allAnnouncements(): AnnouncementSummary[] {
    const rows = this.db.prepare("SELECT * FROM announcements ORDER BY id DESC").all() as unknown as AnnouncementRow[];
    return rows.map((r) => ({ ...toAnnouncement(r), endsAt: r.ends_at }));
  }

  // ---------------------------------------------------------------------------
  // プレゼント

  sendGift(g: NewGift): number {
    const title = g.title.trim();
    if (!title) throw new GiftError("プレゼントの題を入れてください");
    const jade = g.jade ?? 0;
    const items = g.items ?? [];
    if (!Number.isInteger(jade) || jade < 0 || jade > GIFT_MAX_JADE) throw new GiftError(`雀玉は0〜${GIFT_MAX_JADE}の整数にしてください`);
    if (items.length > GIFT_MAX_ITEMS) throw new GiftError(`キャラ・カードは${GIFT_MAX_ITEMS}個までです`);
    for (const item of items) {
      const exists = item.kind === "character" ? !!CHARACTERS[item.id] : item.kind === "card" ? !!CARDS[item.id] : false;
      if (!exists) throw new GiftError(`${item.kind === "card" ? "カード" : "キャラ"}「${item.id}」はありません`);
    }
    if (jade === 0 && items.length === 0) throw new GiftError("中身（雀玉・キャラ・カード）がありません");
    const target = g.targetUserId ?? null;
    if (target && !this.db.prepare("SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL").get(target)) throw new GiftError("宛先のアカウントがありません");
    const t = this.now();
    if (g.expiresAt != null && g.expiresAt <= t) throw new GiftError("期限が過去になっています");
    const result = this.db
      .prepare(
        `INSERT INTO gifts (title, message, jade, items_json, target_user_id, eligible_created_before, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(title, (g.message ?? "").trim(), jade, JSON.stringify(items), target, target || g.includeNewAccounts ? null : t, t, g.expiresAt ?? null);
    return Number(result.lastInsertRowid);
  }

  /** 送ったプレゼントを取り消す（まだ受け取っていない人には出なくなる。受け取った分はそのまま）。 */
  cancelGift(id: number): boolean {
    return this.db.prepare("UPDATE gifts SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL").run(this.now(), id).changes > 0;
  }

  /** 受け取れるプレゼント（期限の近い順、無期限は最後）。 */
  claimable(userId: string): Gift[] {
    const rows = this.db
      .prepare(`${CLAIMABLE_SQL} ORDER BY g.expires_at IS NULL, g.expires_at, g.id`)
      .all(userId, this.now()) as unknown as GiftRow[];
    return rows.map(toGift);
  }

  unclaimedCount(userId: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM (${CLAIMABLE_SQL})`).get(userId, this.now()) as { n: number }).n;
  }

  /** プレゼントを受け取る。giftIdがnullなら受け取れるもの全部。受け取った中身の合計を返す。 */
  claim(userId: string, giftId: number | null): { jade: number; items: GachaItem[] } {
    return transaction(this.db, () => {
      const gifts = this.claimable(userId).filter((g) => giftId === null || g.id === giftId);
      if (giftId !== null && gifts.length === 0) throw new GiftError("このプレゼントは受け取れません（受け取り済みか、期限が過ぎています）");
      const t = this.now();
      let jade = 0;
      const items: GachaItem[] = [];
      for (const g of gifts) {
        this.db.prepare("INSERT INTO gift_claims (gift_id, user_id, claimed_at) VALUES (?, ?, ?)").run(g.id, userId, t);
        if (g.jade > 0) this.wallet.grantFree(userId, g.jade, "gift", String(g.id));
        if (g.items.length) this.collections.grantItems(userId, g.items, `gift:${g.id}`);
        jade += g.jade;
        items.push(...g.items);
      }
      return { jade, items };
    });
  }

  /** 運営の一覧用（新しい順）。 */
  allGifts(): GiftSummary[] {
    const rows = this.db
      .prepare("SELECT g.*, (SELECT COUNT(*) FROM gift_claims c WHERE c.gift_id = g.id) AS claimed FROM gifts g ORDER BY g.id DESC")
      .all() as unknown as (GiftRow & { claimed: number })[];
    return rows.map((r) => ({
      ...toGift(r),
      targetUserId: r.target_user_id,
      includeNewAccounts: !r.target_user_id && r.eligible_created_before === null,
      cancelled: r.cancelled_at !== null,
      claimedCount: r.claimed,
    }));
  }
}
