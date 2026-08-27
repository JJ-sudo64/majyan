/**
 * 牌の定義。表記は m(萬子)/p(筒子)/s(索子)/z(字牌) の2文字コード。
 * z: 1=東 2=南 3=西 4=北 5=白 6=發 7=中
 */
export type NumberedSuit = "m" | "p" | "s";
export type SuitNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type HonorNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type NumberedTileCode = `${SuitNumber}${NumberedSuit}`;
export type HonorTileCode = `${HonorNumber}z`;
export type TileCode = NumberedTileCode | HonorTileCode;

export type Wind = 1 | 2 | 3 | 4; // 東南西北

export interface Tile {
  /** 山生成時に振られる一意なID（同種牌の識別用） */
  id: string;
  code: TileCode;
  /** 赤ドラ（5m/5p/5sの一部を赤牌にするルール）対象の牌かどうか */
  isRed?: boolean;
}

export const WINDS = [1, 2, 3, 4] as const;
export const WIND_NAMES: Record<Wind, string> = { 1: "東", 2: "南", 3: "西", 4: "北" };
export const DRAGON_NAMES: Record<5 | 6 | 7, string> = { 5: "白", 6: "發", 7: "中" };

/** 34種の牌コードを昇順で列挙 */
export function allTileCodes(): TileCode[] {
  const codes: TileCode[] = [];
  for (const suit of ["m", "p", "s"] as const) {
    for (let n = 1; n <= 9; n++) {
      codes.push(`${n as SuitNumber}${suit}`);
    }
  }
  for (let n = 1; n <= 7; n++) {
    codes.push(`${n as HonorNumber}z`);
  }
  return codes;
}

const TILE_CODE_INDEX: Map<TileCode, number> = new Map(
  allTileCodes().map((code, i) => [code, i]),
);

/** 牌コードを 0-33 のインデックスに変換（役判定・シャンテン計算で使用） */
export function tileCodeToIndex(code: TileCode): number {
  const idx = TILE_CODE_INDEX.get(code);
  if (idx === undefined) throw new Error(`invalid tile code: ${code}`);
  return idx;
}

export function indexToTileCode(index: number): TileCode {
  const codes = allTileCodes();
  const code = codes[index];
  if (!code) throw new Error(`invalid tile index: ${index}`);
  return code;
}

export function isHonor(code: TileCode): boolean {
  return code.endsWith("z");
}

export function isNumbered(code: TileCode): code is NumberedTileCode {
  return !isHonor(code);
}

export function suitOf(code: TileCode): NumberedSuit | "z" {
  return code[1] as NumberedSuit | "z";
}

export function numberOf(code: TileCode): number {
  return Number(code[0]);
}

export function isTerminal(code: TileCode): boolean {
  return isNumbered(code) && (numberOf(code) === 1 || numberOf(code) === 9);
}

export function isTerminalOrHonor(code: TileCode): boolean {
  return isHonor(code) || isTerminal(code);
}

export function isSimple(code: TileCode): boolean {
  return !isTerminalOrHonor(code);
}

export function isWindTile(code: TileCode): boolean {
  return isHonor(code) && numberOf(code) >= 1 && numberOf(code) <= 4;
}

export function isDragonTile(code: TileCode): boolean {
  return isHonor(code) && numberOf(code) >= 5 && numberOf(code) <= 7;
}

export function isGreenTile(code: TileCode): boolean {
  // 緑一色の対象牌: 2s 3s 4s 6s 8s 發
  return code === "2s" || code === "3s" || code === "4s" || code === "6s" || code === "8s" || code === "6z";
}

/** 表ドラ表示牌からドラの牌コードを求める */
export function nextTileForDora(indicator: TileCode): TileCode {
  if (isNumbered(indicator)) {
    const n = numberOf(indicator);
    const next = n === 9 ? 1 : n + 1;
    return `${next as SuitNumber}${suitOf(indicator) as NumberedSuit}`;
  }
  const n = numberOf(indicator);
  if (n >= 1 && n <= 4) {
    // 風牌: 東→南→西→北→東
    const next = n === 4 ? 1 : n + 1;
    return `${next as HonorNumber}z`;
  }
  // 三元牌: 白→發→中→白
  const next = n === 7 ? 5 : n + 1;
  return `${next as HonorNumber}z`;
}

export function compareTileCode(a: TileCode, b: TileCode): number {
  return tileCodeToIndex(a) - tileCodeToIndex(b);
}

export function sortTileCodes(codes: TileCode[]): TileCode[] {
  return [...codes].sort(compareTileCode);
}

export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => compareTileCode(a.code, b.code));
}
