import { tileCodeToIndex, indexToTileCode, type TileCode } from "./tiles.js";

export type SetGroup =
  | { type: "triplet"; tile: TileCode }
  | { type: "sequence"; tile: TileCode }; // tile = 最小牌（順子の開始牌）

export interface StandardDecomposition {
  sets: SetGroup[];
  pair: TileCode;
}

export function countsFromCodes(codes: TileCode[]): number[] {
  const counts = new Array(34).fill(0);
  for (const c of codes) counts[tileCodeToIndex(c)]++;
  return counts;
}

/**
 * counts (34要素) を過不足なく setsNeeded 個の面子に分解する全パターンを返す。
 * 余りが出るパターンは含まない。
 */
function findSetDecompositions(counts: number[]): SetGroup[][] {
  const idx = counts.findIndex((c) => c > 0);
  if (idx === -1) return [[]];

  const results: SetGroup[][] = [];

  if (counts[idx]! >= 3) {
    const next = counts.slice();
    next[idx]! -= 3;
    for (const rest of findSetDecompositions(next)) {
      results.push([{ type: "triplet", tile: indexToTileCode(idx) }, ...rest]);
    }
  }

  const numberInSuit = idx % 9;
  const isNumberedSuit = idx < 27;
  if (isNumberedSuit && numberInSuit <= 6 && counts[idx + 1]! > 0 && counts[idx + 2]! > 0) {
    const next = counts.slice();
    next[idx]! -= 1;
    next[idx + 1]! -= 1;
    next[idx + 2]! -= 1;
    for (const rest of findSetDecompositions(next)) {
      results.push([{ type: "sequence", tile: indexToTileCode(idx) }, ...rest]);
    }
  }

  return results;
}

/**
 * concealedCodes を「setsNeeded 個の面子 + 雀頭1つ」に分解する全パターンを列挙する。
 * 和了判定・役判定で使用（副露済みの面子は含めず、手の内だけを渡す）。
 */
export function decomposeStandardHand(
  concealedCodes: TileCode[],
  setsNeeded: number,
): StandardDecomposition[] {
  const baseCounts = countsFromCodes(concealedCodes);
  const expectedTotal = setsNeeded * 3 + 2;
  if (concealedCodes.length !== expectedTotal) return [];

  const results: StandardDecomposition[] = [];
  for (let idx = 0; idx < 34; idx++) {
    if (baseCounts[idx]! >= 2) {
      const next = baseCounts.slice();
      next[idx]! -= 2;
      for (const sets of findSetDecompositions(next)) {
        if (sets.length === setsNeeded) {
          results.push({ sets, pair: indexToTileCode(idx) });
        }
      }
    }
  }
  return results;
}

export function canFormStandardHand(concealedCodes: TileCode[], setsNeeded: number): boolean {
  return decomposeStandardHand(concealedCodes, setsNeeded).length > 0;
}
