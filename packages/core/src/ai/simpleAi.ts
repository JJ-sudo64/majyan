import type { TileCode } from "../tiles.js";
import { numberOf, suitOf, isTerminalOrHonor, nextTileForDora } from "../tiles.js";
import { removeTileFromHand, allHandTileCodes, type Hand, type Meld } from "../hand.js";
import { calcShanten, bestShantenAfterDiscard } from "../shanten.js";
import { doraIndicators } from "../wall.js";
import { seatWindOf, type RoundState } from "../gameState.js";
import type { GameAction, PlayerIndex } from "../actions.js";
import {
  canDeclareRon,
  canDeclareTsumo,
  canRiichi,
  riichiCandidateTileIds,
  ankanOptions,
  kakanOptions,
  getWaitingTiles,
} from "../gameEngine.js";

/**
 * CPUの強さ。1が最弱、5が最強。5段階とも「機械学習ではなくルールベースの
 * ヒューリスティックをどれだけ積み増すか」で表現する（設計はplans参照）。
 * Lv2は旧実装（難易度概念導入前のAI）と完全に同じ挙動になるようにしてある。
 */
export type AiDifficulty = 1 | 2 | 3 | 4 | 5;
export const DEFAULT_AI_DIFFICULTY: AiDifficulty = 2;

interface AiProfile {
  /** この確率で「最善の打牌」ではなく手牌から一様ランダムに1枚切る（弱いプレイヤーのミスを模す）。 */
  mistakeRate: number;
  /** シャンテン数が同点の候補が複数あるとき、ドラ・役牌の対子/刻子を崩す牌を避けるか。 */
  valueAware: boolean;
  /** 他家がリーチしていて自分のシャンテン数がこの値以上のとき、効率よりベタオリを優先する。Infinityなら降りない。 */
  defenseFromShanten: number;
  /** ベタオリ時に安全とみなす基準。genbutsu=現物のみ、suji=現物+スジ。 */
  defenseQuality: "genbutsu" | "suji";
  /** リーチ候補が複数あるとき、待り牌の種類数だけでなくドラの含有量も加味するか。 */
  riichiConsidersValue: boolean;
  /** ポン/チー/大明槓が役なし開手になる場合、鳴かずに見送るか。 */
  callSelectivity: boolean;
}

const AI_PROFILES: Record<AiDifficulty, AiProfile> = {
  1: {
    mistakeRate: 0.3,
    valueAware: false,
    defenseFromShanten: Infinity,
    defenseQuality: "genbutsu",
    riichiConsidersValue: false,
    callSelectivity: false,
  },
  2: {
    mistakeRate: 0,
    valueAware: false,
    defenseFromShanten: 2,
    defenseQuality: "genbutsu",
    riichiConsidersValue: false,
    callSelectivity: false,
  },
  3: {
    mistakeRate: 0,
    valueAware: true,
    defenseFromShanten: 2,
    defenseQuality: "genbutsu",
    riichiConsidersValue: false,
    callSelectivity: false,
  },
  4: {
    mistakeRate: 0,
    valueAware: true,
    defenseFromShanten: 1,
    defenseQuality: "genbutsu",
    riichiConsidersValue: false,
    callSelectivity: true,
  },
  5: {
    mistakeRate: 0,
    valueAware: true,
    defenseFromShanten: 1,
    defenseQuality: "suji",
    riichiConsidersValue: true,
    callSelectivity: true,
  },
};

/** 表ドラの牌コード集合（実際にドラとして加算される牌。表示牌そのものではない）。 */
function computeDoraCodes(round: RoundState): Set<TileCode> {
  return new Set(doraIndicators(round.wall).map(nextTileForDora));
}

/** 赤ドラ含め、渡した牌一覧に含まれるドラの点数（通常ドラ1枚=1点、赤ドラも1点、両方満たせば2点）。 */
function countValuePoints(tiles: { code: TileCode; isRed?: boolean }[], doraCodes: Set<TileCode>): number {
  let count = 0;
  for (const t of tiles) {
    if (doraCodes.has(t.code)) count++;
    if (t.isRed) count++;
  }
  return count;
}

/** 三元牌、または指定プレイヤーの自風・場風にあたる役牌かどうか。 */
function isYakuhaiCode(code: TileCode, round: RoundState, player: PlayerIndex): boolean {
  if (!code.endsWith("z")) return false;
  const n = numberOf(code);
  if (n >= 5) return true;
  const seatWind = seatWindOf(round.dealerSeat, player);
  return n === seatWind || n === round.roundWind;
}

