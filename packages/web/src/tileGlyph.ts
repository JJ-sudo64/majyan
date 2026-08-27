import type { TileCode } from "@majyan/core";

const HONOR_FILES: Record<string, string> = {
  "1z": "Ton", // 東
  "2z": "Nan", // 南
  "3z": "Shaa", // 西
  "4z": "Pei", // 北
  "5z": "Haku", // 白
  "6z": "Hatsu", // 發
  "7z": "Chun", // 中
};

/** タイル画像ファイル名（拡張子抜き）。public/tiles/ 配下のSVGに対応。 */
export function tileImageName(code: TileCode): string {
  const honor = HONOR_FILES[code];
  if (honor) return honor;
  const n = code[0];
  const suit = code[1];
  const suitName = suit === "m" ? "Man" : suit === "p" ? "Pin" : "Sou";
  return `${suitName}${n}`;
}

const RED_FIVE_CODES = new Set(["5m", "5p", "5s"]);

/** 赤ドラ(5m/5p/5s)の場合は柄全体が赤い専用SVG（Man5Red等）を使う。 */
export function tileImageSrc(code: TileCode, isRed?: boolean): string {
  const name = isRed && RED_FIVE_CODES.has(code) ? `${tileImageName(code)}Red` : tileImageName(code);
  return `/tiles/${name}.svg`;
}

export const TILE_BACK_SRC = "/tiles/Back.svg";
export const TILE_FRONT_SRC = "/tiles/Front.svg";

const HONOR_LABELS: Record<string, string> = {
  "1z": "東", "2z": "南", "3z": "西", "4z": "北", "5z": "白", "6z": "發", "7z": "中",
};

export function tileLabel(code: TileCode): string {
  return HONOR_LABELS[code] ?? code;
}
