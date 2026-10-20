import type { TileCode } from "../tiles.js";
import { numberOf, suitOf, isTerminalOrHonor, nextTileForDora, tileCodeToIndex } from "../tiles.js";
import { allHandTileCodes, getWaitingTiles, removeTileFromHand, type Hand } from "../hand.js";
import { calcShanten } from "../shanten.js";
import { doraIndicators } from "../wall.js";
import type { RoundState } from "../gameState.js";
import type { PlayerIndex } from "../actions.js";

/**
 * 強い難易度（Lv4・Lv5）の打牌選択。simpleAiの「向聴数が同じなら字牌・端牌から」という
 * 決め方に代えて、次のことを見る。
 * - 受け入れ枚数: 場・副露・自分の手・ドラ表示牌で見えている牌を引いて、残りの何枚で
 *   向聴数が進むか（両面を残す、見えている牌が多い待ちを避ける、が自然に出る）
 * - 押し引き: 他家のリーチに対して、自分の向聴数・受け入れ・ドラの枚数・巡目から、
 *   押すか降りるかを決める。降りる時は、リーチ者ごとの現物・スジ・字牌の枚数などから
 *   危険度を足し合わせて、一番安全な牌を切る（複数のリーチ者の現物をまとめて「安全」
 *   としない）
 */

export interface StrongProfile {
  /** 他家のリーチに対し、一向聴でも条件が揃えば押す（Lv5）。falseなら一向聴以上は降りる。 */
  pushAtOneShanten: boolean;
  /** リーチ者の危険度の見積もりにスジ・字牌の枚数・ドラを使う（Lv5）。falseなら現物のみを安全とする。 */
  detailedDanger: boolean;
  /** リーチするかを見極める（Lv5）。待ちが薄い時・追っかけで安手の時はリーチせずに手を進める。 */
  smartRiichi: boolean;
  /** 鳴きを選んで行う（役牌・断幺九・ドラのある鳴きだけ、リーチ者がいる時は聴牌にならない鳴きをしない）。 */
  smartCalls: boolean;
  /** 3副露以上した相手も、リーチ者に準じて警戒する（Lv5）。 */
  watchOpenHands: boolean;
  /** 持ち点と局の進み具合を見て押し引きを変える（Lv5）。終盤にリードしていれば堅く、大きく負けていれば攻める。 */
  scoreAware: boolean;
  /** 必殺技の効果が出ている間の打牌を、その効果に合わせる（Lv5）。太っ腹中はドラを切って有効牌を引く、
      ベタ降り中は刻子を崩して盾を張る、など。 */
  traitAware: boolean;
}

/** 終盤の自分の立場。点数が分からない（roundにpointsが無い）時はnull。 */
type Standing = "safe-lead" | "desperate" | "normal";

function standingOf(round: RoundState, player: PlayerIndex): Standing {
  const pts = round.points;
  if (!pts) return "normal";
  const index = (round.roundWind - 1) * 4 + (round.roundNumber - 1);
  const lastIndex = round.format === "tonpuusen" ? 3 : 7;
  if (index < lastIndex - 1) return "normal"; // 終盤（最後の2局）だけ見る
  const mine = pts[player];
  const others = pts.filter((_, i) => i !== player);
  const rank = 1 + others.filter((v) => v > mine).length;
  const lead = mine - Math.max(...others);
  const last = index >= lastIndex;
  if (rank === 1 && lead >= (last ? 8000 : 15000)) return "safe-lead";
  if (last && rank >= 3) return "desperate";
  if (last && rank === 2 && Math.max(...others) - mine >= 12000) return "desperate";
  return "normal";
}

/** 表ドラの牌コード集合。 */
function doraCodesOf(round: RoundState): Set<TileCode> {
  return new Set(doraIndicators(round.wall).map(nextTileForDora));
}

/** 場で見えている各牌の枚数（34要素）。河（鳴かれて消えた牌は副露側で数える）・全員の副露・
    自分の手・ドラ表示牌を数える。 */
function seenCounts(round: RoundState, player: PlayerIndex): number[] {
  const seen = new Array<number>(34).fill(0);
  const add = (code: TileCode) => {
    seen[tileCodeToIndex(code)]!++;
  };
  round.players.forEach((pl, i) => {
    for (const d of pl.discards) if (!d.calledAway) add(d.tile.code);
    for (const m of pl.hand.melds) for (const t of m.tiles) add(t.code);
    if (i === player) for (const t of pl.hand.concealed) add(t.code);
  });
  for (const code of doraIndicators(round.wall)) add(code);
  return seen;
}

