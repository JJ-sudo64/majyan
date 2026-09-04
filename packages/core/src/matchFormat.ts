import type { Wind } from "./tiles.js";
import { buildWall, drawFromLive } from "./wall.js";
import { createEmptyHand, addTileToHand } from "./hand.js";
import type { PlayerIndex } from "./actions.js";
import type { MatchFormat, MatchState, PlayerRoundState, RoundState } from "./gameState.js";
import { randomCharacterIds, CHARACTERS } from "./characters.js";
import { CARDS } from "./cards.js";

const STARTING_SCORE = 25000;

export function globalRoundIndex(roundWind: Wind, roundNumber: number): number {
  return (roundWind - 1) * 4 + (roundNumber - 1);
}

function roundFromGlobalIndex(index: number): { roundWind: Wind; roundNumber: number } {
  return { roundWind: (Math.floor(index / 4) + 1) as Wind, roundNumber: (index % 4) + 1 };
}

export function maxGlobalRoundIndex(format: MatchFormat): number {
  return format === "tonpuusen" ? 3 : 7; // 東4局 or 南4局 が最終局
}

function createEmptyPlayerRoundState(skillGauge: number, tileSwapsRemaining: number): PlayerRoundState {
  return {
    hand: createEmptyHand(),
    discards: [],
    riichi: false,
    doubleRiichi: false,
    ippatsuActive: false,
    isTenpai: false,
    skillGauge,
    guaranteedRinshan: false,
    tileSwapsRemaining,
    pendingTileSwapNextRound: false,
    openRiichi: false,
    guaranteedUraDora: false,
    revealedFutureDraws: [],
    futopparaPending: false,
    guaranteedUsefulDraw: false,
    bettaoriActive: false,
    bettaoriShield: false,
    atomicRiichi: false,
    timeStopTurnsRemaining: 0,
  };
}

