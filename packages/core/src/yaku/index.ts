import {
  isTerminalOrHonor,
  isHonor,
  isTerminal,
  isGreenTile,
  numberOf,
  suitOf,
  type TileCode,
  type Wind,
} from "../tiles.js";
import { decomposeStandardHand, countsFromCodes, type SetGroup } from "../decompose.js";
import { allHandTileCodes, allHandTiles, type Hand, type Meld } from "../hand.js";
import { nextTileForDora } from "../tiles.js";

export interface WinContext {
  isTsumo: boolean;
  winTile: TileCode;
  seatWind: Wind;
  roundWind: Wind;
  isDealer: boolean;
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  /** 必殺技「大明立直」でオープンリーチ（手牌公開）として立直していたか。
      和了できれば「オープンリーチ」役として+3翻される。 */
  openRiichi: boolean;
  haitei: boolean;
  houtei: boolean;
  rinshan: boolean;
  chankan: boolean;
  doraIndicators: TileCode[];
  uraDoraIndicators: TileCode[];
  /** カード「小手先の一翻」「会心の二翻」で加算される翻数。ドラと同様、
      既に他に役がある和了にのみ乗る（役満には乗らない）。 */
  bonusHan: number;
}

export interface YakuResult {
  name: string;
  han: number;
}

export interface WinAnalysis {
  yaku: YakuResult[];
  han: number;
  fu: number;
  isYakuman: boolean;
  yakumanMultiplier: number;
}

type WaitType = "tanki" | "shanpon" | "kanchan" | "penchan" | "ryanmen";

interface ResolvedSet {
  kind: "sequence" | "triplet" | "kan";
  tile: TileCode; // 順子は開始牌
  concealed: boolean;
}

function windTileCode(wind: Wind): TileCode {
  return `${wind}z` as TileCode;
}

function meldToResolvedSet(meld: Meld): ResolvedSet {
  if (meld.type === "chi") {
    const sorted = [...meld.tiles].sort((a, b) => numberOf(a.code) - numberOf(b.code));
    return { kind: "sequence", tile: sorted[0]!.code, concealed: false };
  }
  if (meld.type === "pon") return { kind: "triplet", tile: meld.tiles[0]!.code, concealed: false };
  if (meld.type === "ankan") return { kind: "kan", tile: meld.tiles[0]!.code, concealed: true };
  return { kind: "kan", tile: meld.tiles[0]!.code, concealed: false }; // minkan / kakan
}

function groupToResolvedSet(g: SetGroup): ResolvedSet {
  return { kind: g.type === "triplet" ? "triplet" : "sequence", tile: g.tile, concealed: true };
}

function classifyWait(winTile: TileCode, block: ResolvedSet, isPairBlock: boolean): WaitType {
  if (isPairBlock) return "tanki";
  if (block.kind !== "sequence") return "shanpon";
  const startNum = numberOf(block.tile);
  const winNum = numberOf(winTile);
  const pos = winNum - startNum;
  if (pos === 1) return "kanchan";
  if (pos === 2 && startNum === 1) return "penchan";
  if (pos === 0 && startNum === 7) return "penchan";
  return "ryanmen";
}

function containsTerminalOrHonorBlock(block: ResolvedSet): boolean {
  if (block.kind === "sequence") {
    const n = numberOf(block.tile);
    return n === 1 || n === 7;
  }
  return isTerminalOrHonor(block.tile);
}

function containsHonorBlock(block: ResolvedSet): boolean {
  if (block.kind === "sequence") return false;
  return isHonor(block.tile);
}

function isDragon(code: TileCode): boolean {
  return isHonor(code) && numberOf(code) >= 5 && numberOf(code) <= 7;
}
function isWind(code: TileCode): boolean {
  return isHonor(code) && numberOf(code) >= 1 && numberOf(code) <= 4;
}

interface Candidate {
  sets: ResolvedSet[]; // 4 blocks (標準形) or 7 pairs (七対子)
  pair: TileCode | null; // 七対子には無し
  isChiitoitsu: boolean;
  winningBlockIndex: number; // sets配列中、和了牌が含まれるインデックス。雀頭の場合は-1
}