// 同じ手牌の向聴数を何度も計算するので、牌の並びをキーに覚えておく。
const shantenCache = new Map<string, number>();
const SHANTEN_CACHE_LIMIT = 60000;

function shantenOf(concealedCodes: TileCode[], meldCount: number, melds: Hand["melds"]): number {
  const key = `${meldCount}:${[...concealedCodes].sort().join("")}`;
  const cached = shantenCache.get(key);
  if (cached !== undefined) return cached;
  const value = calcShanten({ concealed: concealedCodes.map((code, i) => ({ id: `s${i}`, code })), melds });
  if (shantenCache.size >= SHANTEN_CACHE_LIMIT) shantenCache.clear();
  shantenCache.set(key, value);
  return value;
}

/** 手牌に関係しそうな牌種（同じ牌・同じ色の前後2つ）。受け入れを数える範囲を絞って計算を減らす。 */
function relevantCodes(codes: TileCode[]): TileCode[] {
  const out = new Set<TileCode>();
  for (const c of codes) {
    out.add(c);
    if (suitOf(c) === "z") continue;
    const n = numberOf(c);
    for (const d of [-2, -1, 1, 2]) {
      const m = n + d;
      if (m >= 1 && m <= 9) out.add(`${m}${suitOf(c)}` as TileCode);
    }
  }
  return [...out];
}

/** 打牌後の手（concealed）の向聴数と受け入れ枚数。受け入れは「引くと向聴数が進む牌」の残り枚数の合計。 */
function evaluateHand(rest: Hand, seen: number[]): { shanten: number; ukeire: number } {
  const codes = rest.concealed.map((t) => t.code);
  const shanten = shantenOf(codes, rest.melds.length, rest.melds);
  let ukeire = 0;
  for (const code of relevantCodes(codes)) {
    const remaining = 4 - seen[tileCodeToIndex(code)]!;
    if (remaining <= 0) continue;
    if (shantenOf([...codes, code], rest.melds.length, rest.melds) < shanten) ukeire += remaining;
  }
  return { shanten, ukeire };
}

/** リーチ者ひとりに対するその牌の危険度の見積もり（0=安全〜1以上=危険）。 */
function dangerAgainst(
  code: TileCode,
  riichiDiscards: TileCode[],
  seen: number[],
  doraCodes: Set<TileCode>,
  detailed: boolean,
): number {
  if (riichiDiscards.includes(code)) return 0;
  if (!detailed) return 1;
  let base: number;
  if (suitOf(code) === "z") {
    const visible = seen[tileCodeToIndex(code)]!;
    base = visible >= 3 ? 0.05 : visible === 2 ? 0.3 : visible === 1 ? 0.5 : 0.75;
  } else {
    const n = numberOf(code);
    base = n === 1 || n === 9 ? 0.35 : n === 2 || n === 8 ? 0.5 : n === 3 || n === 7 ? 0.65 : 0.85;
    const has = (m: number) => riichiDiscards.includes(`${m}${suitOf(code)}` as TileCode);
    const suji = n <= 3 ? has(n + 3) : n >= 7 ? has(n - 3) : has(n - 3) && has(n + 3);
    if (suji) base *= n >= 4 && n <= 6 ? 0.45 : 0.55;
  }
  return doraCodes.has(code) ? base * 1.3 : base;
}

/** 手牌に含まれるドラ（赤ドラ含む）の枚数。 */
function countDora(hand: Hand, doraCodes: Set<TileCode>): number {
  let n = 0;
  for (const t of hand.concealed) {
    if (doraCodes.has(t.code)) n++;
    if (t.isRed) n++;
  }
  for (const m of hand.melds) for (const t of m.tiles) if (doraCodes.has(t.code) || t.isRed) n++;
  return n;
}

function isYakuhai(code: TileCode, round: RoundState, player: PlayerIndex): boolean {
  if (suitOf(code) !== "z") return false;
  const n = numberOf(code);
  if (n >= 5) return true;
  const seatWind = (((player - round.dealerSeat + 4) % 4) + 1) as number;
  return n === seatWind || n === round.roundWind;
}

