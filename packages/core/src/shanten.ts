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
 * 標準形（4面子+雀頭）のシャンテン数を、副露済み面子数を考慮して計算する。
 * concealedCounts は手の内（副露牌を除く）の34要素カウント配列。
 */
export function calcStandardShanten(concealedCounts: number[], openMelds: number): number {
  let best = Infinity;

  function search(idx: number, counts: number[], melds: number, partials: number, hasPair: boolean): void {
    if (idx >= 34) {
      const shanten = shantenFromResult({ melds, partials, hasPair }, openMelds);
      if (shanten < best) best = shanten;
      return;
    }
    const c = counts[idx]!;
    if (c === 0) {
      search(idx + 1, counts, melds, partials, hasPair);
      return;
    }

    // 刻子として消費
    if (c >= 3) {
      const next = counts.slice();
      next[idx]! -= 3;
      search(idx, next, melds + 1, partials, hasPair);
    }

    // 対子として消費（雀頭 or 対子搭子）
    if (c >= 2) {
      const next = counts.slice();
      next[idx]! -= 2;
      if (!hasPair) {
        search(idx, next, melds, partials, true);
      }
      search(idx, next, melds, partials + 1, hasPair);
    }

    const isNumbered = idx < 27;
    const numberInSuit = idx % 9;

    // 順子として消費
    if (isNumbered && numberInSuit <= 6 && counts[idx + 1]! > 0 && counts[idx + 2]! > 0) {
      const next = counts.slice();
      next[idx]! -= 1;
      next[idx + 1]! -= 1;
      next[idx + 2]! -= 1;
      search(idx, next, melds + 1, partials, hasPair);
    }

    // 両面/辺張搭子 (idx, idx+1)
    if (isNumbered && numberInSuit <= 7 && counts[idx + 1]! > 0) {
      const next = counts.slice();
      next[idx]! -= 1;
      next[idx + 1]! -= 1;
      search(idx, next, melds, partials + 1, hasPair);
    }

    // 嵌張搭子 (idx, idx+2)
    if (isNumbered && numberInSuit <= 6 && counts[idx + 2]! > 0) {
      const next = counts.slice();
      next[idx]! -= 1;
      next[idx + 2]! -= 1;
      search(idx, next, melds, partials + 1, hasPair);
    }

    // 残りを孤立牌として放棄し次の種類へ
    search(idx + 1, counts, melds, partials, hasPair);
  }

  search(0, concealedCounts.slice(), 0, 0, false);
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
