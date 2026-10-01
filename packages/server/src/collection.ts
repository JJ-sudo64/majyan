/**
 * 所持キャラと、最初の10連（何度でも引き直せて、確定するとキャラがもらえる）、
 * 雀玉で引く通常のガチャ、天井（交換ポイントで★3を選んでもらう）、凸（重なった数）。
 * 抽選の確率・レア度はcoreのgacha.ts。抽選は必ずサーバーで行う。
 */
import {
  CHARACTER_IDS,
  FIRST_GACHA,
  GACHA_PRICE,
  rollGacha,
  TEN_PULL_GUARANTEED_RARITY,
  STARTER_CHARACTER_IDS,
  EXCHANGE_COST,
  EXCHANGE_POINTS_PER_PULL,
  EXCHANGE_RARITY,
  gaugeBonusForCopies,
  MAX_LIMIT_BREAK,
  OVERFLOW_JADE,
  rarityOf,
  type FirstGachaState,
} from "@majyan/core";
import { transaction, type Database } from "./db.js";
import type { WalletService } from "./wallet.js";

/** 最初の10連を引き直せる間隔（連打でサーバーに負担をかけないように）。 */
const FIRST_GACHA_ROLL_INTERVAL_MS = 300;

export class GachaError extends Error {}

export interface GachaOutcome {
  results: string[];
  /** 今回初めて手に入れたキャラ。 */
  newCharacterIds: string[];
  /** 凸の上限を超えて雀玉に変わった数。 */
  overflowJade: number;
}

interface FirstGachaRow {
  pending_json: string | null;
  rolls: number;
  confirmed_at: number | null;
}

