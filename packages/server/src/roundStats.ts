/**
 * 局ごとの成績（戦績の和了率・放銃率・副露率・立直率・和了グラフの元）の保存と集計。
 * 牌譜を1局書くたびにその局を数えて保存する。牌譜を残し始める前の対局は、起動時に少しずつ
 * 数え直して取り込む（backfill）。
 */
import { gunzipSync } from "node:zlib";
import {
  RANKED_SERIES_LIMIT,
  summarizeRound,
  type MatchFormat,
  type ReplayRound,
  type RoundSeatStats,
  type RoundStatsSummary,
  type WinKinds,
} from "@majyan/core";
import type { Database } from "./db.js";

export const emptyRoundStats = (): RoundStatsSummary => ({
  rounds: 0,
  wins: 0,
  tsumoWins: 0,
  dealtIn: 0,
  riichiRounds: 0,
  openRounds: 0,
  winPointsTotal: 0,
  winTurnTotal: 0,
  maxRenchan: 0,
});

/** 1局を数えて保存する。数えられなければ（記録が途中で切れている等）印だけ残す。 */
export function saveRoundStats(db: Database, matchId: string, roundIndex: number, round: ReplayRound): void {
  let stats: RoundSeatStats[] | null = null;
  try {
    stats = summarizeRound(round);
  } catch {
    stats = null;
  }
  db.prepare("DELETE FROM round_stats WHERE match_id = ? AND round_index = ?").run(matchId, roundIndex);
  const insert = db.prepare(
    `INSERT INTO round_stats (match_id, round_index, seat, dealer, riichi, open, win, tsumo, dealt_in, win_points, win_turn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  if (!stats) {
    insert.run(matchId, roundIndex, -1, 0, 0, 0, 0, 0, 0, 0, 0);
    return;
  }
  for (const s of stats) {
    insert.run(matchId, roundIndex, s.seat, +s.dealer, +s.riichi, +s.open, +s.win, +s.tsumo, +s.dealtIn, s.winPoints, s.winTurn);
  }
}

/** まだ数えていない牌譜の局をlimit局ぶん数える。数えた局数を返す（0なら全部済み）。 */
export function backfillRoundStats(db: Database, limit = 40): number {
  const rows = db
    .prepare(
      `SELECT p.match_id AS match_id, p.round_index AS round_index, p.data AS data FROM match_replays p
       WHERE NOT EXISTS (SELECT 1 FROM round_stats s WHERE s.match_id = p.match_id AND s.round_index = p.round_index)
       LIMIT ?`,
    )
    .all(limit) as { match_id: string; round_index: number; data: Uint8Array }[];
  for (const row of rows) {
    let round: ReplayRound | null = null;
    try {
      round = JSON.parse(gunzipSync(row.data).toString("utf8")) as ReplayRound;
    } catch {
      round = null;
    }
    if (round) saveRoundStats(db, row.match_id, row.round_index, round);
    else db.prepare("INSERT INTO round_stats (match_id, round_index, seat, dealer, riichi, open, win, tsumo, dealt_in, win_points, win_turn) VALUES (?, ?, -1, 0, 0, 0, 0, 0, 0, 0, 0)").run(row.match_id, row.round_index);
  }
  return rows.length;
}

/** 起動後に、数えていない牌譜を少しずつ数える（サーバーを止めないよう、間を空けて少しずつ）。 */
export function startRoundStatsBackfill(db: Database, onError: (err: unknown) => void = () => {}): void {
  const step = () => {
    try {
      if (backfillRoundStats(db) > 0) setTimeout(step, 50).unref?.();
    } catch (err) {
      onError(err);
    }
  };
  setTimeout(step, 1000).unref?.();
}

/** その人の、東風戦・半荘戦ごとの局の成績の合計と、和了の種類の内訳（直近の対局）。 */
export function loadRoundStats(db: Database, userId: string): { roundStats: Record<MatchFormat, RoundStatsSummary>; winKinds: WinKinds } {
  const roundStats: Record<MatchFormat, RoundStatsSummary> = { tonpuusen: emptyRoundStats(), hanchan: emptyRoundStats() };
  const sums = db
    .prepare(
      `SELECT m.format AS format, COUNT(*) AS rounds, SUM(s.win) AS wins, SUM(s.tsumo) AS tsumo_wins, SUM(s.dealt_in) AS dealt_in,
              SUM(s.riichi) AS riichi_rounds, SUM(s.open) AS open_rounds, SUM(s.win_points) AS win_points, SUM(s.win_turn) AS win_turn
       FROM round_stats s
       JOIN ranked_results r ON r.match_id = s.match_id AND r.seat = s.seat AND r.user_id = ?
       JOIN ranked_matches m ON m.id = s.match_id
       WHERE s.seat >= 0 GROUP BY m.format`,
    )
    .all(userId) as {
    format: MatchFormat;
    rounds: number;
    wins: number;
    tsumo_wins: number;
    dealt_in: number;
    riichi_rounds: number;
    open_rounds: number;
    win_points: number;
    win_turn: number;
  }[];
  for (const r of sums) {
    const target = roundStats[r.format];
    if (!target) continue;
    target.rounds = r.rounds;
    target.wins = r.wins;
    target.tsumoWins = r.tsumo_wins;
    target.dealtIn = r.dealt_in;
    target.riichiRounds = r.riichi_rounds;
    target.openRounds = r.open_rounds;
    target.winPointsTotal = r.win_points;
    target.winTurnTotal = r.win_turn;
  }
  // 連荘: 同じ対局で、親の局が途切れずに続いた回数の最大。
  const dealerRows = db
    .prepare(
      `SELECT m.format AS format, s.match_id AS match_id, s.round_index AS round_index, s.dealer AS dealer
       FROM round_stats s
       JOIN ranked_results r ON r.match_id = s.match_id AND r.seat = s.seat AND r.user_id = ?
       JOIN ranked_matches m ON m.id = s.match_id
       WHERE s.seat >= 0 ORDER BY s.match_id, s.round_index`,
    )
    .all(userId) as { format: MatchFormat; match_id: string; round_index: number; dealer: number }[];
  let run = 0;
  let prevMatch = "";
  for (const row of dealerRows) {
    if (row.match_id !== prevMatch) run = 0;
    prevMatch = row.match_id;
    run = row.dealer ? run + 1 : 0;
    const target = roundStats[row.format];
    if (target && run > target.maxRenchan) target.maxRenchan = run;
  }
  const kinds = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN s.riichi = 1 THEN 1 ELSE 0 END), 0) AS riichi,
              COALESCE(SUM(CASE WHEN s.riichi = 0 AND s.open = 1 THEN 1 ELSE 0 END), 0) AS open,
              COALESCE(SUM(CASE WHEN s.riichi = 0 AND s.open = 0 THEN 1 ELSE 0 END), 0) AS dama
       FROM round_stats s
       JOIN (SELECT r.match_id AS match_id, r.seat AS seat FROM ranked_results r JOIN ranked_matches m ON m.id = r.match_id
             WHERE r.user_id = ? ORDER BY m.finished_at DESC, m.rowid DESC LIMIT ?) recent
         ON recent.match_id = s.match_id AND recent.seat = s.seat
       WHERE s.seat >= 0 AND s.win = 1`,
    )
    .get(userId, RANKED_SERIES_LIMIT) as { riichi: number; open: number; dama: number };
  return { roundStats, winKinds: { riichi: kinds.riichi, open: kinds.open, dama: kinds.dama } };
}
