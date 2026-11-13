/**
 * 段位戦の段位とポイント計算（数値はここに集めてあるので、調整はこのファイルだけで済む）。
 *
 * 段位: 下雀 → 中雀 → 上雀 → 雀王 → 雀帝（それぞれ1〜3段）→ 雀廃（段なし、ポイントを積み上げる）
 * 1局（1試合）ごとのポイント増減:
 *   - 下雀（初心者の育成段）: 順位による増減 ＋ (持ち点 − 25000) / 1000（四捨五入）。
 *   - 中雀以上（Mリーグ式）: 倍率 × Mリーグpt − 4位だけの追加減点（四捨五入）。
 *     Mリーグpt = (持ち点 − 30000) / 1000 ＋ 順位点(+50/+10/−10/−30)。結果画面の「Mリーグpt」と同じ式。
 *   倍率・追加減点は東風戦・半荘戦で別の値。
 * ポイントが段の上限に届くと昇段（次の段の開始ポイントから）、0を下回ると降段
 * （1つ下の段の開始ポイントから）。下雀1段だけは降段しない（ポイントは0で止まる）。
 */
import type { MatchFormat } from "./gameState.js";
import { M_LEAGUE_RULE } from "./matchPoints.js";

/** 東風戦・半荘戦ごとの値。 */
type ByFormat<T> = Record<MatchFormat, T>;

export interface RankTier {
  id: string;
  name: string;
  /** 段ごとの、昇段に必要なポイント（上限）。雀廃は上限なし（空配列）。 */
  levelMax: number[];
  /** 段ごとの、その段に上がった/落ちた時の開始ポイント。 */
  levelStart: number[];
  /** 段ごとの、ポイントが0未満になった時に降段するか（falseならポイントは0で止まる）。 */
  canDemote: boolean[];
  /** ポイントの計算方法（下雀は従来の表、中雀以上はMリーグ式）。 */
  points: LegacyPoints | MleaguePoints;
}

/** 従来の表: 順位による増減 ＋ 持ち点(25000基準)による増減。 */
export interface LegacyPoints {
  /** 順位による増減（1位〜3位）。トップ偏重（1位が大きく、2位は小さなプラス）。 */
  placement: ByFormat<[number, number, number]>;
  /** 4位の減点（段ごと）。上の段ほど重い。 */
  fourth: ByFormat<number[]>;
}

/** Mリーグ式: 倍率 × Mリーグpt − 4位だけの追加減点。 */
export interface MleaguePoints {
  /** Mリーグptにかける倍率。 */
  multiplier: ByFormat<number>;
  /** 4位のときだけ引く追加の減点（段ごと、正の数）。 */
  fourthExtra: ByFormat<number[]>;
}

/**
 * 昇段・初期ポイントは雀魂（じゃんたま）の段位戦に合わせてある（10-21）。
 * 順位による増減は「1位を取ると気持ちいい」ようにトップ偏重にしてある（10-28、ユーザー希望）:
 *   形は 1位が大きく加点・2位は小さなプラス・3位と4位は減点（Mリーグ型の 50/10/-10/-30 の形）。
 *   雀魂と同じペースを保つため、段ごとに「平均的な人」「やや上手」「上手」の1試合あたりの
 *   増減（持ち点補正を除く）が雀魂の表とほぼ一致するように配点を逆算した。
 *   順位の分布は 平均25/25/25/25・やや上手30/27/23/20・上手35/28/22/15（%）と仮定。
 * 11-13: 中雀以上をMリーグ式に変更（ユーザー了承）。倍率は、強いCPU（Lv5）の1戦あたりの増減が
 *   従来の表と同じになるよう段ごと・形式ごとに合わせ、4位の追加減点は従来の4位減点の25%にした
 *   （scripts/rank-collect.mts と rank-analyze.mts で測定。雀帝2・東風戦で 4位の平均 −109→−85、強い人の昇段ペースは同じ、
 *   普通の人(Lv3)が降段するまで 371戦→602戦）。0%だと普通の人まで昇段し続けて壁が消え、50%だと4位が今より重くなる。
 * 下雀は初心者の育成段で、減点が無く従来のまま。
 * 雀廃は雀魂の魂天（魂珠で上下する別の仕組み）の代わりに、ポイントを積み上げる形にしてある。
 */