export function dealNewRound(
  roundWind: Wind,
  roundNumber: number,
  honba: number,
  kyotaku: number,
  dealerSeat: PlayerIndex,
  rng: () => number = Math.random,
  characterIds: [string, string, string, string] = randomCharacterIds(rng),
  /** 前局から持ち越す必殺技ゲージ（半荘/東風戦を通して溜まる。局をまたいでリセットしない）。 */
  previousGauges: [number, number, number, number] = [0, 0, 0, 0],
  /** ルナの必殺技「運命の采配」が前局で発動されていたか。trueなら今局の配牌直後に
      牌の入れ替え権を3回ぶん付与する。 */
  previousPendingTileSwaps: [boolean, boolean, boolean, boolean] = [false, false, false, false],
  /** この局の親(dealerSeat)が、直前の局を自分の和了によって連荘して迎えたか
      どうか（呼び出し側で計算して渡す。RoundState.dealerRenchanByWin参照）。
      対局の最初の局や、和了以外（荒牌流局の親テンパイ継続・九種九牌）で
      連荘した場合はfalse。 */
  dealerWonRenchan = false,
  /** 各座席が持つカード（cards.tsのCARDSのキー）。null=カード無し。人間(0)は
      MatchSetupでの選択、CPU(1-3)はgameStore.tsが対局開始時にランダム抽選した
      ものを渡す。対局を通して固定（半荘/東風戦をまたいでも変わらない）。 */
  cardIds: [string | null, string | null, string | null, string | null] = [null, null, null, null],
  /** 前局から持ち越すカードの残り使用可能回数（半荘/東風戦を通して持ち越す。
      局をまたいでリセットしない）。未指定（＝対局の最初の局）の場合は
      各カードのCard.maxUses（未指定なら1）で初期化する。 */
  previousCardUsesRemaining: [number, number, number, number] = cardIds.map((id) =>
    id ? CARDS[id]?.maxUses ?? 1 : 0,
  ) as [number, number, number, number],
  /** 前局から持ち越す「無効化」カードの構え状態（座席ごと）。 */
  previousCardNegateArmed: [boolean, boolean, boolean, boolean] = [false, false, false, false],
  /** 対局形式。カード「最後の粘り」のオーラス判定用にRoundStateへそのまま
      持たせる（createMatch経由で渡ってくる。単体でdealNewRoundを呼ぶテスト等
      では省略時"hanchan"扱い）。 */
  format: MatchFormat = "hanchan",
): RoundState {
  let wall = buildWall(rng);
  const players: [PlayerRoundState, PlayerRoundState, PlayerRoundState, PlayerRoundState] = [
    createEmptyPlayerRoundState(previousGauges[0], previousPendingTileSwaps[0] ? 3 : 0),
    createEmptyPlayerRoundState(previousGauges[1], previousPendingTileSwaps[1] ? 3 : 0),
    createEmptyPlayerRoundState(previousGauges[2], previousPendingTileSwaps[2] ? 3 : 0),
    createEmptyPlayerRoundState(previousGauges[3], previousPendingTileSwaps[3] ? 3 : 0),
  ];

  // 配牌: 親から順に4枚ずつ×3回、最後に1枚ずつ（簡略化して単純に13枚ずつ連続で配る）
  for (let i = 0; i < 13; i++) {
    for (let seatOffset = 0; seatOffset < 4; seatOffset++) {
      const seat = (((dealerSeat + seatOffset) % 4) as PlayerIndex);
      const draw = drawFromLive(wall);
      wall = draw.wall;
      players[seat].hand = addTileToHand(players[seat].hand, draw.tile);
    }
  }

  const initialRound: RoundState = {
    format,
    roundWind,
    roundNumber,
    honba,
    kyotaku,
    dealerSeat,
    players,
    wall,
    currentTurn: dealerSeat,
    phase: "awaiting-draw",
    lastDiscard: null,
    lastDrawnTile: null,
    isRinshanTurn: false,
    pendingCallWindow: null,
    kanCount: 0,
    result: null,
    characterIds,
    anyCallOrRiichiMade: false,
    handsRevealedTo: null,
    wallReadRevealedTo: null,
    dealerRenchanByWin: dealerWonRenchan,
    riichiLockedBy: null,
    tomohiroGuardCount: 0,
    cardIds,
    cardUsesRemaining: previousCardUsesRemaining,
    cardNegateArmed: previousCardNegateArmed,
    cardBonusHan: [0, 0, 0, 0],
    cardExtraUraDora: [false, false, false, false],
    cardScoreDoubled: [false, false, false, false],
    pendingScoreAdjustment: null,
    lastActivatedSkill: null,
  };

  // ナオキの「クマクマタイム」・メビウスの「陰陽配牌」等、配牌そのものを
  // パッシブに書き換えるキャラ専用のフック。gameEngine.tsのonBeforeDrawと
  // 同様、盤上の全プレイヤーのキャラクターに対して順に呼び出す。「自分が
  // 親の時だけ」「親でない時だけ」等の判定はフック側（characters.ts）が
  // ctx.owner/ctx.round.dealerSeatを見て自分で行う。
  let dealtRound = initialRound;
  for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
    const onDealHand = CHARACTERS[characterIds[seat]]?.skill.hooks.onDealHand;
    if (onDealHand) dealtRound = onDealHand({ round: dealtRound, owner: seat });
  }
  // カード「面子確約」「ドラ確約」等、配牌時のパッシブ効果。キャラのループとは
  // 別に、カードを持つ全座席ぶん呼ぶ。
  for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
    const cardId = cardIds[seat];
    if (!cardId) continue;
    const onDealHand = CARDS[cardId]?.hooks.onDealHand;
    if (onDealHand) dealtRound = onDealHand({ round: dealtRound, owner: seat });
  }
  return dealtRound;
}

