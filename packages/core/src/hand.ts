import type { Tile, TileCode } from "./tiles.js";
import { allTileCodes, sortTiles } from "./tiles.js";
import { calcShanten } from "./shanten.js";

export type MeldType = "chi" | "pon" | "minkan" | "ankan" | "kakan";

export interface Meld {
  type: MeldType;
  /** 構成牌（暗槓/加槓含め常に3〜4枚） */
  tiles: Tile[];
  /** 副露元の相対位置（自分から見て何人隣か）。暗槓の場合は undefined */
  calledFromRelative?: 1 | 2 | 3;
  /** 元々のポン/チー/大明槓で鳴いた牌（表示上、横向きにする基準）。
      加槓で4枚目を足しても、どの方向から鳴いたかの表示を保つためこの牌のまま変わらない。 */
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
    カン（暗槓・明槓・加槓のいずれも）は実際には4枚だが、和了形の判定は
    「4面子+雀頭=14枚」を前提にしているため、形状判定用に3枚（=通常の刻子と
    同じ枚数）扱いにする。以前はkakanだけこの正規化をしていたため、
    ankan/minkanを含む手が常に合計15枚になり、analyzeWinの
    「ちょうど14枚か」チェックに引っかかって和了自体が成立しなくなっていた
    （役牌バック等、役の有無に関係なくカンが絡む手が軒並みツモ/ロン不可に
    なる不具合の原因）。 */
export function allHandTiles(hand: Hand): Tile[] {
  const isKan = (type: Meld["type"]) => type === "ankan" || type === "minkan" || type === "kakan";
  const fromMelds = hand.melds.flatMap((m) => (isKan(m.type) ? m.tiles.slice(0, 3) : m.tiles));
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

/** 手牌(13枚相当)がロン/ツモできる待ち牌の一覧。役の有無は問わない形の判定。 */
export function getWaitingTiles(hand: Hand): TileCode[] {
  const waits: TileCode[] = [];
  for (const code of allTileCodes()) {
    const testHand: Hand = {
      concealed: sortTiles([...hand.concealed, { id: "__probe__", code }]),
      melds: hand.melds,
    };
    if (calcShanten(testHand) === -1) waits.push(code);
  }
  return waits;
}
