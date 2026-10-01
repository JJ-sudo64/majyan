/**
 * 手持ちのキャラとカード、ガチャ（最初の10連・雀玉で引く通常のガチャ・天井の交換）。
 *
 * - キャラは同じキャラでも1体ずつ別に持つ（character_units）。どのキャラにも
 *   カードを1枚だけ付けられ、付けたら外せない。何を付けたかで同じキャラでも別物になる
 * - カードは付けるまでは手持ちの枚数（user_cards）として持つ
 * 抽選の確率・レア度はcoreのgacha.ts。抽選は必ずサーバーで行う。
 */
import { randomBytes } from "node:crypto";
import {
  CARD_IDS,
  CHARACTER_IDS,
  EXCHANGE_COST,
  EXCHANGE_POINTS_PER_PULL,
  EXCHANGE_RARITY,
  FIRST_GACHA,
  GACHA_PRICE,
  rarityOf,
  rollGacha,
  STARTER_CHARACTER_IDS,
  TEN_PULL_GUARANTEE,
  type CharacterUnit,
  type FirstGachaState,
  type GachaItem,
} from "@majyan/core";
import { transaction, type Database } from "./db.js";
import type { WalletService } from "./wallet.js";

/** 最初の10連を引き直せる間隔（連打でサーバーに負担をかけないように）。 */
const FIRST_GACHA_ROLL_INTERVAL_MS = 300;

export class GachaError extends Error {}

export interface GachaOutcome {
  results: GachaItem[];
  /** resultsと同じ並びで、初めて手に入れたキャラ・カードか。 */
  isNew: boolean[];
}

interface FirstGachaRow {
  pending_json: string | null;
  rolls: number;
  confirmed_at: number | null;
}

interface UnitRow {
  unit_id: string;
  character_id: string;
  card_id: string | null;
}

const isKnown = (item: GachaItem) => (item.kind === "character" ? CHARACTER_IDS : CARD_IDS).includes(item.id);

/** 以前は最初の10連の結果をキャラIDの配列で保存していたので、その形も読めるようにする。 */
function parsePending(json: string): GachaItem[] {
  const raw = JSON.parse(json) as (GachaItem | string)[];
  return raw.map((x) => (typeof x === "string" ? { kind: "character", id: x } : x));
}