export interface StrongDiscardChoice {
  tileId: string;
  /** 降りる（押さずに安全牌を切る）と決めたか。 */
  folded: boolean;
}

/**
 * 切る牌を決める。candidatesは切ってよい牌（透視で見えている当たり牌を除いたもの）。
 * 戻り値はその中の1枚。
 */
export function chooseStrongDiscard(
  round: RoundState,
  player: PlayerIndex,
  candidates: { id: string; code: TileCode; isRed?: boolean }[],
  profile: StrongProfile,
): StrongDiscardChoice {
  const p = round.players[player]!;
  const seen = seenCounts(round, player);
  const doraCodes = doraCodesOf(round);
  const riichiOthers = round.players
    .map((pl, i) => ({ pl, i }))
    .filter(({ pl, i }) => i !== player && pl.riichi);
  const dealerRiichi = riichiOthers.some(({ i }) => i === round.dealerSeat);
  // リーチはしていないが3副露以上で、聴牌が近いと見られる相手（Lv5だけ警戒する）。
  const openThreats = profile.watchOpenHands
    ? round.players.map((pl, i) => ({ pl, i })).filter(({ pl, i }) => i !== player && !pl.riichi && pl.hand.melds.length >= 3)
    : [];

  // 同じ牌種は1回だけ評価する（赤ドラは別扱い）。
  const evaluated = new Map<string, { tile: (typeof candidates)[number]; shanten: number; ukeire: number }>();
  for (const t of candidates) {
    const key = `${t.code}${t.isRed ? "r" : ""}`;
    if (evaluated.has(key)) continue;
    const { hand: rest } = removeTileFromHand(p.hand, t.id);
    evaluated.set(key, { tile: t, ...evaluateHand(rest, seen) });
  }
  const options = [...evaluated.values()];
  const bestShanten = Math.min(...options.map((o) => o.shanten));
  const keepShanten = options.filter((o) => o.shanten === bestShanten);
  const bestUkeire = Math.max(...keepShanten.map((o) => o.ukeire));

  const dangerOf = (code: TileCode): number =>
    riichiOthers.reduce(
      (sum, { pl, i }) =>
        sum +
        dangerAgainst(code, pl.discards.map((d) => d.tile.code), seen, doraCodes, profile.detailedDanger) *
          (i === round.dealerSeat ? 1.25 : 1),
      0,
    ) +
    openThreats.reduce(
      (sum, { pl, i }) =>
        sum + dangerAgainst(code, pl.discards.map((d) => d.tile.code), seen, doraCodes, true) * 0.6 * (i === round.dealerSeat ? 1.25 : 1),
      0,
    );

  // 押すか降りるか。リーチ者がいない時は常に押す（通常の牌効率）。
  let fold = false;
  const standing = profile.scoreAware ? standingOf(round, player) : "normal";
  if (riichiOthers.length > 0) {
    const myDora = countDora(p.hand, doraCodes);
    const turn = p.discards.length;
    if (standing === "safe-lead" && !(bestShanten === 0 && bestUkeire >= 4)) fold = true;
    else if (standing === "desperate") fold = bestShanten >= 2 ? turn > 9 : bestUkeire === 0;
    else if (bestShanten >= 2) fold = true;
    else if (bestShanten === 1) {
      fold = !(
        profile.pushAtOneShanten &&
        riichiOthers.length === 1 &&
        bestUkeire >= 8 &&
        (myDora >= 2 || (myDora >= 1 && !dealerRiichi)) &&
        turn <= 10
      );
    } else {
      // 聴牌: 待ちが死んでいるか、親リーチに安手で待ちが薄い時は降りる。
      fold = bestUkeire === 0 || (dealerRiichi && myDora === 0 && bestUkeire <= 2 && riichiOthers.length >= 2);
    }
  } else if (openThreats.length > 0) {
    // 副露の聴牌気配には、手が遠い時だけ降りる（一向聴以内なら押す）。
    fold = bestShanten >= 2;
  }

  // 必殺技の効果に合わせた打牌（Lv5）。
  const kokiActive = false; // 測定で放銃率が上がるだけで順位は伸びなかったため、太っ腹中のドラ切りは行わない（10-20）
  const shieldWanted = profile.traitAware && p.bettaoriActive && !p.bettaoriShield;
  const countInHand = (code: TileCode) => p.hand.concealed.filter((t) => t.code === code).length;

  let best = options[0]!;
  let bestScore = -Infinity;
  for (const o of options) {
    const t = o.tile;
    let score: number;
    if (fold) {
      // 安全第一。同じ安全さなら、向聴数・受け入れの良い方。
      score = -dangerOf(t.code) * 1000 - o.shanten * 10 + o.ukeire * 0.1;
      // ベタ降り中に刻子を崩すと盾が立つ。同じくらい安全なら崩す方を選ぶ。
      if (shieldWanted && countInHand(t.code) === 3) score += 300;
    } else {
      // 向聴数を最優先、次に受け入れ枚数。ドラ・赤・役牌の対子は残す。降りない時でも
      // 危険な牌は少し避ける（同じ受け入れなら安全な方）。
      const sameCount = candidates.filter((c) => c.code === t.code).length;
      const isDora = t.isRed === true || doraCodes.has(t.code);
      // 太っ腹中は、ドラを切るたびに次のツモが有効牌になるので、手を進められる範囲で積極的に切る。
      const valuable = (isDora && !kokiActive) || (sameCount >= 2 && isYakuhai(t.code, round, player));
      score =
        -o.shanten * 1000 +
        o.ukeire * 10 -
        (valuable ? 15 : 0) -
        dangerOf(t.code) * (riichiOthers.length > 0 || openThreats.length > 0 ? 25 : 0) +
        (isTerminalOrHonor(t.code) ? 1 : 0) +
        (kokiActive && isDora ? 40 : 0) +
        (shieldWanted && (riichiOthers.length > 0 || openThreats.length > 0) && countInHand(t.code) === 3 ? 30 : 0);
    }
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return { tileId: best.tile.id, folded: fold };
}

/** リーチ候補の牌を切った手（聴牌）の、待ち牌の残り枚数（見えている牌を引いた分を除く）。 */
export function remainingWaitCount(round: RoundState, player: PlayerIndex, rest: Hand): number {
  const seen = seenCounts(round, player);
  let n = 0;
  for (const code of getWaitingTiles(rest)) n += Math.max(0, 4 - seen[tileCodeToIndex(code)]!);
  return n;
}

/** 聴牌しているが、リーチをかけずに手を進めた方がよい場面か（Lv5）。 */
export function shouldSkipRiichi(round: RoundState, player: PlayerIndex, rest: Hand): boolean {
  const waits = remainingWaitCount(round, player, rest);
  const p = round.players[player]!;
  const turn = p.discards.length;
  const doraCodes = doraCodesOf(round);
  const myDora = countDora(rest, doraCodes);
  const chased = round.players.some((pl, i) => i !== player && pl.riichi);
  if (waits <= 1) return true; // ほぼ和了れない待ち
  if (chased && waits <= 3 && myDora === 0) return true; // 追っかけで薄く安手
  if (turn >= 15 && waits <= 2) return true; // 終盤の薄い待ち
  return false;
}

/**
 * 鳴き（ポン・チー・大明槓）をしてよいか。向聴数が進むことは呼び出し側で確かめ済み。
 * - 他家がリーチしている時は、鳴いても聴牌にならないなら鳴かない（降りる局面で手を崩さない）
 * - 聴牌になる鳴きは常にする
 * - 聴牌までまだ遠い時は、価値のある鳴き（役牌のポン・断幺九の手・ドラがある・終盤で速さが要る）だけ
 */
export function strongCallAllowed(
  round: RoundState,
  player: PlayerIndex,
  afterShanten: number,
  probe: Hand,
  ponCode?: TileCode,
): boolean {
  const opponentRiichi = round.players.some((pl, i) => i !== player && pl.riichi);
  if (opponentRiichi && afterShanten >= 1) return false;
  if (afterShanten <= 0) return true;
  const doraCodes = doraCodesOf(round);
  const codes = allHandTileCodes(probe);
  const yakuhaiPon = ponCode !== undefined && isYakuhai(ponCode, round, player);
  const tanyao = codes.every((c) => !isTerminalOrHonor(c));
  const lateGame = round.players[player]!.discards.length >= 9;
  return yakuhaiPon || tanyao || countDora(probe, doraCodes) >= 1 || lateGame;
}