/** 相手が4を切っていれば1・7もある程度安全、5切りなら2・8、6切りなら3・9…という簡易スジ判定。
    字牌にスジの概念は無いので現物のみ。中張牌（4〜6付近）は両側のスジが揃って初めて対象にする。 */
function isSuji(code: TileCode, discards: TileCode[]): boolean {
  if (code.endsWith("z")) return false;
  const n = numberOf(code);
  const suit = suitOf(code);
  const has = (m: number) => discards.some((d) => d === (`${m}${suit}` as TileCode));
  if (n <= 3) return has(n + 3);
  if (n >= 7) return has(n - 3);
  return has(n - 3) && has(n + 3);
}

/** 安全度のランク（大きいほど安全）。genbutsu基準では現物のみ2、それ以外は0。
    suji基準ではさらにスジを1として扱う。 */
function safetyTier(code: TileCode, opponentDiscardsByPlayer: TileCode[][], quality: "genbutsu" | "suji"): number {
  const allDiscards = opponentDiscardsByPlayer.flat();
  if (allDiscards.includes(code)) return 2;
  if (quality === "suji" && isSuji(code, allDiscards)) return 1;
  return 0;
}

/** ポン/チー/大明槓した結果、タンヤオ・役牌のどちらかにまだ届く見込みがあるか（役なし開手を避けるための簡易チェック）。 */
function hasPlausibleYakuOpen(hand: Hand, round: RoundState, player: PlayerIndex): boolean {
  const allCodes = allHandTileCodes(hand);
  if (allCodes.every((c) => !isTerminalOrHonor(c))) return true;

  if (hand.melds.some((m) => m.type !== "chi" && isYakuhaiCode(m.tiles[0]!.code, round, player))) return true;

  const counts = new Map<TileCode, number>();
  for (const t of hand.concealed) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
  for (const [code, count] of counts) {
    if (count >= 2 && isYakuhaiCode(code, round, player)) return true;
  }
  return false;
}

/** 自分の手番（打牌選択）の意思決定 */
export function decideTurnAction(round: RoundState, player: PlayerIndex, difficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY): GameAction {
  const profile = AI_PROFILES[difficulty];
  const tsumoAnalysis = canDeclareTsumo(round, player);
  if (tsumoAnalysis) return { type: "tsumo", player };

  const ankan = ankanOptions(round, player);
  if (ankan.length > 0) {
    return { type: "ankan", player, tileCode: ankan[0]! };
  }
  const kakan = kakanOptions(round, player);
  if (kakan.length > 0) {
    return { type: "kakan", player, tileId: kakan[0]! };
  }

  const p = round.players[player];

  if (p.riichi) {
    // リーチ中はツモ切りのみ許される
    return { type: "discard", player, tileId: round.lastDrawnTile!.id, tsumogiri: true };
  }

  if (canRiichi(round, player)) {
    const candidates = riichiCandidateTileIds(round, player);
    if (candidates.length > 0) {
      const doraCodes = profile.riichiConsidersValue ? computeDoraCodes(round) : null;
      let bestTileId = candidates[0]!;
      let bestScore = -Infinity;
      for (const tileId of candidates) {
        const { hand: rest } = removeTileFromHand(p.hand, tileId);
        const waits = getWaitingTiles(rest).length;
        const score = doraCodes ? waits * (1 + 0.5 * countValuePoints(rest.concealed, doraCodes)) : waits;
        if (score > bestScore) {
          bestScore = score;
          bestTileId = tileId;
        }
      }
      return { type: "riichi", player, tileId: bestTileId };
    }
  }

  const riichiOpponentsDiscards: TileCode[][] = round.players
    .filter((pl, i) => i !== player && pl.riichi)
    .map((pl) => pl.discards.map((d) => d.tile.code));
  const wantSafety = riichiOpponentsDiscards.length > 0 && calcShanten(p.hand) >= profile.defenseFromShanten;

  let bestTileId = p.hand.concealed[0]!.id;

  if (wantSafety) {
    let bestSafetyTier = -1;
    for (const t of p.hand.concealed) {
      const tier = safetyTier(t.code, riichiOpponentsDiscards, profile.defenseQuality);
      if (tier > bestSafetyTier) {
        bestSafetyTier = tier;
        bestTileId = t.id;
      }
    }
  } else {
    const doraCodes = profile.valueAware ? computeDoraCodes(round) : null;
    let bestPenalty = Infinity;
    for (const t of p.hand.concealed) {
      const { hand: rest } = removeTileFromHand(p.hand, t.id);
      const shanten = calcShanten(rest);
      const terminalOrHonor = isTerminalOrHonor(t.code);
      const sameCodeCount = p.hand.concealed.filter((x) => x.code === t.code).length;
      const isValuable =
        doraCodes !== null &&
        (t.isRed === true || doraCodes.has(t.code) || (sameCodeCount >= 2 && isYakuhaiCode(t.code, round, player)));
      // シャンテン数の差(1000単位)を最優先し、その中でドラ/役牌温存(10点)、
      // さらにその中で端牌/字牌優先(1点)、という優先順位になるよう重みを分離する。
      const penalty = shanten * 1000 + (isValuable ? 10 : 0) + (terminalOrHonor ? 0 : 1);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestTileId = t.id;
      }
    }
  }

  if (profile.mistakeRate > 0 && Math.random() < profile.mistakeRate) {
    const idx = Math.floor(Math.random() * p.hand.concealed.length);
    bestTileId = p.hand.concealed[idx]!.id;
  }

  return { type: "discard", player, tileId: bestTileId, tsumogiri: bestTileId === round.lastDrawnTile?.id };
}