export class CollectionService {
  private readonly lastRollAt = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly rng: () => number = Math.random,
    private readonly now: () => number = Date.now,
    /** 凸の上限を超えた分の雀玉を渡す先。無ければ雀玉に変えない（テスト用）。 */
    private readonly wallet?: WalletService,
  ) {}

  /** 初期キャラを持たせる（何度呼んでもよい）。 */
  private ensureStarters(userId: string): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO user_characters (user_id, character_id, copies, source, acquired_at) VALUES (?, ?, 1, 'starter', ?)",
    );
    for (const id of STARTER_CHARACTER_IDS) insert.run(userId, id, this.now());
  }

  /** 持っているキャラのID（ゲームから外れたキャラは除く）。 */
  owned(userId: string): string[] {
    this.ensureStarters(userId);
    const rows = this.db.prepare("SELECT character_id FROM user_characters WHERE user_id = ? ORDER BY acquired_at, character_id").all(userId) as {
      character_id: string;
    }[];
    return rows.map((r) => r.character_id).filter((id) => CHARACTER_IDS.includes(id));
  }

  /** 対局で使うキャラ。選んだキャラを持っていればそれ、無ければ（おまかせ含む）持っている中からランダム。 */
  resolveCharacter(userId: string, requested: string | null): string {
    const owned = this.owned(userId);
    if (requested && owned.includes(requested)) return requested;
    return owned[Math.floor(this.rng() * owned.length)]!;
  }

  firstGachaState(userId: string): FirstGachaState {
    const row = this.db.prepare("SELECT pending_json, rolls, confirmed_at FROM first_gacha WHERE user_id = ?").get(userId) as
      | FirstGachaRow
      | undefined;
    if (!row) return { confirmed: false, pending: null, rolls: 0 };
    return {
      confirmed: row.confirmed_at !== null,
      pending: row.pending_json ? (JSON.parse(row.pending_json) as string[]) : null,
      rolls: row.rolls,
    };
  }

  /** 最初の10連を引く（引き直し）。確定済みならGachaError。 */
  rollFirstGacha(userId: string): FirstGachaState {
    const now = this.now();
    const last = this.lastRollAt.get(userId);
    if (last !== undefined && now - last < FIRST_GACHA_ROLL_INTERVAL_MS) throw new GachaError("少し待ってから引き直してください");
    const state = this.firstGachaState(userId);
    if (state.confirmed) throw new GachaError("最初の10連はもう受け取っています");
    this.lastRollAt.set(userId, now);
    const results = rollGacha(this.rng, FIRST_GACHA.count, FIRST_GACHA.guaranteedRarity);
    this.db
      .prepare(
        `INSERT INTO first_gacha (user_id, pending_json, rolls, confirmed_at) VALUES (?, ?, 1, NULL)
         ON CONFLICT(user_id) DO UPDATE SET pending_json = excluded.pending_json, rolls = first_gacha.rolls + 1`,
      )
      .run(userId, JSON.stringify(results));
    return this.firstGachaState(userId);
  }

  /** 今の結果で確定し、出たキャラを受け取る。 */
  confirmFirstGacha(userId: string): FirstGachaState {
    transaction(this.db, () => {
      const state = this.firstGachaState(userId);
      if (state.confirmed) throw new GachaError("最初の10連はもう受け取っています");
      if (!state.pending) throw new GachaError("まだ10連を引いていません");
      this.grant(userId, state.pending, "first-gacha", this.wallet);
      const now = this.now();
      this.db.prepare("UPDATE first_gacha SET confirmed_at = ? WHERE user_id = ?").run(now, userId);
      this.db
        .prepare("INSERT INTO gacha_log (user_id, kind, results_json, created_at) VALUES (?, 'first-gacha', ?, ?)")
        .run(userId, JSON.stringify(state.pending), now);
    });
    return this.firstGachaState(userId);
  }

  /** 持っているキャラごとの数（1なら0凸）。 */
  copies(userId: string): Record<string, number> {
    this.ensureStarters(userId);
    const rows = this.db.prepare("SELECT character_id, copies FROM user_characters WHERE user_id = ?").all(userId) as {
      character_id: string;
      copies: number;
    }[];
    return Object.fromEntries(rows.filter((r) => CHARACTER_IDS.includes(r.character_id)).map((r) => [r.character_id, r.copies]));
  }

  /** 対局でそのキャラを使う時の必殺技ゲージの上乗せ（凸ぶん）。持っていなければ0。 */
  gaugeBonus(userId: string, characterId: string): number {
    return gaugeBonusForCopies(this.copies(userId)[characterId] ?? 1);
  }

  exchangePoints(userId: string): number {
    const row = this.db.prepare("SELECT points FROM gacha_points WHERE user_id = ?").get(userId) as { points: number } | undefined;
    return row?.points ?? 0;
  }

  private addExchangePoints(userId: string, delta: number): void {
    // 減らす時は行が必ずあるのでUPDATEだけ（upsertにすると、INSERT側の負の値が
    // CHECK制約に引っかかる）。
    if (delta < 0) {
      this.db.prepare("UPDATE gacha_points SET points = points + ? WHERE user_id = ?").run(delta, userId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO gacha_points (user_id, points) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET points = gacha_points.points + excluded.points`,
      )
      .run(userId, delta);
  }

  /**
   * 雀玉を払って通常のガチャを引く（1回または10連。10連は★2以上が1人確定）。
   * 雀玉を減らす・キャラを渡す・交換ポイントを足す・記録を残すを1つにまとめ、
   * 途中で失敗したら何も起きない。雀玉が足りなければInsufficientJadeError。
   */
  rollGacha(userId: string, count: 1 | 10, wallet: WalletService | undefined = this.wallet): GachaOutcome {
    if (!wallet) throw new Error("雀玉が使えません");
    return transaction(this.db, () => {
      const price = count === 10 ? GACHA_PRICE.ten : GACHA_PRICE.single;
      wallet.spend(userId, price, `gacha-${count}`);
      const before = new Set(this.owned(userId));
      const results = rollGacha(this.rng, count, count === 10 ? TEN_PULL_GUARANTEED_RARITY : undefined);
      const overflowJade = this.grant(userId, results, "gacha", wallet);
      this.addExchangePoints(userId, count * EXCHANGE_POINTS_PER_PULL);
      this.db
        .prepare("INSERT INTO gacha_log (user_id, kind, results_json, created_at) VALUES (?, ?, ?, ?)")
        .run(userId, `gacha-${count}`, JSON.stringify(results), this.now());
      const newCharacterIds = [...new Set(results.filter((id) => !before.has(id)))];
      return { results, newCharacterIds, overflowJade };
    });
  }

  /** 交換ポイントで★3のキャラを1人もらう（天井）。足りない・★3でなければGachaError。 */
  exchange(userId: string, characterId: string, wallet: WalletService | undefined = this.wallet): GachaOutcome {
    if (!CHARACTER_IDS.includes(characterId) || rarityOf(characterId) !== EXCHANGE_RARITY) {
      throw new GachaError("交換できるのは★3のキャラだけです");
    }
    return transaction(this.db, () => {
      if (this.exchangePoints(userId) < EXCHANGE_COST) throw new GachaError("交換ポイントが足りません");
      const isNew = !this.owned(userId).includes(characterId);
      this.addExchangePoints(userId, -EXCHANGE_COST);
      const overflowJade = this.grant(userId, [characterId], "exchange", wallet);
      this.db
        .prepare("INSERT INTO gacha_log (user_id, kind, results_json, created_at) VALUES (?, 'exchange', ?, ?)")
        .run(userId, JSON.stringify([characterId]), this.now());
      return { results: [characterId], newCharacterIds: isNew ? [characterId] : [], overflowJade };
    });
  }

  /**
   * キャラを渡す。持っていれば凸（重なった数）を増やし、凸が上限なら代わりに
   * 雀玉を渡す（walletが無ければ何もしない）。渡した雀玉の合計を返す。
   */
  private grant(userId: string, characterIds: string[], source: string, wallet?: WalletService): number {
    this.ensureStarters(userId);
    const now = this.now();
    const maxCopies = MAX_LIMIT_BREAK + 1;
    let overflow = 0;
    for (const id of characterIds) {
      const row = this.db.prepare("SELECT copies FROM user_characters WHERE user_id = ? AND character_id = ?").get(userId, id) as
        | { copies: number }
        | undefined;
      if (!row) {
        this.db
          .prepare("INSERT INTO user_characters (user_id, character_id, copies, source, acquired_at) VALUES (?, ?, 1, ?, ?)")
          .run(userId, id, source, now);
      } else if (row.copies < maxCopies) {
        this.db.prepare("UPDATE user_characters SET copies = copies + 1 WHERE user_id = ? AND character_id = ?").run(userId, id);
      } else {
        overflow += OVERFLOW_JADE[rarityOf(id)];
      }
    }
    if (overflow > 0 && wallet) wallet.grantFree(userId, overflow, "limit-break-overflow", source);
    return wallet ? overflow : 0;
  }
}