export class CollectionService {
  private readonly lastRollAt = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly rng: () => number = Math.random,
    private readonly now: () => number = Date.now,
    /** 通常のガチャで雀玉を払う先。 */
    private readonly wallet?: WalletService,
  ) {}

  /** 初期キャラを持たせる（まだ渡していなければ）。 */
  private ensureStarters(userId: string): void {
    const has = this.db.prepare("SELECT 1 FROM character_units WHERE user_id = ? AND source = 'starter' LIMIT 1").get(userId);
    if (has) return;
    transaction(this.db, () => {
      for (const id of STARTER_CHARACTER_IDS) this.addUnit(userId, id, "starter");
    });
  }

  private addUnit(userId: string, characterId: string, source: string): string {
    const unitId = randomBytes(12).toString("hex");
    this.db
      .prepare("INSERT INTO character_units (unit_id, user_id, character_id, card_id, source, acquired_at) VALUES (?, ?, ?, NULL, ?, ?)")
      .run(unitId, userId, characterId, source, this.now());
    return unitId;
  }

  /** 手持ちのキャラ（手に入れた順。ゲームから外れたキャラは除く）。 */
  units(userId: string): CharacterUnit[] {
    this.ensureStarters(userId);
    const rows = this.db
      .prepare("SELECT unit_id, character_id, card_id FROM character_units WHERE user_id = ? ORDER BY acquired_at, rowid")
      .all(userId) as unknown as UnitRow[];
    return rows
      .filter((r) => CHARACTER_IDS.includes(r.character_id))
      .map((r) => ({ unitId: r.unit_id, characterId: r.character_id, cardId: r.card_id && CARD_IDS.includes(r.card_id) ? r.card_id : null }));
  }

  /** まだどのキャラにも付けていないカードの枚数。 */
  cards(userId: string): Record<string, number> {
    const rows = this.db.prepare("SELECT card_id, count FROM user_cards WHERE user_id = ? AND count > 0").all(userId) as unknown as {
      card_id: string;
      count: number;
    }[];
    return Object.fromEntries(rows.filter((r) => CARD_IDS.includes(r.card_id)).map((r) => [r.card_id, r.count]));
  }

  /** 持っている（持っていた）ことがあるキャラ・カードか（「NEW」表示用）。付けたカードも含む。 */
  private everOwned(userId: string, item: GachaItem): boolean {
    if (item.kind === "character") {
      return !!this.db.prepare("SELECT 1 FROM character_units WHERE user_id = ? AND character_id = ? LIMIT 1").get(userId, item.id);
    }
    return (
      !!this.db.prepare("SELECT 1 FROM user_cards WHERE user_id = ? AND card_id = ? LIMIT 1").get(userId, item.id) ||
      !!this.db.prepare("SELECT 1 FROM character_units WHERE user_id = ? AND card_id = ? LIMIT 1").get(userId, item.id)
    );
  }

  /**
   * 手持ちのキャラにカードを付ける。一度付けたら外せない。既に付いているキャラ・
   * 持っていないカードならGachaError。
   */
  equipCard(userId: string, unitId: string, cardId: string): void {
    transaction(this.db, () => {
      const unit = this.db.prepare("SELECT card_id FROM character_units WHERE unit_id = ? AND user_id = ?").get(unitId, userId) as
        | { card_id: string | null }
        | undefined;
      if (!unit) throw new GachaError("そのキャラは持っていません");
      if (unit.card_id) throw new GachaError("このキャラにはもうカードが付いています（付けたカードは外せません）");
      const card = this.db.prepare("SELECT count FROM user_cards WHERE user_id = ? AND card_id = ?").get(userId, cardId) as
        | { count: number }
        | undefined;
      if (!card || card.count <= 0) throw new GachaError("そのカードは持っていません");
      this.db.prepare("UPDATE user_cards SET count = count - 1 WHERE user_id = ? AND card_id = ?").run(userId, cardId);
      this.db
        .prepare("UPDATE character_units SET card_id = ?, card_equipped_at = ? WHERE unit_id = ?")
        .run(cardId, this.now(), unitId);
    });
  }

  /**
   * 対局に出すキャラとカード。選んだキャラ（unitId）を持っていればそれ、無ければ
   * （おまかせ含む）手持ちからランダム。
   */
  resolveUnit(userId: string, unitId: string | null): { characterId: string; cardId: string | null } {
    const units = this.units(userId);
    const chosen = (unitId && units.find((u) => u.unitId === unitId)) || units[Math.floor(this.rng() * units.length)]!;
    return { characterId: chosen.characterId, cardId: chosen.cardId };
  }

  // -------------------------------------------------------------------------
  // ガチャ
  // -------------------------------------------------------------------------

  firstGachaState(userId: string): FirstGachaState {
    const row = this.db.prepare("SELECT pending_json, rolls, confirmed_at FROM first_gacha WHERE user_id = ?").get(userId) as
      | FirstGachaRow
      | undefined;
    if (!row) return { confirmed: false, pending: null, rolls: 0 };
    return {
      confirmed: row.confirmed_at !== null,
      pending: row.pending_json ? parsePending(row.pending_json) : null,
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
    const results = rollGacha(this.rng, FIRST_GACHA.count, FIRST_GACHA.guarantee);
    this.db
      .prepare(
        `INSERT INTO first_gacha (user_id, pending_json, rolls, confirmed_at) VALUES (?, ?, 1, NULL)
         ON CONFLICT(user_id) DO UPDATE SET pending_json = excluded.pending_json, rolls = first_gacha.rolls + 1`,
      )
      .run(userId, JSON.stringify(results));
    return this.firstGachaState(userId);
  }

  /** 今の結果で確定し、出たキャラ・カードを受け取る。 */
  confirmFirstGacha(userId: string): FirstGachaState {
    transaction(this.db, () => {
      const state = this.firstGachaState(userId);
      if (state.confirmed) throw new GachaError("最初の10連はもう受け取っています");
      if (!state.pending) throw new GachaError("まだ10連を引いていません");
      this.grant(userId, state.pending, "first-gacha");
      const now = this.now();
      this.db.prepare("UPDATE first_gacha SET confirmed_at = ? WHERE user_id = ?").run(now, userId);
      this.log(userId, "first-gacha", state.pending);
    });
    return this.firstGachaState(userId);
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
   * 雀玉を払って通常のガチャを引く（1回または10連。10連は★2以上が1つ確定）。
   * 雀玉を減らす・キャラとカードを渡す・交換ポイントを足す・記録を残すを1つにまとめ、
   * 途中で失敗したら何も起きない。雀玉が足りなければInsufficientJadeError。
   */
  rollGacha(userId: string, count: 1 | 10, wallet: WalletService | undefined = this.wallet): GachaOutcome {
    if (!wallet) throw new Error("雀玉が使えません");
    return transaction(this.db, () => {
      wallet.spend(userId, count === 10 ? GACHA_PRICE.ten : GACHA_PRICE.single, `gacha-${count}`);
      const results = rollGacha(this.rng, count, count === 10 ? TEN_PULL_GUARANTEE : undefined);
      const isNew = this.grant(userId, results, "gacha");
      this.addExchangePoints(userId, count * EXCHANGE_POINTS_PER_PULL);
      this.log(userId, `gacha-${count}`, results);
      return { results, isNew };
    });
  }

  /** 交換ポイントで★3のキャラかカードを1つもらう（天井）。足りない・★3でなければGachaError。 */
  exchange(userId: string, item: GachaItem): GachaOutcome {
    if ((item.kind !== "character" && item.kind !== "card") || !isKnown(item) || rarityOf(item) !== EXCHANGE_RARITY) {
      throw new GachaError(`交換できるのは★${EXCHANGE_RARITY}のキャラかカードだけです`);
    }
    return transaction(this.db, () => {
      if (this.exchangePoints(userId) < EXCHANGE_COST) throw new GachaError("交換ポイントが足りません");
      this.addExchangePoints(userId, -EXCHANGE_COST);
      const results: GachaItem[] = [{ kind: item.kind, id: item.id }];
      const isNew = this.grant(userId, results, "exchange");
      this.log(userId, "exchange", results);
      return { results, isNew };
    });
  }

  /** キャラ（1体ずつ別）・カード（手持ちの枚数）を渡す。それぞれ初めて手に入れたものかを返す。 */
  private grant(userId: string, items: GachaItem[], source: string): boolean[] {
    this.ensureStarters(userId);
    const isNew: boolean[] = [];
    for (const item of items) {
      isNew.push(!this.everOwned(userId, item));
      if (item.kind === "character") {
        this.addUnit(userId, item.id, source);
      } else {
        this.db
          .prepare(
            `INSERT INTO user_cards (user_id, card_id, count) VALUES (?, ?, 1)
             ON CONFLICT(user_id, card_id) DO UPDATE SET count = user_cards.count + 1`,
          )
          .run(userId, item.id);
      }
    }
    return isNew;
  }

  private log(userId: string, kind: string, results: GachaItem[]): void {
    this.db
      .prepare("INSERT INTO gacha_log (user_id, kind, results_json, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, kind, JSON.stringify(results), this.now());
  }
}
