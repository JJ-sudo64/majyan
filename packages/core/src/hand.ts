import type { Tile, TileCode } from "./tiles.js";
import { sortTiles } from "./tiles.js";

export type MeldType = "chi" | "pon" | "minkan" | "ankan" | "kakan";

export interface Meld {
  type: MeldType;
  /** 構成牌（暗槓/加槓含め常に3〜4枚） */
  tiles: Tile[];
  /** 副露元の相対位置（自分から見て何人隣か）。暗槓の場合は undefined */
  calledFromRelative?: 1 | 2 | 3;
  /** 鳴いた牌そのもの（加槓の場合は追加した牌） */
  calledTile?: Tile;
}

export interface Hand {
  /** 手の内（副露牌を除く） */
  concealed: Tile[];
  melds: Meld[];
}

export function createEmptyHand(): Hand {
  return { concealed: [], melds: [] };
}

export function addTileToHand(hand: Hand, tile: Tile): Hand {
  return { ...hand, concealed: sortTiles([...hand.concealed, tile]) };
}

export function removeTileFromHand(hand: Hand, tileId: string): { tile: Tile; hand: Hand } {
  const idx = hand.concealed.findIndex((t) => t.id === tileId);
  if (idx === -1) throw new Error(`tile ${tileId} not found in hand`);
  const tile = hand.concealed[idx]!;
  const concealed = [...hand.concealed.slice(0, idx), ...hand.concealed.slice(idx + 1)];
  return { tile, hand: { ...hand, concealed } };
}

/** 手牌+副露を含めた全牌のコード配列（和了判定・役判定用） */
export function allHandTileCodes(hand: Hand): TileCode[] {
  return allHandTiles(hand).map((t) => t.code);
}

/** 手牌+副露を含めた全牌（Tileそのもの。赤ドラ判定など牌の実体が必要な場合用）。
    加槓は形状判定用にallHandTileCodesと同じく3枚扱いにする（合計14枚に揃えるため）。 */
export function allHandTiles(hand: Hand): Tile[] {
  const fromMelds = hand.melds.flatMap((m) => (m.type === "kakan" ? m.tiles.slice(0, 3) : m.tiles));
  return [...hand.concealed, ...fromMelds];
}

export function tileCodeCounts(codes: TileCode[]): Map<TileCode, number> {
  const map = new Map<TileCode, number>();
  for (const c of codes) map.set(c, (map.get(c) ?? 0) + 1);
  return map;
}

/** 副露が全く無い、または暗槓のみ（門前扱い）かどうか */
export function isConcealedHand(hand: Hand): boolean {
  return hand.melds.every((m) => m.type === "ankan");
}

export function countConcealedTiles(hand: Hand): number {
  return hand.concealed.length;
}