function findWinningBlockIndex(sets: ResolvedSet[], winTile: TileCode): number {
  // 同じ牌の面子が複数あり得るため、雀頭でなければ最初に一致したブロックとする
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i]!;
    if (s.kind === "sequence") {
      const n = numberOf(s.tile);
      const suit = suitOf(s.tile);
      const winN = numberOf(winTile);
      const winSuit = suitOf(winTile);
      if (suit === winSuit && winN >= n && winN <= n + 2) return i;
    } else {
      if (s.tile === winTile) return i;
    }
  }
  return -1;
}

function countDora(allCodes: TileCode[], indicators: TileCode[]): number {
  if (indicators.length === 0) return 0;
  let count = 0;
  const targets = indicators.map(nextTileForDora);
  for (const code of allCodes) {
    for (const t of targets) if (code === t) count++;
  }
  return count;
}

/** 赤ドラ（5m/5p/5sの赤牌）の枚数。表ドラ・裏ドラとは独立に常に加算される。 */
function countAkaDora(hand: Hand): number {
  return allHandTiles(hand).filter((t) => t.isRed).length;
}

function evaluateYakuman(
  sets: ResolvedSet[],
  pair: TileCode | null,
  isChiitoitsu: boolean,
  context: WinContext,
  allCodes: TileCode[],
  winningBlockIndex: number,
): YakuResult[] {
  const results: YakuResult[] = [];

  const allTerminalOrHonor = allCodes.every(isTerminalOrHonor);
  const allHonor = allCodes.every(isHonor);
  const allGreen = allCodes.every(isGreenTile);
  const allTerminal = allCodes.every(isTerminal);

  if (allHonor) results.push({ name: "字一色", han: 13 });
  if (allGreen) results.push({ name: "緑一色", han: 13 });
  if (allTerminal) results.push({ name: "清老頭", han: 13 });

  if (!isChiitoitsu) {
    const tripletsOrKans = sets.filter((s) => s.kind !== "sequence");

    // 大三元
    const dragonSets = tripletsOrKans.filter((s) => isDragon(s.tile));
    if (dragonSets.length === 3) results.push({ name: "大三元", han: 13 });

    // 大四喜・小四喜
    const windSets = tripletsOrKans.filter((s) => isWind(s.tile));
    if (windSets.length === 4) {
      results.push({ name: "大四喜", han: 13 * 2 });
    } else if (windSets.length === 3 && pair && isWind(pair)) {
      results.push({ name: "小四喜", han: 13 });
    }

    // 四暗刻
    const winningIsPairBlock = winningBlockIndex === -1;
    const ankoCount = tripletsOrKans.filter((s, i) => {
      if (s.kind === "kan") return s.concealed;
      // triplet: ロンで完成した組は暗刻扱いしない
      const isRonCompleted = !context.isTsumo && i === winningBlockIndex;
      return s.concealed && !isRonCompleted;
    }).length;
    if (ankoCount === 4) {
      const waitType = classifyWait(context.winTile, sets[winningBlockIndex] ?? sets[0]!, winningIsPairBlock);
      results.push({ name: waitType === "tanki" ? "四暗刻単騎" : "四暗刻", han: waitType === "tanki" ? 26 : 13 });
    }
  }

  return results;
}

function evaluateKokushi(hand: Hand, context: WinContext): WinAnalysis | null {
  if (hand.melds.length !== 0) return null;
  const codes = allHandTileCodes(hand);
  if (codes.length !== 14) return null;
  const KOKUSHI: TileCode[] = ["1m", "9m", "1p", "9p", "1s", "9s", "1z", "2z", "3z", "4z", "5z", "6z", "7z"];
  const counts = countsFromCodes(codes);
  const kokushiIdxCounts: number[] = KOKUSHI.map((c) => counts[require_index(c)] ?? 0);
  const total = kokushiIdxCounts.reduce((a: number, b) => a + b, 0);
  const nonKokushiTiles = codes.length - total;
  if (nonKokushiTiles !== 0) return null;
  const kinds = kokushiIdxCounts.filter((c) => (c ?? 0) >= 1).length;
  const hasPair = kokushiIdxCounts.some((c) => (c ?? 0) >= 2);
  if (kinds !== 13 || !hasPair) return null;

  // 13面待ちかどうか: 和了牌を1枚除いた13枚が既に13種類すべて揃っているか
  const preWinCodes = codes.slice();
  const idx = preWinCodes.indexOf(context.winTile);
  preWinCodes.splice(idx, 1);
  const preWinKinds = new Set(preWinCodes).size;
  const isThirteenWait = preWinKinds === 13;

  return {
    yaku: [{ name: isThirteenWait ? "国士無双十三面" : "国士無双", han: isThirteenWait ? 26 : 13 }],
    han: isThirteenWait ? 26 : 13,
    fu: 0,
    isYakuman: true,
    yakumanMultiplier: isThirteenWait ? 2 : 1,
  };
}

