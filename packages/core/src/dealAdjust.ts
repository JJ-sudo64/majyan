/**
 * 配牌そのものを書き換える効果（メビウスの必殺技「陰陽配牌」、コウジの
 * 必殺技「対子の約束」、カード「面子確約」「ドラ確約」）で共有するヘルパー群。
 * いずれも「手牌の一部を山の牌と入れ替える」操作のみで実現し、
 * 山・手牌の合計牌数、各牌の総数は常に保たれる。
 */
import type { Hand } from "./hand.js";
import { doraIndicators, type WallState } from "./wall.js";
import { isNumbered, numberOf, suitOf, nextTileForDora, sortTiles, allTileCodes, type Tile, type TileCode } from "./tiles.js";

/** 与えられた牌集合（手牌の濃厚 or 山の残り）の中に完成した面子
    （刻子＝同じ牌3枚、または順子＝連続する3つの数牌）が存在すれば、
    それを構成する3枚（Tile実体）を返す。刻子を優先的に探し、
    無ければ順子を探す。存在しなければnull。 */
export function findCompleteMeldTiles(tiles: Tile[]): Tile[] | null {
  const byCode = new Map<TileCode, Tile[]>();
  for (const t of tiles) {
    const list = byCode.get(t.code);
    if (list) list.push(t);
    else byCode.set(t.code, [t]);
  }
  for (const list of byCode.values()) {
    if (list.length >= 3) return list.slice(0, 3);
  }
  for (const code of allTileCodes()) {
    if (!isNumbered(code)) continue;
    const n = numberOf(code);
    if (n > 7) continue;
    const suit = suitOf(code);
    const a = byCode.get(code);
    const b = byCode.get(`${n + 1}${suit}` as TileCode);
    const c = byCode.get(`${n + 2}${suit}` as TileCode);
    if (a?.length && b?.length && c?.length) return [a[0]!, b[0]!, c[0]!];
  }
  return null;
}

/** 手牌のうちremoveIdsで指定した牌を、山のliveTilesのうちaddIdsで
    指定した牌と入れ替える。外した牌は山の末尾へ戻す（山の合計牌数・
    各牌の総数は常に保たれる）。 */
export function swapHandTilesWithWall(hand: Hand, wall: WallState, removeIds: string[], addIds: string[]): { hand: Hand; wall: WallState } {
  const removeSet = new Set(removeIds);
  const addSet = new Set(addIds);
  const displaced = hand.concealed.filter((t) => removeSet.has(t.id));
  const keptConcealed = hand.concealed.filter((t) => !removeSet.has(t.id));
  const added = wall.liveTiles.filter((t) => addSet.has(t.id));
  const keptWall = wall.liveTiles.filter((t) => !addSet.has(t.id));
  return {
    hand: { concealed: sortTiles([...keptConcealed, ...added]), melds: hand.melds },
    wall: { ...wall, liveTiles: [...keptWall, ...displaced] },
  };
}

/** 手牌に完成した面子が1つも無ければ、山から調達できる面子（刻子優先、
    次点で順子）を1つ見つけて手牌の適当な3枚と入れ替える。山にもそのような
    3枚が見つからなければ何もしない（極めて稀な不発）。 */
export function ensureAtLeastOneMeld(hand: Hand, wall: WallState): { hand: Hand; wall: WallState } {
  if (findCompleteMeldTiles(hand.concealed)) return { hand, wall };
  const meldTiles = findCompleteMeldTiles(wall.liveTiles);
  if (!meldTiles) return { hand, wall };
  const removeIds = hand.concealed.slice(0, 3).map((t) => t.id);
  return swapHandTilesWithWall(hand, wall, removeIds, meldTiles.map((t) => t.id));
}

/** 手牌に完成した面子が無くなるまで、見つかった面子から1枚を選び、
    それを入れても新たな面子を作らない山の牌と入れ替える処理を繰り返す。
    安全な入れ替え先が見つからなければそこで諦める（極めて稀な不発）。 */