export function createMatch(
  format: MatchFormat,
  rng: () => number = Math.random,
  characterIds: [string, string, string, string] = randomCharacterIds(rng),
  /** 箱下続行ルール。デフォルトfalse（箱割れ即終了）。 */
  continueBelowZero = false,
  /** 各座席が持つカード（cards.tsのCARDSのキー）。null=カード無し。人間(0)は
      MatchSetupでの選択、CPU(1-3)はgameStore.tsがランダム抽選する。 */
  cardIds: [string | null, string | null, string | null, string | null] = [null, null, null, null],
): MatchState {
  // 起家（東1局の親）は本来くじ引き等で座席に関わらず決まるもので、
  // 人間プレイヤー(座席0)に固定する理由はない。以前は常にdealerSeat=0
  // としており、プレイヤーが必ず親から対局を始めることになっていた。
  const startingDealer = Math.floor(rng() * 4) as PlayerIndex;
  const round = dealNewRound(1, 1, 0, 0, startingDealer, rng, characterIds, undefined, undefined, false, cardIds, undefined, undefined, format);
  return {
    format,
    scores: [STARTING_SCORE, STARTING_SCORE, STARTING_SCORE, STARTING_SCORE],
    round,
    finished: false,
    finalRanking: null,
    continueBelowZero,
  };
}

/** 誰か1人でも持ち点が0点未満（箱割れ）になっているか。 */
export function hasBustedPlayer(scores: readonly [number, number, number, number]): boolean {
  return scores.some((s) => s < 0);
}

/**
 * 対局終了時、誰にも回収されず残った供託（リーチ棒）を精算する。
 * 供託は和了者が出た時にround.kyotaku*1000として上乗せで受け取る想定だが、
 * 最終局が和了で終わらなかった場合（荒牌流局・九種九牌流局）や、途中で
 * 誰かが箱割れして対局が打ち切られた場合は「次局へ持ち越す」はずの供託の
 * 行き先（次局）自体が無くなり、そのままでは対局全体の点数合計が
 * 供託ぶんだけ静かに目減りしてしまう（ゼロサムが崩れる）。慣例に倣い、
 * 総合トップのプレイヤーへまとめて渡す。
 */
export function settleLeftoverKyotaku(
  scores: readonly [number, number, number, number],
  kyotaku: number,
): [number, number, number, number] {
  const next = [...scores] as [number, number, number, number];
  if (kyotaku <= 0) return next;
  const topIndex = next.reduce((best, s, i) => (s > next[best]! ? i : best), 0);
  next[topIndex] = next[topIndex]! + kyotaku * 1000;
  return next;
}

export interface NextRoundPlan {
  roundWind: Wind;
  roundNumber: number;
  honba: number;
  kyotaku: number;
  dealerSeat: PlayerIndex;
  matchOver: boolean;
}

/**
 * 局終了後、次局の設定を決定する。
 * dealerContinues: 親が連荘するか（親の和了、または親テンパイでの流局）
 * keepKyotaku: 供託を次局に持ち越すか（誰も和了しなかった場合）
 */
export function planNextRound(
  current: RoundState,
  format: MatchFormat,
  dealerContinues: boolean,
  keepKyotaku: boolean,
): NextRoundPlan {
  const currentIndex = globalRoundIndex(current.roundWind, current.roundNumber);
  const nextIndex = dealerContinues ? currentIndex : currentIndex + 1;
  const nextHonba = dealerContinues ? current.honba + 1 : 0;
  const nextKyotaku = keepKyotaku ? current.kyotaku : 0;

  const matchOver = !dealerContinues && currentIndex >= maxGlobalRoundIndex(format);

  if (matchOver) {
    return {
      roundWind: current.roundWind,
      roundNumber: current.roundNumber,
      honba: nextHonba,
      kyotaku: nextKyotaku,
      dealerSeat: current.dealerSeat,
      matchOver: true,
    };
  }

  const { roundWind, roundNumber } = roundFromGlobalIndex(nextIndex);
  const dealerSeat = dealerContinues ? current.dealerSeat : (((current.dealerSeat + 1) % 4) as PlayerIndex);

  return { roundWind, roundNumber, honba: nextHonba, kyotaku: nextKyotaku, dealerSeat, matchOver: false };
}