function require_index(code: TileCode): number {
  const all = [
    "1m","2m","3m","4m","5m","6m","7m","8m","9m",
    "1p","2p","3p","4p","5p","6p","7p","8p","9p",
    "1s","2s","3s","4s","5s","6s","7s","8s","9s",
    "1z","2z","3z","4z","5z","6z","7z",
  ];
  return all.indexOf(code);
}

function evaluateRegularYaku(
  sets: ResolvedSet[],
  pair: TileCode,
  isOpen: boolean,
  context: WinContext,
  allCodes: TileCode[],
  winningBlockIndex: number,
): YakuResult[] {
  const results: YakuResult[] = [];
  const isPairWin = winningBlockIndex === -1;
  const winningBlock = isPairWin ? { kind: "triplet" as const, tile: pair, concealed: true } : sets[winningBlockIndex]!;
  const waitType = classifyWait(context.winTile, winningBlock, isPairWin);

  if (context.doubleRiichi) results.push({ name: "ダブル立直", han: 2 });
  else if (context.riichi) results.push({ name: "立直", han: 1 });
  if (context.ippatsu && (context.riichi || context.doubleRiichi)) results.push({ name: "一発", han: 1 });
  if (context.openRiichi && (context.riichi || context.doubleRiichi)) results.push({ name: "オープンリーチ", han: 3 });
  if (!isOpen && context.isTsumo) results.push({ name: "門前清自摸和", han: 1 });
  if (context.haitei && context.isTsumo) results.push({ name: "海底摸月", han: 1 });
  if (context.houtei && !context.isTsumo) results.push({ name: "河底撈魚", han: 1 });
  if (context.rinshan) results.push({ name: "嶺上開花", han: 1 });
  if (context.chankan) results.push({ name: "槍槓", han: 1 });

  const allSequences = sets.every((s) => s.kind === "sequence");
  const pairIsYakuhai = isDragon(pair) || pair === windTileCode(context.seatWind) || pair === windTileCode(context.roundWind);
  if (!isOpen && allSequences && !pairIsYakuhai && waitType === "ryanmen") {
    results.push({ name: "平和", han: 1 });
  }

  if (allCodes.every((c) => !isTerminalOrHonor(c))) {
    results.push({ name: "断幺九", han: 1 });
  }

  for (const s of sets) {
    if (s.kind === "sequence") continue;
    if (isDragon(s.tile)) {
      const label = s.tile === "5z" ? "白" : s.tile === "6z" ? "發" : "中";
      results.push({ name: `役牌:${label}`, han: 1 });
    }
    if (s.tile === windTileCode(context.seatWind)) results.push({ name: "自風牌", han: 1 });
    if (s.tile === windTileCode(context.roundWind)) results.push({ name: "場風牌", han: 1 });
  }

  if (!isOpen) {
    const seqTiles = sets.filter((s) => s.kind === "sequence").map((s) => s.tile);
    const dupCount: Map<TileCode, number> = new Map();
    for (const t of seqTiles) dupCount.set(t, (dupCount.get(t) ?? 0) + 1);
    const pairsOfDup = [...dupCount.values()].filter((c) => c >= 2).length;
    if (pairsOfDup >= 2) results.push({ name: "二盃口", han: 3 });
    else if (pairsOfDup === 1) results.push({ name: "一盃口", han: 1 });
  }

  // 三色同順
  {
    const seqByStart: Map<number, Set<string>> = new Map();
    for (const s of sets) {
      if (s.kind !== "sequence") continue;
      const n = numberOf(s.tile);
      const suit = suitOf(s.tile);
      if (!seqByStart.has(n)) seqByStart.set(n, new Set());
      seqByStart.get(n)!.add(suit);
    }
    const hasSanshoku = [...seqByStart.values()].some((s) => s.has("m") && s.has("p") && s.has("s"));
    if (hasSanshoku) results.push({ name: "三色同順", han: isOpen ? 1 : 2 });
  }

  // 三色同刻
  {
    const setByNum: Map<number, Set<string>> = new Map();
    for (const s of sets) {
      if (s.kind === "sequence") continue;
      if (isHonor(s.tile)) continue;
      const n = numberOf(s.tile);
      const suit = suitOf(s.tile);
      if (!setByNum.has(n)) setByNum.set(n, new Set());
      setByNum.get(n)!.add(suit);
    }
    const hasSanshokuDoukou = [...setByNum.values()].some((s) => s.has("m") && s.has("p") && s.has("s"));
    if (hasSanshokuDoukou) results.push({ name: "三色同刻", han: 2 });
  }

  // 一気通貫
  {
    const seqStartsBySuit: Map<string, Set<number>> = new Map();
    for (const s of sets) {
      if (s.kind !== "sequence") continue;
      const suit = suitOf(s.tile);
      if (!seqStartsBySuit.has(suit)) seqStartsBySuit.set(suit, new Set());
      seqStartsBySuit.get(suit)!.add(numberOf(s.tile));
    }
    const hasIttsuu = [...seqStartsBySuit.values()].some((set) => set.has(1) && set.has(4) && set.has(7));
    if (hasIttsuu) results.push({ name: "一気通貫", han: isOpen ? 1 : 2 });
  }

  // チャンタ・純全帯幺九・混老頭
  {
    const blocks: ResolvedSet[] = [...sets, { kind: "triplet", tile: pair, concealed: true }];
    const chantaOk = blocks.every(containsTerminalOrHonorBlock);
    const junchanOk = chantaOk && !blocks.some(containsHonorBlock);
    const allTripletsOrKan = sets.every((s) => s.kind !== "sequence");
    if (chantaOk && allTripletsOrKan) {
      // 全て刻子/対子で構成され、かつ全牌が么九牌 -> 混老頭（清一色相当の全牌么九は上位でyakuman判定済み）
      results.push({ name: "混老頭", han: 2 });
    } else if (junchanOk) {
      results.push({ name: "純全帯幺九", han: isOpen ? 2 : 3 });
    } else if (chantaOk) {
      results.push({ name: "混全帯幺九", han: isOpen ? 1 : 2 });
    }
  }

  if (sets.every((s) => s.kind !== "sequence")) {
    results.push({ name: "対々和", han: 2 });
  }

  // 三暗刻
  {
    const ankoCount = sets.filter((s, i) => {
      if (s.kind === "sequence") return false;
      if (s.kind === "kan") return s.concealed;
      const isRonCompleted = !context.isTsumo && i === winningBlockIndex;
      return s.concealed && !isRonCompleted;
    }).length;
    if (ankoCount === 3) results.push({ name: "三暗刻", han: 2 });
  }

  // 小三元
  {
    const dragonSets = sets.filter((s) => s.kind !== "sequence" && isDragon(s.tile));
    if (dragonSets.length === 2 && isDragon(pair)) results.push({ name: "小三元", han: 2 });
  }

  // 混一色・清一色
  {
    const suits = new Set(allCodes.map((c) => suitOf(c)));
    const numberedSuits = new Set([...suits].filter((s) => s !== "z"));
    const hasHonor = suits.has("z");
    if (numberedSuits.size === 1 && hasHonor) results.push({ name: "混一色", han: isOpen ? 2 : 3 });
    else if (numberedSuits.size === 1 && !hasHonor) results.push({ name: "清一色", han: isOpen ? 5 : 6 });
  }

  return results;
}

