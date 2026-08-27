import type { Wind } from "./tiles.js";
import { buildWall, drawFromLive } from "./wall.js";
import { createEmptyHand, addTileToHand } from "./hand.js";
import type { PlayerIndex } from "./actions.js";
import type { MatchFormat, MatchState, PlayerRoundState, RoundState } from "./gameState.js";

const STARTING_SCORE = 25000;

function globalRoundIndex(roundWind: Wind, roundNumber: number): number {
  return (roundWind - 1) * 4 + (roundNumber - 1);
}

function roundFromGlobalIndex(index: number): { roundWind: Wind; roundNumber: number } {
  return { roundWind: (Math.floor(index / 4) + 1) as Wind, roundNumber: (index % 4) + 1 };
}

export function maxGlobalRoundIndex(format: MatchFormat): number {
  return format === "tonpuusen" ? 3 : 7; // 東4局 or 南4局 が最終局
}

function createEmptyPlayerRoundState(): PlayerRoundState {
  return {
    hand: createEmptyHand(),
    discards: [],
    riichi: false,
    doubleRiichi: false,
    ippatsuActive: false,
    isTenpai: false,
  };
}

export function dealNewRound(
  roundWind: Wind,
  roundNumber: number,
  honba: number,
  kyotaku: number,
  dealerSeat: PlayerIndex,
  rng: () => number = Math.random,
): RoundState {
  let wall = buildWall(rng);
  const players: [PlayerRoundState, PlayerRoundState, PlayerRoundState, PlayerRoundState] = [
    createEmptyPlayerRoundState(),
    createEmptyPlayerRoundState(),
    createEmptyPlayerRoundState(),
    createEmptyPlayerRoundState(),
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

  return {
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
    anyCallOrRiichiMade: false,
  };
}

export function createMatch(format: MatchFormat, rng: () => number = Math.random): MatchState {
  const round = dealNewRound(1, 1, 0, 0, 0, rng);
  return {
    format,
    scores: [STARTING_SCORE, STARTING_SCORE, STARTING_SCORE, STARTING_SCORE],
    round,
    finished: false,
    finalRanking: null,
  };
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