export const RANK_TIERS: RankTier[] = [
  {
    id: "gejan",
    name: "下雀",
    levelMax: [20, 80, 200],
    levelStart: [0, 10, 40],
    // 下雀1だけは、これ以上下が無いので降段しない。
    canDemote: [false, true, true],
    points: {
      placement: { tonpuusen: [10, 5, 0], hanchan: [20, 10, 0] },
      fourth: { tonpuusen: [0, 0, 0], hanchan: [0, 0, 0] },
    },
  },
  {
    id: "chujan",
    name: "中雀",
    levelMax: [600, 800, 1000],
    levelStart: [300, 400, 500],
    canDemote: [true, true, true],
    points: {
      multiplier: { tonpuusen: 0.46, hanchan: 0.7 },
      fourthExtra: { tonpuusen: [2, 5, 7], hanchan: [4, 9, 14] },
    },
  },
  {
    id: "jojan",
    name: "上雀",
    levelMax: [1200, 1400, 2000],
    levelStart: [600, 700, 1000],
    canDemote: [true, true, true],
    points: {
      multiplier: { tonpuusen: 0.56, hanchan: 0.98 },
      fourthExtra: { tonpuusen: [8, 11, 13], hanchan: [16, 21, 26] },
    },
  },
  {
    id: "janou",
    name: "雀王",
    levelMax: [2800, 3200, 3600],
    levelStart: [1400, 1600, 1800],
    canDemote: [true, true, true],
    points: {
      multiplier: { tonpuusen: 0.94, hanchan: 1.72 },
      fourthExtra: { tonpuusen: [16, 19, 21], hanchan: [34, 38, 42] },
    },
  },
  {
    id: "jantei",
    name: "雀帝",
    levelMax: [4000, 6000, 9000],
    levelStart: [2000, 3000, 4500],
    canDemote: [true, true, true],
    points: {
      multiplier: { tonpuusen: 1.3, hanchan: 2.35 },
      fourthExtra: { tonpuusen: [22, 25, 27], hanchan: [43, 46, 50] },
    },
  },
  {
    id: "janshin",
    name: "雀廃",
    levelMax: [],
    levelStart: [0],
    canDemote: [true],
    points: {
      multiplier: { tonpuusen: 1.35, hanchan: 2.56 },
      fourthExtra: { tonpuusen: [27], hanchan: [49] },
    },
  },
];

/** 下雀（従来の表）で、持ち点による増減の基準点。 */
const RANK_BASE_SCORE = 25000;

export interface RankState {
  /** RANK_TIERSの添字。 */
  tier: number;
  /** 段（0始まり。表示は+1して「1段」）。雀廃は常に0。 */
  level: number;
  points: number;
}

export const INITIAL_RANK: RankState = { tier: 0, level: 0, points: 0 };

const TOP_TIER = RANK_TIERS.length - 1;

/** 段位の通し番号（下雀1段=0 … 雀帝3段=14、雀廃=15）。マッチングで段位の近さを測るのに使う。 */
export function rankOrdinal(rank: RankState): number {
  return rank.tier * 3 + rank.level;
}

export function rankLabel(rank: RankState): string {
  const tier = RANK_TIERS[rank.tier]!;
  return tier.levelMax.length === 0 ? tier.name : `${tier.name}${rank.level + 1}`;
}

/** 昇段に必要なポイント（雀廃は上限なしでnull）。 */
export function rankMaxPoints(rank: RankState): number | null {
  return RANK_TIERS[rank.tier]!.levelMax[rank.level] ?? null;
}

/** 1試合のポイント増減。place は 1〜4。 */
export function rankPointDelta(rank: RankState, format: MatchFormat, place: 1 | 2 | 3 | 4, finalScore: number): number {
  const points = RANK_TIERS[rank.tier]!.points;
  if ("multiplier" in points) {
    // Mリーグ式。結果画面の「Mリーグpt」と同じ式（matchPoints.ts）に倍率をかけ、4位だけ追加で引く。
    const mpt = (finalScore - M_LEAGUE_RULE.returnScore) / 1000 + M_LEAGUE_RULE.placement[place - 1]!;
    const extra = place === 4 ? points.fourthExtra[format][rank.level] ?? points.fourthExtra[format][0]! : 0;
    return Math.round(points.multiplier[format] * mpt) - extra;
  }
  const placement =
    place === 4 ? points.fourth[format][rank.level] ?? points.fourth[format][0]! : points.placement[format][place - 1]!;
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
    if (!tier.canDemote[rank.level]) return { ...rank, points: 0 };
    // 降段（雀廃からは雀帝の最上段へ）
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