function evaluateChiitoitsuYaku(pairs: TileCode[], context: WinContext, allCodes: TileCode[]): YakuResult[] {
  const results: YakuResult[] = [];
  if (context.doubleRiichi) results.push({ name: "ダブル立直", han: 2 });
  else if (context.riichi) results.push({ name: "立直", han: 1 });
  if (context.ippatsu && (context.riichi || context.doubleRiichi)) results.push({ name: "一発", han: 1 });
  if (context.openRiichi && (context.riichi || context.doubleRiichi)) results.push({ name: "オープンリーチ", han: 3 });
  if (context.isTsumo) results.push({ name: "門前清自摸和", han: 1 });
  if (context.haitei && context.isTsumo) results.push({ name: "海底摸月", han: 1 });
  if (context.houtei && !context.isTsumo) results.push({ name: "河底撈魚", han: 1 });

  results.push({ name: "七対子", han: 2 });

  if (allCodes.every((c) => !isTerminalOrHonor(c))) results.push({ name: "断幺九", han: 1 });

  const suits = new Set(allCodes.map((c) => suitOf(c)));
  const numberedSuits = new Set([...suits].filter((s) => s !== "z"));
  const hasHonor = suits.has("z");
  if (numberedSuits.size === 1 && hasHonor) results.push({ name: "混一色", han: 3 });
  else if (numberedSuits.size === 1 && !hasHonor) results.push({ name: "清一色", han: 6 });

  if (pairs.every((p) => isTerminalOrHonor(p))) results.push({ name: "混老頭", han: 2 });

  return results;
}