export function ensureNoMelds(hand: Hand, wall: WallState, maxAttempts: number): { hand: Hand; wall: WallState } {
  let currentHand = hand;
  let currentWall = wall;
  for (let i = 0; i < maxAttempts; i++) {
    const meldTiles = findCompleteMeldTiles(currentHand.concealed);
    if (!meldTiles) break;
    const targetId = meldTiles[0]!.id;
    const withoutTarget = currentHand.concealed.filter((t) => t.id !== targetId);
    const safeIndex = currentWall.liveTiles.findIndex((t) => !findCompleteMeldTiles([...withoutTarget, t]));
    if (safeIndex === -1) break; // 崩しても必ず別の面子ができてしまう(極めて稀)。諦める。
    const replacement = currentWall.liveTiles[safeIndex]!;
    const displaced = currentHand.concealed.find((t) => t.id === targetId)!;
    currentHand = { concealed: sortTiles([...withoutTarget, replacement]), melds: currentHand.melds };
    currentWall = {
      ...currentWall,
      liveTiles: [...currentWall.liveTiles.slice(0, safeIndex), ...currentWall.liveTiles.slice(safeIndex + 1), displaced],
    };
  }
  return { hand: currentHand, wall: currentWall };
}

/** 手牌にドラ（表ドラ、および赤ドラの5m/5p/5s）が1枚も無ければ、
    山から該当する1枚を見つけて手牌の適当な1枚と入れ替える。山にも
    見つからなければ何もしない（極めて稀な不発）。サキの「特技ドラ引き」
    と同じ「表示牌から求まるドラ、および赤ドラ」の判定を使う。 */
export function ensureAtLeastOneDora(hand: Hand, wall: WallState): { hand: Hand; wall: WallState } {
  const doraCodes = new Set(doraIndicators(wall).map(nextTileForDora));
  const isDoraTile = (t: Tile) => doraCodes.has(t.code) || t.isRed === true;
  if (hand.concealed.some(isDoraTile)) return { hand, wall };
  const wallIndex = wall.liveTiles.findIndex(isDoraTile);
  if (wallIndex === -1) return { hand, wall };
  const target = wall.liveTiles[wallIndex]!;
  return swapHandTilesWithWall(hand, wall, [hand.concealed[0]!.id], [target.id]);
}

/** 手牌のトイツ（同じ牌2枚以上の組。刻子・4枚もそれぞれ1組と数える）の数。 */
export function countPairs(tiles: Tile[]): number {
  const counts = new Map<TileCode, number>();
  for (const t of tiles) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
  let pairs = 0;
  for (const c of counts.values()) if (c >= 2) pairs++;
  return pairs;
}

/** 手牌のトイツがminPairs組に満たなければ、手牌に1枚しかない牌と同じ牌を
    山から1枚持ってきて、手牌の別の1枚と入れ替えることを繰り返す。外す牌は
    手牌に1枚しかない牌を優先し、無ければ3枚以上ある牌から外す（どちらも
    外して既存のトイツが減らないので、1回の入れ替えで必ず1組増える）。
    13枚でトイツが足りない間は1枚だけの牌が必ずあるが、それと同じ牌が山に
    残っていなければ不発（極めて稀）。 */
export function ensureAtLeastPairs(hand: Hand, wall: WallState, minPairs: number): { hand: Hand; wall: WallState } {
  let current = { hand, wall };
  for (let i = 0; i < minPairs; i++) {
    const concealed = current.hand.concealed;
    if (countPairs(concealed) >= minPairs) break;
    const countOf = (code: TileCode) => concealed.filter((t) => t.code === code).length;
    const singles = concealed.filter((t) => countOf(t.code) === 1);
    let target: Tile | undefined;
    for (const s of singles) {
      target = current.wall.liveTiles.find((t) => t.code === s.code);
      if (target) break;
    }
    if (!target) break;
    const targetCode = target.code;
    const removable =
      [...singles].reverse().find((t) => t.code !== targetCode) ?? concealed.find((t) => countOf(t.code) >= 3);
    if (!removable) break;
    current = swapHandTilesWithWall(current.hand, current.wall, [removable.id], [target.id]);
  }
  return current;
}

/** 手牌に赤ドラ（赤5）が1枚も無ければ、山から赤ドラを1枚見つけて手牌の適当な1枚と
    入れ替える。山にも見つからなければ何もしない（極めて稀な不発）。 */
export function ensureAtLeastOneRedTile(hand: Hand, wall: WallState): { hand: Hand; wall: WallState } {
  if (hand.concealed.some((t) => t.isRed === true)) return { hand, wall };
  const target = wall.liveTiles.find((t) => t.isRed === true);
  if (!target) return { hand, wall };
  return swapHandTilesWithWall(hand, wall, [hand.concealed[0]!.id], [target.id]);
}
