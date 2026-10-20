import type { PlayerIndex } from "../actions.js";
import type { RoundState } from "../gameState.js";
import type { TileCode } from "../tiles.js";
import { nextTileForDora } from "../tiles.js";
import { removeTileFromHand } from "../hand.js";
import { bestShantenAfterDiscard, calcShanten } from "../shanten.js";
import { doraIndicators } from "../wall.js";

/**
 * 強い難易度（Lv4以上）のCPUが、必殺技を「いつ使うか」。弱い難易度は従来通り
 * 使えるなら即使う（cpuPlayer.ts）。技ごとに、使うと得な場面だけに絞る。
 *
 * ここで見るのは「今この手番で使うか」だけで、使えるか（ゲージ・条件）は
 * 呼び出し側（canUseSkill）が先に確かめている。
 */

/** 手番で引いた牌が、向聴数を進めたか（引く前の13枚より、今の14枚から最善に切った後が良いか）。 */
function drawImprovedHand(round: RoundState, seat: PlayerIndex): boolean {
  const p = round.players[seat]!;
  const drawn = round.lastDrawnTile;
  if (!drawn) return true;
  const before = calcShanten(removeTileFromHand(p.hand, drawn.id).hand);
  return bestShantenAfterDiscard(p.hand) < before;
}

function handShantenAfterBestDiscard(round: RoundState, seat: PlayerIndex): number {
  return bestShantenAfterDiscard(round.players[seat]!.hand);
}

function anyOpponentRiichi(round: RoundState, seat: PlayerIndex): boolean {
  return round.players.some((pl, i) => i !== seat && pl.riichi);
}

function holdsValueTile(round: RoundState, seat: PlayerIndex): boolean {
  const doraCodes = new Set<TileCode>(doraIndicators(round.wall).map(nextTileForDora));
  return round.players[seat]!.hand.concealed.some((t) => t.isRed === true || doraCodes.has(t.code));
}

/** その必殺技を、いま使うべきか。 */
export function shouldUseSkillNow(round: RoundState, seat: PlayerIndex): boolean {
  const characterId = round.characterIds[seat];
  const p = round.players[seat]!;
  switch (characterId) {
    // 今引いた牌を引き直す／よい牌に替える技: 引いた牌が役に立たない時に使う。
    case "nagi":
    case "kaede":
      return !drawImprovedHand(round, seat);
    // 手番を安全にやり過ごす技: 他家のリーチに対して、引いた牌も役に立たない時に使う。
    case "sena":
      return anyOpponentRiichi(round, seat) && !drawImprovedHand(round, seat);
    // 他家の手牌が見える技: 誰かがリーチしている時、または自分が勝負手の時。
    case "kagerou":
      return anyOpponentRiichi(round, seat) || handShantenAfterBestDiscard(round, seat) <= 1;
    // 待ちの残り枚数・嶺上・連続行動など、勝負手になってから効く技。
    case "subaru":
    case "toki":
    case "zeno":
      return handShantenAfterBestDiscard(round, seat) <= 1;
    // ドラを切るたびに有効牌を引ける技: 切れるドラ（赤）を持っている時。
    case "koki":
      return holdsValueTile(round, seat);
    // 他家のリーチに対する盾: リーチ者が出てから。
    case "takaharu":
      return anyOpponentRiichi(round, seat);
    // 鳴いても役が下がらない技: 鳴いている手、または鳴きを前提にした遅い手で使う。
    case "nannan":
      return p.hand.melds.length >= 1 || handShantenAfterBestDiscard(round, seat) >= 2;
    default:
      return true;
  }
}

/** カリンの「借り物競争」で借りる相手の優先順位（上ほど使うと得な技）。 */
const BORROW_PREFERENCE = [
  "zeno",
  "hiiragi",
  "koki",
  "nagi",
  "kaede",
  "subaru",
  "kagerou",
  "takaharu",
  "mirai",
  "toki",
  "sena",
  "masato",
];

/** 借りられる相手のうち、一番得な技の持ち主を選ぶ。優先順位に無いキャラは最後。 */
export function pickBorrowTarget(round: RoundState, targets: PlayerIndex[]): PlayerIndex {
  const rank = (t: PlayerIndex) => {
    const i = BORROW_PREFERENCE.indexOf(round.characterIds[t] ?? "");
    return i === -1 ? BORROW_PREFERENCE.length : i;
  };
  return [...targets].sort((a, b) => rank(a) - rank(b))[0]!;
}