/** hand.concealed には和了牌を含めて渡すこと（ロンの場合も呼び出し側で加算してから渡す） */
export function analyzeWin(hand: Hand, context: WinContext): WinAnalysis | null {
  const allCodes = allHandTileCodes(hand);
  if (allCodes.length !== 14) return null;

  const kokushi = evaluateKokushi(hand, context);
  if (kokushi) return kokushi;

  const isOpen = hand.melds.some((m) => m.type !== "ankan");
  const candidates: Candidate[] = [];

  const setsNeeded = 4 - hand.melds.length;
  const meldSets = hand.melds.map(meldToResolvedSet);
  const concealedCodes = hand.concealed.map((t) => t.code);
  const decompositions = decomposeStandardHand(concealedCodes, setsNeeded);
  for (const d of decompositions) {
    const sets = [...meldSets, ...d.sets.map(groupToResolvedSet)];
    candidates.push({
      sets,
      pair: d.pair,
      isChiitoitsu: false,
      winningBlockIndex: findWinningBlockIndex(sets, context.winTile),
    });
  }

  if (hand.melds.length === 0) {
    const counts = countsFromCodes(concealedCodes);
    const kinds = counts.filter((c) => c === 2).length;
    if (kinds === 7) {
      candidates.push({ sets: [], pair: null, isChiitoitsu: true, winningBlockIndex: -1 });
    }
  }

  let best: WinAnalysis | null = null;

  for (const cand of candidates) {
    let yakuman: YakuResult[] = [];
    let pairsForChiitoi: TileCode[] = [];
    if (cand.isChiitoitsu) {
      const counts = countsFromCodes(concealedCodes);
      pairsForChiitoi = counts
        .map((c, i) => (c === 2 ? i : -1))
        .filter((i) => i >= 0)
        .map((i) => require_code(i));
      yakuman = evaluateYakuman([], null, true, context, allCodes, -1);
    } else {
      yakuman = evaluateYakuman(cand.sets, cand.pair, false, context, allCodes, cand.winningBlockIndex);
    }

    if (yakuman.length > 0) {
      const totalHan = yakuman.reduce((a, y) => a + y.han, 0);
      const multiplier = yakuman.reduce((a, y) => a + (y.han >= 26 ? 2 : 1), 0);
      const analysis: WinAnalysis = {
        yaku: yakuman,
        han: totalHan,
        fu: 0,
        isYakuman: true,
        yakumanMultiplier: multiplier,
      };
      if (!best || !best.isYakuman || analysis.yakumanMultiplier > best.yakumanMultiplier) best = analysis;
      continue;
    }

    if (best?.isYakuman) continue;

    if (cand.isChiitoitsu) {
      const yakuList = evaluateChiitoitsuYaku(pairsForChiitoi, context, allCodes);
      const dora = countDora(allCodes, context.doraIndicators);
      const uraDora = context.riichi || context.doubleRiichi ? countDora(allCodes, context.uraDoraIndicators) : 0;
      const akaDora = countAkaDora(hand);
      if (dora > 0) yakuList.push({ name: "ドラ", han: dora });
      if (uraDora > 0) yakuList.push({ name: "裏ドラ", han: uraDora });
      if (akaDora > 0) yakuList.push({ name: "赤ドラ", han: akaDora });
      if (context.bonusHan > 0) yakuList.push({ name: "カード効果", han: context.bonusHan });
      const hasRealYaku = yakuList.some(
        (y) => y.name !== "ドラ" && y.name !== "裏ドラ" && y.name !== "赤ドラ" && y.name !== "カード効果",
      );
      if (!hasRealYaku) continue;
      const han = yakuList.reduce((a, y) => a + y.han, 0);
      const analysis: WinAnalysis = { yaku: yakuList, han, fu: 25, isYakuman: false, yakumanMultiplier: 0 };
      if (!best || betterThan(analysis, best)) best = analysis;
      continue;
    }

    const yakuList = evaluateRegularYaku(cand.sets, cand.pair!, isOpen, context, allCodes, cand.winningBlockIndex);
    const hasRealYaku = yakuList.length > 0;
    if (!hasRealYaku) continue;

    const dora = countDora(allCodes, context.doraIndicators);
    const uraDora = context.riichi || context.doubleRiichi ? countDora(allCodes, context.uraDoraIndicators) : 0;
    const akaDora = countAkaDora(hand);
    const fullYakuList = [...yakuList];
    if (dora > 0) fullYakuList.push({ name: "ドラ", han: dora });
    if (uraDora > 0) fullYakuList.push({ name: "裏ドラ", han: uraDora });
    if (akaDora > 0) fullYakuList.push({ name: "赤ドラ", han: akaDora });
    if (context.bonusHan > 0) fullYakuList.push({ name: "カード効果", han: context.bonusHan });

    const han = fullYakuList.reduce((a, y) => a + y.han, 0);
    const fu = calcFu(cand, isOpen, context, yakuList);
    const analysis: WinAnalysis = { yaku: fullYakuList, han, fu, isYakuman: false, yakumanMultiplier: 0 };
    if (!best || betterThan(analysis, best)) best = analysis;
  }

  return best;
}

