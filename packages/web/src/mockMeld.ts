import type { Meld, Tile, TileCode } from "@majyan/core";

/**
 * 配置の編集・確認用に、卓上へ仮で表示するダミーの副露（見た目の確認用。対局の実データには
 * 一切影響しない）。孤立したidを使い、実データのidと衝突しないようにする。
 * 他家の配置編集（OpponentArea.tsx）と、自分の副露の確認（Hand.tsx）が同じ作りを使う。
 *
 * - pon: ポン(3枚)。横向きの牌は左端
 * - ankan: 暗槓(4枚、両端伏せ・鳴き元なし)
 * - kakan: 加槓（ポンの横向き牌の上に4枚目を重ねる。tilesに4枚目も含み、addedKanTileで示す＝本番と同じ形）
 */
export function makeMockMeld(index: number, type: "pon" | "ankan" | "kakan" = "pon", code: TileCode = "5p"): Meld {
  const tile = (i: number): Tile => ({ id: `mock-meld-${index}-${i}`, code, isRed: false });
  if (type === "ankan") {
    return { type: "ankan", tiles: [tile(0), tile(1), tile(2), tile(3)] };
  }
  if (type === "kakan") {
    return { type: "kakan", tiles: [tile(0), tile(1), tile(2), tile(3)], calledFromRelative: 1, calledTile: tile(0), addedKanTile: tile(3) };
  }
  return { type: "pon", tiles: [tile(0), tile(1), tile(2)], calledFromRelative: 1, calledTile: tile(0) };
}