/** 現在の手牌の中で「これを抜いた時にシャンテンが一番良く保てる牌」＝最も不要な
    1枚を選ぶ。通常の打牌選択と同じ基準。手牌が空ならnull。 */
function pickLeastUsefulTile(hand: Hand, round: RoundState, player: PlayerIndex, doraCodes: Set<TileCode>): string | null {
  if (hand.concealed.length === 0) return null;
  let bestTileId: string | null = null;
  let bestPenalty = Infinity;
  for (const t of hand.concealed) {
    const { hand: rest } = removeTileFromHand(hand, t.id);
    const shanten = calcShanten(rest);
    const terminalOrHonor = isTerminalOrHonor(t.code);
    const sameCodeCount = hand.concealed.filter((x) => x.code === t.code).length;
    const isValuable = t.isRed === true || doraCodes.has(t.code) || (sameCodeCount >= 2 && isYakuhaiCode(t.code, round, player));
    const penalty = shanten * 1000 + (isValuable ? 10 : 0) + (terminalOrHonor ? 0 : 1);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestTileId = t.id;
    }
  }
  return bestTileId;
}

/**
 * ルナの必殺技で得た配牌入れ替え権をCPUがどの牌に使うか決める。3枚同時に選んで
 * 同時に交換する仕様のため、ここでは実際に手牌を書き換えずローカルなHandの
 * コピー上でだけ「抜いたことにして」次の1枚を選び直す、を count回繰り返し、
 * 交換すべきcount枚をまとめて返す。難易度による強弱は設けない（配牌直後の
 * 1回きりの判断のため）。
 */
export function decideTileSwaps(round: RoundState, player: PlayerIndex, count: number): string[] {
  const doraCodes = computeDoraCodes(round);
  let hand = round.players[player].hand;
  const chosen: string[] = [];
  for (let i = 0; i < count; i++) {
    const tileId = pickLeastUsefulTile(hand, round, player, doraCodes);
    if (!tileId) break;
    chosen.push(tileId);
    hand = removeTileFromHand(hand, tileId).hand;
  }
  return chosen;
}

function findChiOptions(hand: Hand, discardTile: TileCode): [TileCode, TileCode][] {
  if (discardTile.endsWith("z")) return [];
  const n = numberOf(discardTile);
  const suit = suitOf(discardTile);
  const has = (code: TileCode) => hand.concealed.some((t) => t.code === code);
  const options: [TileCode, TileCode][] = [];
  const mk = (a: number, b: number): [TileCode, TileCode] => [`${a}${suit}` as TileCode, `${b}${suit}` as TileCode];
  if (n >= 3 && has(mk(n - 2, n - 1)[0]) && has(mk(n - 2, n - 1)[1])) options.push(mk(n - 2, n - 1));
  if (n >= 2 && n <= 8 && has(mk(n - 1, n + 1)[0]) && has(mk(n - 1, n + 1)[1])) options.push(mk(n - 1, n + 1));
  if (n <= 7 && has(mk(n + 1, n + 2)[0]) && has(mk(n + 1, n + 2)[1])) options.push(mk(n + 1, n + 2));
  return options;
}

