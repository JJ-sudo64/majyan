/**
 * 所持キャラと、最初の10連（何度でも引き直せて、確定するとキャラがもらえる）。
 * 抽選の確率・レア度はcoreのgacha.ts。抽選は必ずサーバーで行う。
 */
import {
  CHARACTER_IDS,
  FIRST_GACHA,
  rollGacha,
  STARTER_CHARACTER_IDS,
  type FirstGachaState,
} from "@majyan/core";
import { transaction, type Database } from "./db.js";

/** 最初の10連を引き直せる間隔（連打でサーバーに負担をかけないように）。 */
const FIRST_GACHA_ROLL_INTERVAL_MS = 300;

export class GachaError extends Error {}

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
      this.grant(userId, state.pending, "first-gacha");
      const now = this.now();
      this.db.prepare("UPDATE first_gacha SET confirmed_at = ? WHERE user_id = ?").run(now, userId);
      this.db
        .prepare("INSERT INTO gacha_log (user_id, kind, results_json, created_at) VALUES (?, 'first-gacha', ?, ?)")
        .run(userId, JSON.stringify(state.pending), now);
    });
    return this.firstGachaState(userId);
  }

  /** キャラを渡す（持っていれば重なった数を増やす）。 */
  private grant(userId: string, characterIds: string[], source: string): void {
    this.ensureStarters(userId);
    const now = this.now();
    const upsert = this.db.prepare(
      `INSERT INTO user_characters (user_id, character_id, copies, source, acquired_at) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(user_id, character_id) DO UPDATE SET copies = user_characters.copies + 1`,
    );
    for (const id of characterIds) upsert.run(userId, id, source, now);
  }
}
