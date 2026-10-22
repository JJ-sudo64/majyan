import type { TileCode } from "../tiles.js";
import { numberOf, suitOf, isTerminalOrHonor, nextTileForDora } from "../tiles.js";
import { removeTileFromHand, allHandTileCodes, type Hand, type Meld } from "../hand.js";
import { calcShanten, bestShantenAfterDiscard } from "../shanten.js";
import { doraIndicators } from "../wall.js";
import { seatWindOf, type RoundState } from "../gameState.js";
import { CHARACTERS } from "../characters.js";
import type { GameAction, PlayerIndex } from "../actions.js";
import { chooseStrongDiscard, shouldSkipRiichi, strongCallAllowed, type StrongProfile } from "./strongAi.js";
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
  /** 受け入れ枚数・押し引きまで見る打牌選択（strongAi.ts）。無ければ従来の「向聴数→ドラ/役牌→端字牌」。 */
  strong?: StrongProfile;
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
    // 牌効率（受け入れ枚数）で切る。降り方は現物だけを安全とする簡単なもの。
    strong: { pushAtOneShanten: false, detailedDanger: false, smartRiichi: false, smartCalls: false, watchOpenHands: false, scoreAware: false, traitAware: false },
  },
  4: {
    mistakeRate: 0,
    valueAware: true,
    defenseFromShanten: 1,
    defenseQuality: "genbutsu",
    riichiConsidersValue: false,
    callSelectivity: true,
    strong: { pushAtOneShanten: false, detailedDanger: true, smartRiichi: false, smartCalls: true, watchOpenHands: false, scoreAware: false, traitAware: false },
  },
  5: {
    mistakeRate: 0,
    valueAware: true,
    defenseFromShanten: 1,
    defenseQuality: "suji",
    riichiConsidersValue: true,
    callSelectivity: true,
    strong: { pushAtOneShanten: true, detailedDanger: true, smartRiichi: true, smartCalls: true, watchOpenHands: true, scoreAware: true, traitAware: true },
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

/** 南南の「ルール変更」中（鳴いても食い下がらず、平和・一盃口も付く）に、鳴いた手が
    それらの役に届く見込みがあるか（hasPlausibleYakuOpenの追加分）。
    - 平和・一盃口・三色同順・一気通貫: 鳴きがチーだけなら順子手のまま狙える
    - 混一色・清一色: 鳴いた面子が1色（＋字牌）で、手全体の8割以上がその色と字牌
    - 混全帯幺九・純全帯幺九: 鳴いた面子がすべて么九牌を含み、手牌の7割以上が么九牌か
      么九牌と順子を組める牌（1〜3・7〜9） */
function hasPlausibleRuleChangeYaku(hand: Hand): boolean {
  const calls = hand.melds.filter((m) => m.type !== "ankan");
  if (calls.every((m) => m.type === "chi")) return true;

  const allCodes = allHandTileCodes(hand);
  const callSuits = new Set(calls.flatMap((m) => m.tiles.map((t) => suitOf(t.code))).filter((s) => s !== "z"));
  if (callSuits.size <= 1) {
    const suitCounts = new Map<string, number>();
    for (const c of allCodes) if (suitOf(c) !== "z") suitCounts.set(suitOf(c), (suitCounts.get(suitOf(c)) ?? 0) + 1);
    const mainSuit = [...callSuits][0] ?? [...suitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const inFlush = allCodes.filter((c) => suitOf(c) === "z" || suitOf(c) === mainSuit).length;
    if (inFlush >= allCodes.length * 0.8) return true;
  }

  if (calls.every((m) => m.tiles.some((t) => isTerminalOrHonor(t.code)))) {
    const outside = hand.concealed.filter((t) => isOutsideLeaning(t.code)).length;
    if (outside >= hand.concealed.length * 0.7) return true;
  }
  return false;
}

/** 南南の「ルール変更」中に、打牌で寄せていく方向。手全体（副露を含む）の8割以上が
    1色＋字牌なら染め手（その色）、そうでなく手牌の7割以上が端寄り（1〜3・7〜9・字牌）
    ならチャンタ、どちらでもなければnull（平和・三色・一通は通常の牌効率のままで十分）。 */
type RuleChangePlan = { kind: "flush"; suit: string } | { kind: "outside" } | null;

function isOutsideLeaning(code: TileCode): boolean {
  return isTerminalOrHonor(code) || numberOf(code) <= 3 || numberOf(code) >= 7;
}

function ruleChangePlan(hand: Hand): RuleChangePlan {
  const allCodes = allHandTileCodes(hand);
  const suitCounts = new Map<string, number>();
  for (const c of allCodes) if (suitOf(c) !== "z") suitCounts.set(suitOf(c), (suitCounts.get(suitOf(c)) ?? 0) + 1);
  const mainSuit = [...suitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (mainSuit) {
    const inFlush = allCodes.filter((c) => suitOf(c) === "z" || suitOf(c) === mainSuit).length;
    if (inFlush >= allCodes.length * 0.8) return { kind: "flush", suit: mainSuit };
  }
  const outside = hand.concealed.filter((t) => isOutsideLeaning(t.code)).length;
  if (outside >= hand.concealed.length * 0.7) return { kind: "outside" };
  return null;
}

/** ruleChangePlanの方向に沿って、残しておきたい牌か。 */
function keepsRuleChangePlan(code: TileCode, plan: RuleChangePlan): boolean {
  if (!plan) return false;
  if (plan.kind === "flush") return suitOf(code) === "z" || suitOf(code) === plan.suit;
  return isOutsideLeaning(code);
}

/** ポン/チー/大明槓した結果、タンヤオ・役牌のどちらかにまだ届く見込みがあるか（役なし開手を避けるための簡易チェック）。
    南南の「ルール変更」中は、鳴いても付くようになる役（平和・混一色・チャンタ等）も見込みに数える。 */
function hasPlausibleYakuOpen(hand: Hand, round: RoundState, player: PlayerIndex): boolean {
  const allCodes = allHandTileCodes(hand);
  if (allCodes.every((c) => !isTerminalOrHonor(c))) return true;
  if (round.players[player].ruleChangeActive && hasPlausibleRuleChangeYaku(hand)) return true;

  if (hand.melds.some((m) => m.type !== "chi" && isYakuhaiCode(m.tiles[0]!.code, round, player))) return true;

  const counts = new Map<TileCode, number>();
  for (const t of hand.concealed) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
  for (const [code, count] of counts) {
    if (count >= 2 && isYakuhaiCode(code, round, player)) return true;
  }
  return false;
}

/** 他家の手牌が見えている時（handsRevealedToが自分）、聴牌している他家の待ち牌の集合。
    見えていなければ空。 */
function revealedWaitingCodes(round: RoundState, player: PlayerIndex): Set<TileCode> {
  const codes = new Set<TileCode>();
  if (round.handsRevealedTo !== player) return codes;
  round.players.forEach((pl, i) => {
    if (i === player) return;
    for (const code of getWaitingTiles(pl.hand)) codes.add(code);
  });
  return codes;
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

  const riichiCandidates = canRiichi(round, player) ? riichiCandidateTileIds(round, player) : [];
  // Lv5は、待ちが薄い・追っかけで安手などの時はリーチせずに（ツモ和了は付く）手を進める。
  const skipRiichi =
    profile.strong?.smartRiichi === true &&
    riichiCandidates.length > 0 &&
    riichiCandidates.every((id) => shouldSkipRiichi(round, player, removeTileFromHand(p.hand, id).hand));
  if (!skipRiichi && riichiCandidates.length > 0) {
    const candidates = riichiCandidates;
    {
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

  // 偵察・透視の術で他家の手牌が見えている間は、聴牌している相手の当たり牌を避ける。
  const revealedWaits = revealedWaitingCodes(round, player);
  const discardable = p.hand.concealed.filter((t) => !revealedWaits.has(t.code));
  // 切れる牌が全部当たり牌なら、避けようがないので普段通りに選ぶ。
  const candidates = discardable.length > 0 ? discardable : p.hand.concealed;

  if (profile.strong && !p.ruleChangeActive) {
    bestTileId = chooseStrongDiscard(round, player, candidates, profile.strong).tileId;
  } else if (wantSafety) {
    let bestSafetyTier = -1;
    for (const t of candidates) {
      const tier = safetyTier(t.code, riichiOpponentsDiscards, profile.defenseQuality);
      if (tier > bestSafetyTier) {
        bestSafetyTier = tier;
        bestTileId = t.id;
      }
    }
  } else {
    const doraCodes = profile.valueAware ? computeDoraCodes(round) : null;
    // 南南の「ルール変更」中は、シャンテン数が同じ打牌の中で染め手・チャンタに
    // 寄せる（Lv3以上。ドラ・役牌の温存よりは優先度を下げる）。
    const plan = profile.valueAware && p.ruleChangeActive ? ruleChangePlan(p.hand) : null;
    let bestPenalty = Infinity;
    for (const t of candidates) {
      const { hand: rest } = removeTileFromHand(p.hand, t.id);
      const shanten = calcShanten(rest);
      const terminalOrHonor = isTerminalOrHonor(t.code);
      const sameCodeCount = p.hand.concealed.filter((x) => x.code === t.code).length;
      const isValuable =
        doraCodes !== null &&
        (t.isRed === true || doraCodes.has(t.code) || (sameCodeCount >= 2 && isYakuhaiCode(t.code, round, player)));
      // シャンテン数の差(1000単位)を最優先し、その中でドラ/役牌温存(10点)、
      // 「ルール変更」中の染め手・チャンタへの寄せ(5点)、さらにその中で
      // 端牌/字牌優先(1点)、という優先順位になるよう重みを分離する。
      // 寄せている間は端牌/字牌優先をやめる（染め手の字牌・チャンタの端牌を残すため）。
      const steering = keepsRuleChangePlan(t.code, plan) ? 5 : 0;
      const penalty = shanten * 1000 + (isValuable ? 10 : 0) + steering + (plan || terminalOrHonor ? 0 : 1);
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

/** 自分以外にライコがいて、一閃（リーチ後の一発中・ゲージ満タン）を構えているか。 */
function hasIssenThreat(round: RoundState, player: PlayerIndex): boolean {
  return round.players.some((p, i) => {
    if (i === player || !p.ippatsuActive) return false;
    const character = CHARACTERS[round.characterIds[i]!];
    return character?.skill.id === "raiko-issen" && p.skillGauge >= character.gaugeMax;
  });
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
  // Lv4・5は、ライコが一閃を構えている（リーチ後の一発中でゲージ満タン）間は、手が悪くならない鳴きなら
  // 役の見込みや安全度を問わず鳴いて、一発を消す。
  const breakIppatsu = profile.strong?.smartCalls === true && hasIssenThreat(round, player);

  const matches = hand.concealed.filter((t) => t.code === discardTile.code);
  if (matches.length >= 3 && round.kanCount < 4) {
    const [a, b, c] = matches;
    const { hand: afterA } = removeTileFromHand(hand, a!.id);
    const { hand: afterB } = removeTileFromHand(afterA, b!.id);
    const { hand: afterC } = removeTileFromHand(afterB, c!.id);
    const meld: Meld = { type: "minkan", tiles: [discardTile, a!, b!, c!] };
    const probe: Hand = { concealed: afterC.concealed, melds: [...afterC.melds, meld] };
    const yakuOk = !profile.callSelectivity || hasPlausibleYakuOpen(probe, round, player);
    if (
      (calcShanten(probe) < currentShanten && yakuOk && (!profile.strong?.smartCalls || strongCallAllowed(round, player, calcShanten(probe), probe, discardTile.code))) ||
      (breakIppatsu && calcShanten(probe) <= currentShanten)
    ) {
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
    if (
      (best < currentShanten && yakuOk && (!profile.strong?.smartCalls || strongCallAllowed(round, player, best, probe, discardTile.code))) ||
      (breakIppatsu && best <= currentShanten)
    ) {
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
      const normal = best < bestShantenAfter && yakuOk && (!profile.strong?.smartCalls || strongCallAllowed(round, player, best, probe));
      const sabotage = breakIppatsu && best <= currentShanten && (bestOption === null || best < bestShantenAfter);
      if (normal || sabotage) {
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
