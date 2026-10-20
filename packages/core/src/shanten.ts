import type { TileCode } from "./tiles.js";
import { countsFromCodes } from "./decompose.js";
import type { Hand } from "./hand.js";

interface SearchResult {
  melds: number;
  partials: number;
  hasPair: boolean;
}

function shantenFromResult(result: SearchResult, openMelds: number): number {
  const totalMelds = result.melds + openMelds;
  const cap = Math.max(0, 4 - totalMelds);
  const cappedPartials = Math.min(result.partials, cap);
  return 8 - 2 * totalMelds - cappedPartials - (result.hasPair ? 1 : 0);
}

/**
 * 1つの色（数牌は9要素、字牌は7要素）の枚数配列について、面子の数mと雀頭の有無hごとに、
 * 取れる搭子・対子の最大数を返す（[m*2+h]、取れない組み合わせは-1）。
 * 同じ並びは何度も出てくるので結果を覚えておく。
 */
const suitMemo = new Map<number, Int8Array>();
const SUIT_MEMO_LIMIT = 200000;

function suitTable(counts: number[], offset: number, len: number, numbered: boolean): Int8Array {
  let key = len === 9 ? 1 : 2; // 数牌と字牌を区別する
  for (let i = 0; i < len; i++) key = key * 5 + counts[offset + i]!;
  const cached = suitMemo.get(key);
  if (cached) return cached;

  const out = new Int8Array(10).fill(-1);
  const c = counts.slice(offset, offset + len);

  function search(idx: number, melds: number, partials: number, hasPair: boolean): void {
    while (idx < len && c[idx] === 0) idx++;
    if (idx >= len) {
      const slot = melds * 2 + (hasPair ? 1 : 0);
      if (partials > out[slot]!) out[slot] = partials;
      return;
    }
    const n = c[idx]!;
    if (n >= 3) {
      c[idx]! -= 3;
      search(idx, melds + 1, partials, hasPair);
      c[idx]! += 3;
    }
    if (n >= 2) {
      c[idx]! -= 2;
      if (!hasPair) search(idx, melds, partials, true);
      search(idx, melds, partials + 1, hasPair);
      c[idx]! += 2;
    }
    if (numbered && idx <= len - 3 && c[idx + 1]! > 0 && c[idx + 2]! > 0) {
      c[idx]!--;
      c[idx + 1]!--;
      c[idx + 2]!--;
      search(idx, melds + 1, partials, hasPair);
      c[idx]!++;
      c[idx + 1]!++;
      c[idx + 2]!++;
    }
    if (numbered && idx <= len - 2 && c[idx + 1]! > 0) {
      c[idx]!--;
      c[idx + 1]!--;
      search(idx, melds, partials + 1, hasPair);
      c[idx]!++;
      c[idx + 1]!++;
    }
    if (numbered && idx <= len - 3 && c[idx + 2]! > 0) {
      c[idx]!--;
      c[idx + 2]!--;
      search(idx, melds, partials + 1, hasPair);
      c[idx]!++;
      c[idx + 2]!++;
    }
    search(idx + 1, melds, partials, hasPair);
  }
  search(0, 0, 0, false);

  if (suitMemo.size >= SUIT_MEMO_LIMIT) suitMemo.clear();
  suitMemo.set(key, out);
  return out;
}

/**
 * 標準形（4面子+雀頭）のシャンテン数を、副露済み面子数を考慮して計算する。
 * concealedCounts は手の内（副露牌を除く）の34要素カウント配列。
 * 色ごとの最良の取り方（suitTable）を、4色分つなぎ合わせて最良を選ぶ。
 */
export function calcStandardShanten(concealedCounts: number[], openMelds: number): number {
  // dp[m*2+h] = 面子m個・雀頭h（0/1）の時の搭子・対子の最大数
  let dp = new Int8Array(10).fill(-1);
  dp[0] = 0;
  for (let suit = 0; suit < 4; suit++) {
    const numbered = suit < 3;
    const table = suitTable(concealedCounts, suit * 9, numbered ? 9 : 7, numbered);
    const next = new Int8Array(10).fill(-1);
    for (let a = 0; a < 10; a++) {
      if (dp[a]! < 0) continue;
      for (let b = 0; b < 10; b++) {
        if (table[b]! < 0) continue;
        const h = (a & 1) + (b & 1);
        if (h > 1) continue;
        const m = (a >> 1) + (b >> 1);
        if (m > 4) continue;
        const slot = m * 2 + h;
        const p = dp[a]! + table[b]!;
        if (p > next[slot]!) next[slot] = p;
      }
    }
    dp = next;
  }
  let best = Infinity;
  for (let slot = 0; slot < 10; slot++) {
    if (dp[slot]! < 0) continue;
    const sh = shantenFromResult({ melds: slot >> 1, partials: dp[slot]!, hasPair: (slot & 1) === 1 }, openMelds);
    if (sh < best) best = sh;
  }
  return best;
}

export function calcChiitoitsuShanten(concealedCodes: TileCode[]): number {
  const counts = countsFromCodes(concealedCodes);
  const pairs = counts.filter((c) => c >= 2).length;
  const kinds = counts.filter((c) => c >= 1).length;
  return 6 - pairs + Math.max(0, 7 - kinds);
}

const KOKUSHI_INDICES = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function calcKokushiShanten(concealedCodes: TileCode[]): number {
  const counts = countsFromCodes(concealedCodes);
  let kinds = 0;
  let hasPair = false;
  for (const idx of KOKUSHI_INDICES) {
    const c = counts[idx]!;
    if (c >= 1) kinds++;
    if (c >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** 手牌全体（副露込み）のシャンテン数。小さいほど和了に近く、-1は和了形。 */
export function calcShanten(hand: Hand): number {
  const concealedCodes = hand.concealed.map((t) => t.code);
  const openMelds = hand.melds.length;
  const standard = calcStandardShanten(countsFromCodes(concealedCodes), openMelds);

  if (hand.melds.length > 0) return standard;

  const chiitoi = calcChiitoitsuShanten(concealedCodes);
  const kokushi = calcKokushiShanten(concealedCodes);
  return Math.min(standard, chiitoi, kokushi);
}

/** 手牌（14枚相当、まだ何を切るか決めていない状態）から、1枚選んで切った時に
    実現できる最良のシャンテン数。AIの打牌選択や、有効牌を引き当てる系の
    必殺技の判定に使う共通処理。removeTileFromHand（hand.ts）を使うと
    hand.ts→shanten.ts→hand.tsの循環importになるため、ここでは配列操作のみで
    「1枚抜いた手」を作る。 */
export function bestShantenAfterDiscard(hand: Hand): number {
  let best = Infinity;
  for (let i = 0; i < hand.concealed.length; i++) {
    const concealed = [...hand.concealed.slice(0, i), ...hand.concealed.slice(i + 1)];
    const s = calcShanten({ concealed, melds: hand.melds });
    if (s < best) best = s;
  }
  return best;
}
