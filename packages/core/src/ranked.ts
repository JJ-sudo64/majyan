/**
 * 段位戦の段位とポイント計算（数値はここに集めてあるので、調整はこのファイルだけで済む）。
 *
 * 段位: 下雀 → 中雀 → 上雀 → 雀王 → 雀帝（それぞれ1〜3段）→ 雀神（段なし、ポイントを積み上げる）
 * 1局（1試合）ごとのポイント増減 = 順位による増減 ＋ 終局時の持ち点による増減
 *   （(持ち点 − 25000) / 1000、1点未満は四捨五入）。東風戦は順位による増減が半荘戦の約半分。
 * ポイントが段の上限に届くと昇段（次の段の開始ポイントから）、0を下回ると降段
 * （1つ下の段の開始ポイントから）。下雀・中雀は降段しない（ポイントは0で止まる）。
 */
import type { MatchFormat } from "./gameState.js";

export interface RankTier {
  id: string;
  name: string;
  /** 段ごとの、昇段に必要なポイント（上限）。雀神は上限なし（空配列）。 */
  levelMax: number[];
  /** 段ごとの、その段に上がった/落ちた時の開始ポイント。 */
  levelStart: number[];
  /** 降段するか（false の段位では、ポイントが0未満になっても0で止まる）。 */
  canDemote: boolean;
  /** 半荘戦の順位による増減（1位〜3位）。 */
  placementHanchan: [number, number, number];
  /** 半荘戦の4位の減点（段ごと）。上の段ほど重い。 */
  fourthHanchan: number[];
}

export const RANK_TIERS: RankTier[] = [
  {
    id: "gejan",
    name: "下雀",
    levelMax: [20, 80, 200],
    levelStart: [0, 0, 0],
    canDemote: false,
    placementHanchan: [30, 10, 0],
    fourthHanchan: [0, 0, 0],
  },
  {
    id: "chujan",
    name: "中雀",
    levelMax: [600, 800, 1000],
    levelStart: [300, 400, 500],
    canDemote: false,
    placementHanchan: [40, 15, -5],
    fourthHanchan: [-20, -25, -30],
  },
  {
    id: "jojan",
    name: "上雀",
    levelMax: [1200, 1400, 2000],
    levelStart: [600, 700, 1000],
    canDemote: true,
    placementHanchan: [45, 15, -5],
    fourthHanchan: [-40, -50, -60],
  },
  {
    id: "janou",
    name: "雀王",
    levelMax: [2800, 3200, 3600],
    levelStart: [1400, 1600, 1800],
    canDemote: true,
    placementHanchan: [55, 20, -10],
    fourthHanchan: [-80, -90, -100],
  },
  {
    id: "jantei",
    name: "雀帝",
    levelMax: [4000, 6000, 9000],
    levelStart: [2000, 3000, 4500],
    canDemote: true,
    placementHanchan: [60, 20, -10],
    fourthHanchan: [-110, -120, -130],
  },
  {
    id: "janshin",
    name: "雀神",
    levelMax: [],
    levelStart: [0],
    canDemote: true,
    placementHanchan: [65, 20, -10],
    fourthHanchan: [-150],
  },
];

/** 東風戦の順位による増減は半荘戦のこの割合（四捨五入）。 */
const TONPUUSEN_PLACEMENT_RATE = 0.5;
/** 持ち点による増減の基準点。 */
const RANK_BASE_SCORE = 25000;

export interface RankState {
  /** RANK_TIERSの添字。 */
  tier: number;
  /** 段（0始まり。表示は+1して「1段」）。雀神は常に0。 */
  level: number;
  points: number;
}

export const INITIAL_RANK: RankState = { tier: 0, level: 0, points: 0 };

const TOP_TIER = RANK_TIERS.length - 1;

/** 段位の通し番号（下雀1段=0 … 雀帝3段=14、雀神=15）。マッチングで段位の近さを測るのに使う。 */
export function rankOrdinal(rank: RankState): number {
  return rank.tier * 3 + rank.level;
}

export function rankLabel(rank: RankState): string {
  const tier = RANK_TIERS[rank.tier]!;
  return tier.levelMax.length === 0 ? tier.name : `${tier.name}${rank.level + 1}`;
}

/** 昇段に必要なポイント（雀神は上限なしでnull）。 */
export function rankMaxPoints(rank: RankState): number | null {
  return RANK_TIERS[rank.tier]!.levelMax[rank.level] ?? null;
}

/** 1試合のポイント増減。place は 1〜4。 */
export function rankPointDelta(rank: RankState, format: MatchFormat, place: 1 | 2 | 3 | 4, finalScore: number): number {
  const tier = RANK_TIERS[rank.tier]!;
  let placement = place === 4 ? tier.fourthHanchan[rank.level] ?? tier.fourthHanchan[0]! : tier.placementHanchan[place - 1]!;
  if (format === "tonpuusen") placement = Math.round(placement * TONPUUSEN_PLACEMENT_RATE);
  return placement + Math.round((finalScore - RANK_BASE_SCORE) / 1000);
}

/** ポイントを加えた後の段位（昇段・降段込み）。昇段・降段は1試合で1段まで。 */
export function applyRankPoints(rank: RankState, delta: number): RankState {
  const tier = RANK_TIERS[rank.tier]!;
  const points = rank.points + delta;
  const max = tier.levelMax[rank.level];
  if (max !== undefined && points >= max) {
    // 昇段
    const promoted = rank.level + 1 < tier.levelMax.length ? { tier: rank.tier, level: rank.level + 1 } : { tier: rank.tier + 1, level: 0 };
    return { ...promoted, points: RANK_TIERS[promoted.tier]!.levelStart[promoted.level]! };
  }
  if (points < 0) {
    if (!tier.canDemote) return { ...rank, points: 0 };
    // 降段（雀神からは雀帝の最上段へ）
    const demoted =
      rank.level > 0
        ? { tier: rank.tier, level: rank.level - 1 }
        : { tier: rank.tier - 1, level: RANK_TIERS[rank.tier - 1]!.levelMax.length - 1 };
    return { ...demoted, points: RANK_TIERS[demoted.tier]!.levelStart[demoted.level]! };
  }
  return { ...rank, points };
}

export interface RankChange {
  before: RankState;
  after: RankState;
  delta: number;
  place: 1 | 2 | 3 | 4;
}

export function rankAfterMatch(rank: RankState, format: MatchFormat, place: 1 | 2 | 3 | 4, finalScore: number): RankChange {
  const delta = rankPointDelta(rank, format, place, finalScore);
  return { before: rank, after: applyRankPoints(rank, delta), delta, place };
}

/** 正しい段位の形か（DBから読んだ値の確認用）。 */
export function isValidRank(rank: RankState): boolean {
  const tier = RANK_TIERS[rank.tier];
  if (!tier || !Number.isInteger(rank.level) || !Number.isInteger(rank.points)) return false;
  const levels = Math.max(1, tier.levelMax.length);
  return rank.level >= 0 && rank.level < levels && rank.points >= 0 && (rank.tier === TOP_TIER || rank.points < tier.levelMax[rank.level]!);
}

/** 画面に出す形（onlineProtocol.tsのRankView）にする。 */
export function toRankView(rank: RankState, gamesPlayed: number): RankState & { label: string; maxPoints: number | null; gamesPlayed: number } {
  return { ...rank, label: rankLabel(rank), maxPoints: rankMaxPoints(rank), gamesPlayed };
}
