/**
/**
 * 段位戦のポイント表の比較。rank-collect.mts が記録した (順位, 持ち点) を使って、
 * Mリーグ式に変える前の表（このファイルに埋め込み）と、今の表（ranked.ts）を同じ記録から比べる。
 *
 *   npx tsx scripts/rank-analyze.mts <記録フォルダ> [試行数=4000]
 *
 * 記録ファイル名: <tonpuusen|hanchan>_Lv<強さ>_s<番号>.json（rank-collect.mts の出力）。
 * 比べるのは、各段の各強さについて「開始ポイントから昇段 or 降段するまで」の戦数と確率。
 * 倍率を決め直すときは、強い人(Lv5)の1戦平均が従来の表と同じになるよう段ごと・形式ごとに合わせた
 * （ranked.ts のコメント参照）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RANK_TIERS, rankPointDelta, type MatchFormat } from "@majyan/core";

const dir = process.argv[2]!;
const TRIALS = Number(process.argv[3] ?? 4000);
const FORMATS: MatchFormat[] = ["tonpuusen", "hanchan"];
const LEVELS = [5, 4, 3, 1];

type Rec = [number, number];
const data: Record<string, Rec[]> = {};
for (const f of readdirSync(dir)) {
  const m = /^(tonpuusen|hanchan)_Lv(\d)_s\d+\.json$/.exec(f);
  if (!m) continue;
  const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
  (data[`${m[1]}-${m[2]}`] ??= []).push(...(j.records as Rec[]));
}
const rec = (f: MatchFormat, lv: number) => data[`${f}-${lv}`] ?? [];

// 比較のもと: Mリーグ式に変える前（11-13より前）の表。順位による増減(1〜3位)と4位の減点(段ごと)。
const LEGACY: Record<string, { placement: Record<MatchFormat, number[]>; fourth: Record<MatchFormat, number[]> }> = {
  gejan: { placement: { tonpuusen: [10, 5, 0], hanchan: [20, 10, 0] }, fourth: { tonpuusen: [0, 0, 0], hanchan: [0, 0, 0] } },
  chujan: { placement: { tonpuusen: [14, 1, -6], hanchan: [27, 3, -11] }, fourth: { tonpuusen: [-8, -18, -28], hanchan: [-15, -35, -55] } },
  jojan: { placement: { tonpuusen: [27, 3, -10], hanchan: [54, 5, -20] }, fourth: { tonpuusen: [-33, -43, -53], hanchan: [-65, -85, -105] } },
  janou: { placement: { tonpuusen: [55, 5, -20], hanchan: [109, 11, -39] }, fourth: { tonpuusen: [-65, -75, -85], hanchan: [-136, -151, -166] } },
  jantei: { placement: { tonpuusen: [77, 8, -27], hanchan: [150, 15, -50] }, fourth: { tonpuusen: [-88, -98, -108], hanchan: [-170, -185, -200] } },
  janshin: { placement: { tonpuusen: [82, 8, -27], hanchan: [164, 16, -54] }, fourth: { tonpuusen: [-108], hanchan: [-196] } },
};
// 従来の表の1戦の増減
const curDelta = (tier: number, level: number, f: MatchFormat, place: number, score: number): number => {
  const t = LEGACY[RANK_TIERS[tier]!.id]!;
  const base = place === 4 ? t.fourth[f][level] ?? t.fourth[f][0]! : t.placement[f][place - 1]!;
  return base + Math.round((score - 25000) / 1000);
};
// 今の表（ranked.ts）の1戦の増減
const candDelta = (tier: number, level: number, f: MatchFormat, place: number, score: number): number =>
  rankPointDelta({ tier, level, points: 0 }, f, place, score);

// 昇段・降段の判定は ranked.ts と同じ
function simulate(
  tier: number, level: number, f: MatchFormat, lv: number,
  delta: (t: number, l: number, f: MatchFormat, p: number, s: number) => number, seed: number,
) {
  const r = rec(f, lv);
  const t = RANK_TIERS[tier]!;
  const max = t.levelMax[level];
  let a = seed >>> 0;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  let up = 0, down = 0, upGames = 0, downGames = 0, none = 0;
  for (let k = 0; k < TRIALS; k++) {
    let pts = t.levelStart[level]!;
    let n = 0;
    for (;;) {
      const [p, sc] = r[Math.floor(rnd() * r.length)]!;
      pts += delta(tier, level, f, p, sc);
      n++;
      if (max !== undefined && pts >= max) { up++; upGames += n; break; }
      if (pts < 0) {
        if (t.canDemote[level]) { down++; downGames += n; break; }
        pts = 0;
      }
      if (n >= 3000) { none++; break; }
    }
  }
  return {
    pUp: up / TRIALS,
    upGames: up ? upGames / up : NaN,
    downGames: down ? downGames / down : NaN,
    pDown: down / TRIALS,
    none: none / TRIALS,
  };
}

const fmt = (x: number) => (Number.isNaN(x) ? "  -  " : String(Math.round(x)).padStart(5));
console.log(`従来の表 と 今の表(ranked.ts) / 試行${TRIALS} / 記録数: ` + Object.entries(data).map(([k, v]) => `${k}:${v.length}`).join(" "));

for (const f of FORMATS) {
  if (rec(f, 5).length === 0) continue;
  console.log(`\n===== ${f === "tonpuusen" ? "東風戦" : "半荘戦"} =====`);
  const avg = (tier: number, l: number, place: number, d: typeof curDelta) => {
    const r = rec(f, 3).filter(([p]) => p === place);
    return r.length ? r.reduce((sum, [p, sc]) => sum + d(tier, l, f, p, sc), 0) / r.length : NaN;
  };
  console.log("順位ごとの平均増減（Lv3の実際の持ち点で、従来→今。各段の2段目）");
  for (let tier = 1; tier < RANK_TIERS.length; tier++) {
    const l = Math.min(1, Math.max(0, RANK_TIERS[tier]!.levelMax.length - 1));
    const t = RANK_TIERS[tier]!;
    const cells = [1, 2, 3, 4].map((pl) => `${pl}位 ${avg(tier, l, pl, curDelta).toFixed(0)}→${avg(tier, l, pl, candDelta).toFixed(0)}`);
    console.log(`  ${t.name}${t.levelMax.length ? l + 1 : ""}: ${cells.join("  ")}`);
  }
  console.log("段　 強さ | 従来: 昇段%  昇段まで 降段まで | 今: 昇段%  昇段まで 降段まで");
  for (let tier = 1; tier < RANK_TIERS.length; tier++) {
    const t = RANK_TIERS[tier]!;
    const levels = Math.max(1, t.levelMax.length);
    for (let l = 0; l < levels; l++) {
      for (const lv of LEVELS) {
        if (rec(f, lv).length === 0) continue;
        const c = simulate(tier, l, f, lv, curDelta, 1);
        const n = simulate(tier, l, f, lv, candDelta, 1);
        console.log(
          `${t.name}${t.levelMax.length ? l + 1 : " "}  Lv${lv}  | ${(c.pUp * 100).toFixed(0).padStart(4)}%  ${fmt(c.upGames)}  ${fmt(c.downGames)}  | ${(n.pUp * 100).toFixed(0).padStart(4)}%  ${fmt(n.upGames)}  ${fmt(n.downGames)}`,
        );
      }
    }
  }
}
