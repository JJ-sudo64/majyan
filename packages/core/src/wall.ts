import type { Tile, TileCode } from "./tiles.js";
import { allTileCodes } from "./tiles.js";

/**
 * 山（牌136枚）の管理。
 *
 * 王牌(14枚)の内訳（簡略化した固定レイアウト）:
 *  - index 0-3  : 嶺上牌（カン時に引く4枚）
 *  - index 4-13 : ドラ表示牌/裏ドラ表示牌のペア5組
 *                 (4,5)=1組目(初期ドラ), (6,7)=2組目(カン後), ... (12,13)=5組目
 */
export interface WallState {
  /** これから通常ツモで引かれる牌（先頭から引く） */
  liveTiles: Tile[];
  /** 王牌14枚 */
  deadWall: Tile[];
  /** 公開されているドラ表示牌の枚数（1〜5） */
  revealedDoraCount: number;
  /** 嶺上牌を何枚引いたか（0〜4） */
  rinshanDrawn: number;
}

let uidCounter = 0;
function nextId(): string {
  uidCounter += 1;
  return `t${uidCounter}`;
}

/** 赤ドラ対象牌（各1枚ずつ、計3枚: 5m/5p/5s）。 */
const RED_FIVE_CODES: ReadonlySet<TileCode> = new Set(["5m", "5p", "5s"]);

export function createFullTileSet(): Tile[] {
  const tiles: Tile[] = [];
  for (const code of allTileCodes()) {
    for (let i = 0; i < 4; i++) {
      // 同種4枚のうち1枚だけを赤ドラにする（どのIDかは山シャッフルでランダム化される）。
      const isRed = i === 0 && RED_FIVE_CODES.has(code);
      tiles.push(isRed ? { id: nextId(), code, isRed: true } : { id: nextId(), code });
    }
  }
  return tiles;
}

/** Fisher-Yates シャッフル。rng は 0以上1未満の乱数を返す関数（テスト時に差し替え可能） */
export function shuffleTiles(tiles: Tile[], rng: () => number = Math.random): Tile[] {
  const arr = [...tiles];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export function buildWall(rng: () => number = Math.random): WallState {
  const shuffled = shuffleTiles(createFullTileSet(), rng);
  const deadWall = shuffled.slice(0, 14);
  const liveTiles = shuffled.slice(14);
  return { liveTiles, deadWall, revealedDoraCount: 1, rinshanDrawn: 0 };
}

export function liveTilesRemaining(wall: WallState): number {
  return wall.liveTiles.length;
}

export function drawFromLive(wall: WallState): { tile: Tile; wall: WallState } {
  if (wall.liveTiles.length === 0) {
    throw new Error("wall is empty (荒牌)");
  }
  const [tile, ...rest] = wall.liveTiles;
  return { tile: tile!, wall: { ...wall, liveTiles: rest } };
}

export function drawRinshan(wall: WallState): { tile: Tile; wall: WallState } {
  if (wall.rinshanDrawn >= 4) {
    throw new Error("no more rinshan tiles (四槓散了)");
  }
  const tile = wall.deadWall[wall.rinshanDrawn]!;
  const nextWall: WallState = {
    ...wall,
    rinshanDrawn: wall.rinshanDrawn + 1,
    // 嶺上ツモの分、ライブ壁の最後の1枚を山に残す代わりに減らす（合計牌数整合のため）
    liveTiles: wall.liveTiles.slice(0, Math.max(0, wall.liveTiles.length - 1)),
  };
  return { tile, wall: nextWall };
}

export function revealNextDora(wall: WallState): WallState {
  if (wall.revealedDoraCount >= 5) return wall;
  return { ...wall, revealedDoraCount: wall.revealedDoraCount + 1 };
}

export function doraIndicators(wall: WallState): TileCode[] {
  const result: TileCode[] = [];
  for (let i = 0; i < wall.revealedDoraCount; i++) {
    const tile = wall.deadWall[4 + i * 2];
    if (tile) result.push(tile.code);
  }
  return result;
}

/** 裏ドラ表示牌（リーチ和了時のみ参照） */
export function uraDoraIndicators(wall: WallState): TileCode[] {
  const result: TileCode[] = [];
  for (let i = 0; i < wall.revealedDoraCount; i++) {
    const tile = wall.deadWall[4 + i * 2 + 1];
    if (tile) result.push(tile.code);
  }
  return result;
}
