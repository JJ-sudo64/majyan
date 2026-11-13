/**
 * 段位戦のポイント表の比較。rank-collect.mts が記録した (順位, 持ち点) を使って、
 * 今の表と「Mリーグ式（倍率＋4位だけ追加減点）」の案を、同じ記録から比べる。
 *
 *   npx tsx scripts/rank-analyze.mts <記録フォルダ> [追加減点の割合=0.5] [試行数=4000]
 *
 * 記録ファイル名: <tonpuusen|hanchan>_Lv<強さ>_s<番号>.json（rank-collect.mts の出力）。
 * 案の倍率は、強い人（Lv5）の1戦あたりの増減が今の表と同じになるよう、段ごと・形式ごとに合わせる。
 * 比べるのは、各段の各強さについて「開始ポイントから昇段 or 降段するまで」の戦数と確率。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RANK_TIERS, type MatchFormat } from "@majyan/core";

const dir = process.argv[2]!;
const EXTRA = Number(process.argv[3] ?? 0.5);
const TRIALS = Number(process.argv[4] ?? 4000);
const FORMATS: MatchFormat[] = ["tonpuusen", "hanchan"];
const LEVELS = [5, 4, 3, 1];
const UMA = [50, 10, -10, -30];

type Rec = [number, number];
const data: Record<string, Rec[]> = {};
for (const f of readdirSync(dir)) {
  const m = /^(tonpuusen|hanchan)_Lv(\d)_s\d+\.json$/.exec(f);
  if (!m) continue;
  const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
  (data[`${m[1]}-${m[2]}`] ??= []).push(...(j.records as Rec[]));
}
const rec = (f: MatchFormat, lv: number) => data[`${f}-${lv}`] ?? [];

// 今の表の1戦の増減
const curDelta = (tier: number, level: number, f: MatchFormat, place: number, score: number): number => {
  const t = RANK_TIERS[tier]!;
  const base = place === 4 ? t.fourth[f][level] ?? t.fourth[f][0]! : t.placement[f][place - 1]!;
  return base + Math.round((score - 25000) / 1000);
};
const mpt = (place: number, score: number) => (score - 30000) / 1000 + UMA[place - 1]!;
const extra4 = (tier: number, level: number, f: MatchFormat) => {
  const t = RANK_TIERS[tier]!;
  return Math.round(EXTRA * Math.abs(t.fourth[f][level] ?? t.fourth[f][0]!));
};

// 案の倍率: Lv5の1戦平均（今の表）に合わせる
const mult: Record<string, number> = {};
for (const f of FORMATS) {
  const r = rec(f, 5);
  if (r.length === 0) continue;
  const eM = r.reduce((s, [p, sc]) => s + mpt(p, sc), 0) / r.length;
  const p4 = r.filter(([p]) => p === 4).length / r.length;
  for (let tier = 1; tier < RANK_TIERS.length; tier++) {
    const levels = Math.max(1, RANK_TIERS[tier]!.levelMax.length);
    let target = 0;
    for (let l = 0; l < levels; l++) {
      const mu = r.reduce((s, [p, sc]) => s + curDelta(tier, l, f, p, sc), 0) / r.length;
      target += mu + p4 * extra4(tier, l, f);
    }
    mult[`${tier}-${f}`] = Math.round((target / levels / eM) * 100) / 100;
  }
}
const candDelta = (tier: number, level: number, f: MatchFormat, place: number, score: number): number => {
  if (tier === 0) return curDelta(tier, level, f, place, score); // 下雀は今のまま
  return Math.round(mult[`${tier}-${f}`]! * mpt(place, score)) - (place === 4 ? extra4(tier, level, f) : 0);
};

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
console.log(`追加減点=${EXTRA * 100}% / 試行${TRIALS} / 記録数: ` + Object.entries(data).map(([k, v]) => `${k}:${v.length}`).join(" "));
console.log("倍率:", Object.entries(mult).map(([k, v]) => `${RANK_TIERS[Number(k.split("-")[0])]!.name}${k.split("-")[1] === "hanchan" ? "(半)" : "(東)"}=${v}`).join(" "));

for (const f of FORMATS) {
  if (rec(f, 5).length === 0) continue;
  console.log(`\n===== ${f === "tonpuusen" ? "東風戦" : "半荘戦"} =====`);
  const avg = (tier: number, l: number, place: number, d: typeof curDelta) => {
    const r = rec(f, 3).filter(([p]) => p === place);
    return r.length ? r.reduce((sum, [p, sc]) => sum + d(tier, l, f, p, sc), 0) / r.length : NaN;
  };
  console.log("順位ごとの平均増減（Lv3の実際の持ち点で、今→案。各段の2段目）");
  for (let tier = 1; tier < RANK_TIERS.length; tier++) {
    const l = Math.min(1, Math.max(0, RANK_TIERS[tier]!.levelMax.length - 1));
    const t = RANK_TIERS[tier]!;
    const cells = [1, 2, 3, 4].map((pl) => `${pl}位 ${avg(tier, l, pl, curDelta).toFixed(0)}→${avg(tier, l, pl, candDelta).toFixed(0)}`);
    console.log(`  ${t.name}${t.levelMax.length ? l + 1 : ""}: ${cells.join("  ")}`);
  }
  console.log("段　 強さ | 今: 昇段%  昇段まで 降段まで | 案: 昇段%  昇段まで 降段まで");
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
