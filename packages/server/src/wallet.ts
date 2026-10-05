/**
 * 雀玉（ゲーム内通貨）。
 *
 * 有償（購入した分）と無償（報酬・ログインボーナス等）は別々に持つ。有償の
 * ゲーム内通貨は資金決済法の「前払式支払手段」にあたり、残高の管理・報告が
 * 必要になるため（課金を付ける前から分けておく）。使う時は無償分から先に減らす。
 * 増減はすべて jade_ledger に残す（問い合わせ対応・不正の調査用）。
 */
import {
  DAILY_LOGIN_JADE,
  jstDate,
  rankedJadeReward,
  RANKED_JADE_DAILY_CAP,
  STARTING_JADE,
  type JadeBalance,
  type MatchFormat,
} from "@majyan/core";
import { transaction, type Database } from "./db.js";

export class InsufficientJadeError extends Error {
  constructor() {
    super("雀玉が足りません");
  }
}

interface WalletRow {
  free_jade: number;
  paid_jade: number;
}

export class WalletService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  /** 財布を用意する（初めてなら最初の雀玉を渡す）。 */
  private ensure(userId: string): WalletRow {
    const row = this.db.prepare("SELECT free_jade, paid_jade FROM wallets WHERE user_id = ?").get(userId) as WalletRow | undefined;
    if (row) return row;
    transaction(this.db, () => {
      this.db.prepare("INSERT INTO wallets (user_id, free_jade, paid_jade) VALUES (?, 0, 0)").run(userId);
      this.change(userId, STARTING_JADE, 0, "starting-bonus", null);
    });
    return { free_jade: STARTING_JADE, paid_jade: 0 };
  }

  balance(userId: string): JadeBalance {
    const row = this.ensure(userId);
    return { free: row.free_jade, paid: row.paid_jade };
  }

  /** 残高を変えて記録を残す（呼び出し側でtransactionの中から呼ぶこと）。 */
  private change(userId: string, freeDelta: number, paidDelta: number, reason: string, ref: string | null): JadeBalance {
    this.db
      .prepare("UPDATE wallets SET free_jade = free_jade + ?, paid_jade = paid_jade + ? WHERE user_id = ?")
      .run(freeDelta, paidDelta, userId);
    const after = (this.db.prepare("SELECT free_jade, paid_jade FROM wallets WHERE user_id = ?").get(userId) as WalletRow | undefined)!;
    this.db
      .prepare(
        `INSERT INTO jade_ledger (user_id, free_delta, paid_delta, free_after, paid_after, reason, ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, freeDelta, paidDelta, after.free_jade, after.paid_jade, reason, ref, this.now());
    return { free: after.free_jade, paid: after.paid_jade };
  }

  /** 無償の雀玉を渡す。 */
  grantFree(userId: string, amount: number, reason: string, ref: string | null = null): JadeBalance {
    if (!Number.isInteger(amount) || amount < 0) throw new Error("雀玉の数が正しくありません");
    return transaction(this.db, () => {
      this.ensure(userId);
      return this.change(userId, amount, 0, reason, ref);
    });
  }

  /** 雀玉を使う（無償分から先に減らす）。足りなければInsufficientJadeError。 */
  spend(userId: string, amount: number, reason: string, ref: string | null = null): JadeBalance {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("雀玉の数が正しくありません");
    return transaction(this.db, () => {
      const row = this.ensure(userId);
      if (row.free_jade + row.paid_jade < amount) throw new InsufficientJadeError();
      const fromFree = Math.min(row.free_jade, amount);
      return this.change(userId, -fromFree, -(amount - fromFree), reason, ref);
    });
  }

  /** 今日（日本時間）のログインボーナスをまだ受け取っていなければ渡す。渡した数、または受け取り済みならnull。 */
  claimDailyLogin(userId: string): number | null {
    const date = jstDate(this.now());
    return transaction(this.db, () => {
      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO daily_claims (user_id, kind, date, amount) VALUES (?, 'login', ?, ?)")
        .run(userId, date, DAILY_LOGIN_JADE);
      if (inserted.changes === 0) return null;
      this.grantFree(userId, DAILY_LOGIN_JADE, "daily-login", date);
      return DAILY_LOGIN_JADE;
    });
  }

  /** 段位戦の報酬を渡す（1日の上限まで）。実際に渡した数を返す。 */
  grantRankedReward(userId: string, format: MatchFormat, place: 1 | 2 | 3 | 4, matchId: string): number {
    const date = jstDate(this.now());
    return transaction(this.db, () => {
      // 同じ対局の報酬は1回だけ（再起動で対局を戻した時、終わる直前の局面から
      // やり直して終了の処理がもう一度走ることがあるため）。
      const granted = this.db
        .prepare("SELECT 1 FROM jade_ledger WHERE user_id = ? AND reason = 'ranked-reward' AND ref = ?")
        .get(userId, matchId);
      if (granted) return 0;
      const row = this.db
        .prepare("SELECT amount FROM daily_claims WHERE user_id = ? AND kind = 'ranked' AND date = ?")
        .get(userId, date) as { amount: number } | undefined;
      const already = row?.amount ?? 0;
      const amount = Math.max(0, Math.min(rankedJadeReward(format, place), RANKED_JADE_DAILY_CAP - already));
      if (amount === 0) return 0;
      this.db
        .prepare(
          `INSERT INTO daily_claims (user_id, kind, date, amount) VALUES (?, 'ranked', ?, ?)
           ON CONFLICT(user_id, kind, date) DO UPDATE SET amount = daily_claims.amount + excluded.amount`,
        )
        .run(userId, date, amount);
      this.grantFree(userId, amount, "ranked-reward", matchId);
      return amount;
    });
  }
}