function require_code(index: number): TileCode {
  const all = [
    "1m","2m","3m","4m","5m","6m","7m","8m","9m",
    "1p","2p","3p","4p","5p","6p","7p","8p","9p",
    "1s","2s","3s","4s","5s","6s","7s","8s","9s",
    "1z","2z","3z","4z","5z","6z","7z",
  ] as TileCode[];
  return all[index]!;
}

function betterThan(a: WinAnalysis, b: WinAnalysis): boolean {
  if (a.isYakuman !== b.isYakuman) return a.isYakuman;
  if (a.isYakuman) return a.yakumanMultiplier > b.yakumanMultiplier;
  if (a.han !== b.han) return a.han > b.han;
  return a.fu > b.fu;
}

function calcFu(cand: Candidate, isOpen: boolean, context: WinContext, yakuList: YakuResult[]): number {
  const isPinfu = yakuList.some((y) => y.name === "平和");
  const isPairWin = cand.winningBlockIndex === -1;
  const winningBlock: ResolvedSet = isPairWin
    ? { kind: "triplet", tile: cand.pair!, concealed: true }
    : cand.sets[cand.winningBlockIndex]!;
  const waitType = classifyWait(context.winTile, winningBlock, isPairWin);

  if (isPinfu) {
    return context.isTsumo ? 20 : 30;
  }

  let fu = 20;
  if (!isOpen && !context.isTsumo) fu += 10;
  if (context.isTsumo) fu += 2;

  if (waitType === "kanchan" || waitType === "penchan" || waitType === "tanki") fu += 2;

  const pair = cand.pair;
  if (pair) {
    if (isDragon(pair)) fu += 2;
    if (pair === windTileCode(context.seatWind)) fu += 2;
    if (pair === windTileCode(context.roundWind)) fu += 2;
  }

  cand.sets.forEach((s, i) => {
    if (s.kind === "sequence") return;
    const terminalOrHonor = isTerminalOrHonor(s.tile);
    if (s.kind === "kan") {
      fu += s.concealed ? (terminalOrHonor ? 32 : 16) : terminalOrHonor ? 16 : 8;
      return;
    }
    const isRonCompleted = !context.isTsumo && i === cand.winningBlockIndex;
    const concealed = s.concealed && !isRonCompleted;
    fu += concealed ? (terminalOrHonor ? 8 : 4) : terminalOrHonor ? 4 : 2;
  });

  return Math.ceil(fu / 10) * 10;
}