/** 他家の捨て牌に対する応答（ロン・ポン・カン・チー・スキップ）の意思決定 */
export function decideCallResponse(round: RoundState, player: PlayerIndex, difficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY): GameAction {
  const profile = AI_PROFILES[difficulty];
  const window = round.pendingCallWindow!;
  const discardTile = window.discardTile;

  const ronAnalysis = canDeclareRon(round, player, discardTile.code, window.discarderIndex, window.isChankan);
  if (ronAnalysis) return { type: "ron", player };

  if (window.isChankan) return { type: "skip", player };

  const hand = round.players[player].hand;
  // リーチ後は手牌が固定されるため、ロン以外の宣言（チー/ポン/カン）はできない。
  if (round.players[player].riichi) return { type: "skip", player };
  const currentShanten = calcShanten(hand);

  const matches = hand.concealed.filter((t) => t.code === discardTile.code);
  if (matches.length >= 3) {
    const [a, b, c] = matches;
    const { hand: afterA } = removeTileFromHand(hand, a!.id);
    const { hand: afterB } = removeTileFromHand(afterA, b!.id);
    const { hand: afterC } = removeTileFromHand(afterB, c!.id);
    const meld: Meld = { type: "minkan", tiles: [discardTile, a!, b!, c!] };
    const probe: Hand = { concealed: afterC.concealed, melds: [...afterC.melds, meld] };
    const yakuOk = !profile.callSelectivity || hasPlausibleYakuOpen(probe, round, player);
    if (calcShanten(probe) < currentShanten && yakuOk) {
      return { type: "minkan", player, usedHandTileIds: [a!.id, b!.id, c!.id] };
    }
  }

  if (matches.length >= 2) {
    const [a, b] = matches;
    const { hand: afterA } = removeTileFromHand(hand, a!.id);
    const { hand: afterB } = removeTileFromHand(afterA, b!.id);
    const meld: Meld = { type: "pon", tiles: [discardTile, a!, b!] };
    const probe: Hand = { concealed: afterB.concealed, melds: [...afterB.melds, meld] };
    const best = bestShantenAfterDiscard(probe);
    const yakuOk = !profile.callSelectivity || hasPlausibleYakuOpen(probe, round, player);
    if (best < currentShanten && yakuOk) {
      return { type: "pon", player, usedHandTileIds: [a!.id, b!.id] };
    }
  }

  const isNextSeat = ((window.discarderIndex + 1) % 4) === player;
  if (isNextSeat) {
    const options = findChiOptions(hand, discardTile.code);
    let bestOption: [TileCode, TileCode] | null = null;
    let bestShantenAfter = currentShanten;
    for (const [c1, c2] of options) {
      const t1 = hand.concealed.find((t) => t.code === c1)!;
      const t2 = hand.concealed.find((t) => t.code === c2 && t.id !== t1.id)!;
      const { hand: after1 } = removeTileFromHand(hand, t1.id);
      const { hand: after2 } = removeTileFromHand(after1, t2.id);
      const meld: Meld = { type: "chi", tiles: [discardTile, t1, t2] };
      const probe: Hand = { concealed: after2.concealed, melds: [...after2.melds, meld] };
      const best = bestShantenAfterDiscard(probe);
      const yakuOk = !profile.callSelectivity || hasPlausibleYakuOpen(probe, round, player);
      if (best < bestShantenAfter && yakuOk) {
        bestShantenAfter = best;
        bestOption = [t1.code, t2.code];
      }
    }
    if (bestOption) {
      const t1 = hand.concealed.find((t) => t.code === bestOption![0])!;
      const t2 = hand.concealed.find((t) => t.code === bestOption![1] && t.id !== t1.id)!;
      const combined = [discardTile.code, t1.code, t2.code].sort((a, b) => numberOf(a) - numberOf(b)) as [TileCode, TileCode, TileCode];
      return { type: "chi", player, tileCodes: combined, usedHandTileIds: [t1.id, t2.id] };
    }
  }

  return { type: "skip", player };
}
