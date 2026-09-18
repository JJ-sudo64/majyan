import type { Meld, Tile } from "@majyan/core";

/**
 * 副露牌を、実際の卓と同じ「誰から鳴いたか」に応じた並び順にする。
 * gameEngine.ts側ではcalledTileを常に配列の先頭に格納しているだけなので
 * （鳴いた方向の情報はcalledFromRelativeに別途持たせてあり、tiles自体の
 * 並びは持たない）、そのまま描画すると横向き牌が常に左端に来てしまい、
 * 対面・下家から鳴いた副露の見た目がおかしくなる（上家からの鳴きだけ
 * たまたま正しく見える）。上家(1)は左端、対面(2)は中央寄り、下家(3)は
 * 右端に横向き牌が来るよう、描画直前にここで並び替える（これは副露の
 * 持ち主自身から見た並びで、本人の座席が画面上どちらを向いていても
 * 変わらない普遍的な並びである）。
 *
 * ただし対面のプレイヤーだけは、卓を挟んで自分と向き合っているため、
 * 本人から見た左右が画面上ではそのまま逆（鏡写し）になる。対面の副露を
 * 描画する側ではmirror=trueを渡し、上家(1)/下家(3)の並びを入れ替えて
 * 「対面プレイヤー本人から見た並び」を画面上でも正しく再現する
 * （指摘: 対面の副露がこちら側から見た並びのまま出てしまっていた）。
 */
export function orderMeldTilesForDisplay(meld: Meld, mirror = false): Tile[] {
  if (!meld.calledTile || meld.calledFromRelative === undefined) return meld.tiles;
  const called = meld.tiles.find((t) => t.id === meld.calledTile!.id);
  if (!called) return meld.tiles;
  const rest = meld.tiles.filter((t) => t.id !== called.id);
  const relative = mirror
    ? meld.calledFromRelative === 1
      ? 3
      : meld.calledFromRelative === 3
        ? 1
        : meld.calledFromRelative
    : meld.calledFromRelative;
  if (relative === 1) return [called, ...rest];
  if (relative === 3) return [...rest, called];
  // 対面(2): 先頭・末尾を避けた位置（3枚のポンならちょうど中央、
  // 4枚の明槓なら2番目）に挟む。
  const insertAt = Math.min(1, rest.length);
  return [...rest.slice(0, insertAt), called, ...rest.slice(insertAt)];
}

/** 副露1つを描画する際の牌1枚ぶんの並び。通常は単独の牌だが、加槓だけは
    「元のポンの横向き牌」+「後から重ねた4枚目」の2枚1組になる。 */
export type MeldSlot =
  | { kind: "tile"; tile: Tile; rotated: boolean; faceDown: boolean }
  | { kind: "stack"; base: Tile; added: Tile };

/**
 * 副露を実際の卓の並び・見た目に合わせて描画用のスロット列へ変換する。
 * Hand.tsx（自分）・OpponentArea.tsx（他家）・ScoreResult.tsx（和了結果）の
 * 3箇所で同じロジックが個別に重複しており、そのうち加槓の見せ方だけが
 * どこも「4枚をただ横一列に並べる」ままで、大明槓（他家から鳴いた槓）と
 * 見分けがつかない見た目になっていた（指摘の原因）。実際の卓では加槓は
 * 元のポンで横向きにした牌の上に4枚目を重ねて置くため、ここではその1枚を
 * "stack"としてまとめて返し、呼び出し側は重ねて描画する。
 */
export function meldDisplaySlots(meld: Meld, mirror = false): MeldSlot[] {
  if (meld.type === "kakan" && meld.addedKanTile) {
    const addedId = meld.addedKanTile.id;
    const baseTiles = meld.tiles.filter((t) => t.id !== addedId);
    const ordered = orderMeldTilesForDisplay({ ...meld, tiles: baseTiles }, mirror);
    return ordered.map((t) =>
      meld.calledTile?.id === t.id
        ? { kind: "stack", base: t, added: meld.addedKanTile! }
        : { kind: "tile", tile: t, rotated: false, faceDown: false },
    );
  }
  const ordered = orderMeldTilesForDisplay(meld, mirror);
  return ordered.map((t, i) => ({
    kind: "tile",
    tile: t,
    rotated: meld.calledTile?.id === t.id,
    // 暗槓は実際の卓と同じく両端の2枚を伏せる。
    faceDown: meld.type === "ankan" && (i === 0 || i === ordered.length - 1),
  }));
}
