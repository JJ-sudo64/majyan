import type { Meld, Tile } from "@majyan/core";

/**
 * 副露牌を、実際の卓と同じ「誰から鳴いたか」に応じた並び順にする。
 * gameEngine.ts側ではcalledTileを常に配列の先頭に格納しているだけなので
 * （鳴いた方向の情報はcalledFromRelativeに別途持たせてあり、tiles自体の
 * 並びは持たない）、そのまま描画すると横向き牌が常に左端に来てしまい、
 * 対面・下家から鳴いた副露の見た目がおかしくなる（上家からの鳴きだけ
 * たまたま正しく見える）。上家(1)は左端、対面(2)は中央寄り、下家(3)は
 * 右端に横向き牌が来るよう、描画直前にここで並び替える。
 */
export function orderMeldTilesForDisplay(meld: Meld): Tile[] {
  if (!meld.calledTile || meld.calledFromRelative === undefined) return meld.tiles;
  const called = meld.tiles.find((t) => t.id === meld.calledTile!.id);
  if (!called) return meld.tiles;
  const rest = meld.tiles.filter((t) => t.id !== called.id);
  if (meld.calledFromRelative === 1) return [called, ...rest];
  if (meld.calledFromRelative === 3) return [...rest, called];
  // 対面(2): 先頭・末尾を避けた位置（3枚のポンならちょうど中央、
  // 4枚の明槓なら2番目）に挟む。
  const insertAt = Math.min(1, rest.length);
  return [...rest.slice(0, insertAt), called, ...rest.slice(insertAt)];
}
