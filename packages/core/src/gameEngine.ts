import {
  allTileCodes,
  sortTiles,
  tileCodeToIndex,
  type TileCode,
  type Wind,
} from "./tiles.js";
import {
  addTileToHand,
  allHandTileCodes,
  createEmptyHand,
  isConcealedHand,
  removeTileFromHand,
  type Hand,
  type Meld,
} from "./hand.js";
import { calcShanten } from "./shanten.js";
import {
  drawFromLive,
  drawRinshan,
  revealNextDora,
  doraIndicators,
  uraDoraIndicators,
  liveTilesRemaining,
} from "./wall.js";
import { analyzeWin, type WinAnalysis, type WinContext } from "./yaku/index.js";
import { scoreWin, applyHonba, type ScoreResult } from "./scoring.js";
import type {
  GameAction,
  PlayerIndex,
  ChiAction,
  PonAction,
  MinkanAction,
  AnkanAction,
  KakanAction,
  RiichiAction,
  DiscardAction,
} from "./actions.js";
import {
  seatWindOf,
  type DeclaredCallAction,
  type PendingCallWindow,
  type PlayerRoundState,
  type RoundState,
} from "./gameState.js";

function otherPlayers(player: PlayerIndex): PlayerIndex[] {
  return [0, 1, 2, 3].filter((p) => p !== player) as PlayerIndex[];
}

function nextSeat(player: PlayerIndex): PlayerIndex {
  return (((player + 1) % 4) as PlayerIndex);
}

function updatePlayer(
  players: RoundState["players"],
  index: PlayerIndex,
  updater: (p: PlayerRoundState) => PlayerRoundState,
): RoundState["players"] {
  const next = [...players] as RoundState["players"];
  next[index] = updater(next[index]);
  return next;
}

function clearAllIppatsu(players: RoundState["players"]): RoundState["players"] {
  return players.map((p) => ({ ...p, ippatsuActive: false })) as RoundState["players"];
}

/** 手牌(13枚相当)がロン/ツモできる待ち牌の一覧。役の有無は問わない形の判定。 */
export function getWaitingTiles(hand: Hand): TileCode[] {
  const waits: TileCode[] = [];
  for (const code of allTileCodes()) {
    const testHand: Hand = {
      concealed: sortTiles([...hand.concealed, { id: "__probe__", code }]),
      melds: hand.melds,
    };
    if (calcShanten(testHand) === -1) waits.push(code);
  }
  return waits;
}

export function isFuriten(player: PlayerRoundState): boolean {
  const waits = getWaitingTiles(player.hand);
  if (waits.length === 0) return false;
  const discardedCodes = new Set(player.discards.map((d) => d.tile.code));
  return waits.some((w) => discardedCodes.has(w));
}

function buildWinContext(
  round: RoundState,
  player: PlayerIndex,
  winTile: TileCode,
  isTsumo: boolean,
  chankan = false,
): WinContext {
  const p = round.players[player];
  return {
    isTsumo,
    winTile,
    seatWind: seatWindOf(round.dealerSeat, player),
    roundWind: round.roundWind,
    isDealer: player === round.dealerSeat,
    riichi: p.riichi,
    doubleRiichi: p.doubleRiichi,
    ippatsu: p.ippatsuActive,
    haitei: isTsumo && liveTilesRemaining(round.wall) === 0,
    houtei: !isTsumo && !chankan && liveTilesRemaining(round.wall) === 0,
    rinshan: isTsumo && round.isRinshanTurn,
    chankan,
    doraIndicators: doraIndicators(round.wall),
    uraDoraIndicators: uraDoraIndicators(round.wall),
  };
}

export function canDeclareTsumo(round: RoundState, player: PlayerIndex): WinAnalysis | null {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return null;
  const p = round.players[player];
  if (!round.lastDrawnTile) return null;
  const ctx = buildWinContext(round, player, round.lastDrawnTile.code, true);
  return analyzeWin(p.hand, ctx);
}

export function canDeclareRon(round: RoundState, player: PlayerIndex, discardTile: TileCode, chankan = false): WinAnalysis | null {
  const p = round.players[player];
  if (isFuriten(p)) return null;
  const testHand: Hand = { concealed: sortTiles([...p.hand.concealed, { id: "__ron__", code: discardTile }]), melds: p.hand.melds };
  const ctx = buildWinContext(round, player, discardTile, false, chankan);
  return analyzeWin(testHand, ctx);
}

export function canRiichi(round: RoundState, player: PlayerIndex): boolean {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return false;
  const p = round.players[player];
  if (p.riichi) return false;
  if (!isConcealedHand(p.hand)) return false;
  if (liveTilesRemaining(round.wall) < 4) return false;
  // いずれか1枚を切ればテンパイになる（=リーチ可能な形をしている）ことを確認する。
  // これが無いと、テンパイしていない手でもリーチボタンが常に表示されてしまう。
  if (riichiCandidateTileIds(round, player).length === 0) return false;
  // 25000点持ちルールに限らずシンプルに1000点以上を要求
  return true;
}

/** 打牌後にテンパイを維持できる手牌かどうか（リーチ宣言時の合法牌判定に使用） */
export function riichiCandidateTileIds(round: RoundState, player: PlayerIndex): string[] {
  const p = round.players[player];
  const ids: string[] = [];
  for (const t of p.hand.concealed) {
    const { hand: rest } = removeTileFromHand(p.hand, t.id);
    if (calcShanten(rest) === 0) ids.push(t.id);
  }
  return ids;
}

export function canKyushuKyuhai(round: RoundState, player: PlayerIndex): boolean {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return false;
  if (round.anyCallOrRiichiMade) return false;
  const p = round.players[player];
  if (p.discards.length !== 0) return false;
  const kinds = new Set(
    p.hand.concealed.map((t) => t.code).filter((c) => c.endsWith("z") || c.startsWith("1") || c.startsWith("9")),
  );
  return kinds.size >= 9;
}

function meldTileCounts(hand: Hand, code: TileCode): number {
  return hand.concealed.filter((t) => t.code === code).length;
}

export function ankanOptions(round: RoundState, player: PlayerIndex): TileCode[] {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return [];
  const p = round.players[player];
  const counts = new Map<TileCode, number>();
  for (const t of p.hand.concealed) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
  const options: TileCode[] = [];
  for (const [code, count] of counts) {
    if (count === 4) {
      if (p.riichi) {
        // リーチ後は待ちが変わらない暗槓のみ許可（簡易チェック: その牌を抜いても同じ待ちになるか）
        const { hand: without } = (() => {
          const idx = p.hand.concealed.findIndex((t) => t.code === code);
          return removeTileFromHand(p.hand, p.hand.concealed[idx]!.id);
        })();
        const before = getWaitingTiles(p.hand).sort().join(",");
        const afterProbe: Hand = { concealed: without.concealed, melds: without.melds };
        const after = getWaitingTiles(afterProbe).sort().join(",");
        if (before !== after) continue;
      }
      options.push(code);
    }
  }
  return options;
}

export function kakanOptions(round: RoundState, player: PlayerIndex): string[] {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return [];
  const p = round.players[player];
  const ponCodes = new Set(p.hand.melds.filter((m) => m.type === "pon").map((m) => m.tiles[0]!.code));
  return p.hand.concealed.filter((t) => ponCodes.has(t.code)).map((t) => t.id);
}

function startCallWindow(round: RoundState, discarder: PlayerIndex, discardTile: RoundState["lastDiscard"], isChankan: boolean): PendingCallWindow {
  return {
    discarderIndex: discarder,
    discardTile: discardTile!.tile,
    isChankan,
    awaitingPlayers: otherPlayers(discarder),
    respondedBy: [],
    declaredCalls: [],
  };
}

function buildExhaustiveDrawResult(round: RoundState): RoundState {
  const tenpaiPlayers: PlayerIndex[] = [];
  for (const idx of [0, 1, 2, 3] as PlayerIndex[]) {
    if (calcShanten(round.players[idx].hand) === 0) tenpaiPlayers.push(idx);
  }
  const dealerContinues = tenpaiPlayers.includes(round.dealerSeat);
  return {
    ...round,
    phase: "round-over",
    result: { type: "exhaustive-draw", winners: [], tenpaiPlayers, dealerContinues },
  };
}

function applyDrawAction(round: RoundState, player: PlayerIndex): RoundState {
  if (round.phase !== "awaiting-draw" || round.currentTurn !== player) {
    throw new Error("draw: 現在このプレイヤーがツモできる局面ではありません");
  }
  if (liveTilesRemaining(round.wall) === 0) {
    return buildExhaustiveDrawResult(round);
  }
  const { tile, wall } = drawFromLive(round.wall);
  const players = updatePlayer(round.players, player, (p) => ({ ...p, hand: addTileToHand(p.hand, tile) }));
  return { ...round, wall, players, lastDrawnTile: tile, phase: "awaiting-discard", isRinshanTurn: false };
}

function applyDiscardAction(round: RoundState, action: DiscardAction): RoundState {
  if (round.phase !== "awaiting-discard" || round.currentTurn !== action.player) {
    throw new Error("discard: 現在このプレイヤーが打牌できる局面ではありません");
  }
  const p = round.players[action.player];
  if (p.riichi && action.tileId !== round.lastDrawnTile?.id) {
    throw new Error("discard: リーチ中はツモ切りのみ可能です");
  }
  const { tile, hand } = removeTileFromHand(p.hand, action.tileId);
  const isTsumogiri = action.tileId === round.lastDrawnTile?.id;
  const players = updatePlayer(round.players, action.player, (pl) => ({
    ...pl,
    hand,
    discards: [...pl.discards, { tile, calledAway: false, isRiichiDeclaration: false, isTsumogiri }],
    ippatsuActive: pl.riichi ? false : pl.ippatsuActive,
  }));

  if (liveTilesRemaining(round.wall) === 0 && !hasAnyoneWhoCanRon(round, players, action.player, tile.code)) {
    return buildExhaustiveDrawResult({ ...round, players });
  }

  return {
    ...round,
    players,
    lastDiscard: { player: action.player, tile },
    phase: "awaiting-calls",
    pendingCallWindow: startCallWindow(round, action.player, { player: action.player, tile }, false),
  };
}

function hasAnyoneWhoCanRon(round: RoundState, players: RoundState["players"], discarder: PlayerIndex, tile: TileCode): boolean {
  for (const p of otherPlayers(discarder)) {
    const probe: RoundState = { ...round, players };
    if (canDeclareRon(probe, p, tile)) return true;
  }
  return false;
}

function applyRiichiAction(round: RoundState, action: RiichiAction): RoundState {
  if (!canRiichi(round, action.player)) throw new Error("riichi: リーチできない状況です");
  const p = round.players[action.player];
  const { tile, hand } = removeTileFromHand(p.hand, action.tileId);
  if (calcShanten(hand) !== 0) throw new Error("riichi: その牌を切るとテンパイが崩れます");

  const isFirstDiscardOfHand = p.discards.length === 0 && !round.anyCallOrRiichiMade;
  const isTsumogiri = action.tileId === round.lastDrawnTile?.id;
  const players = updatePlayer(round.players, action.player, (pl) => ({
    ...pl,
    hand,
    discards: [...pl.discards, { tile, calledAway: false, isRiichiDeclaration: true, isTsumogiri }],
    riichi: true,
    doubleRiichi: isFirstDiscardOfHand,
    ippatsuActive: true,
  }));

  return {
    ...round,
    players,
    lastDiscard: { player: action.player, tile },
    phase: "awaiting-calls",
    pendingCallWindow: startCallWindow(round, action.player, { player: action.player, tile }, false),
    anyCallOrRiichiMade: true,
    kyotaku: round.kyotaku + 1,
  };
}

export const RIICHI_STICK_COST = 1000;

function applyKyushuKyuhaiAction(round: RoundState, player: PlayerIndex): RoundState {
  if (!canKyushuKyuhai(round, player)) throw new Error("kyushukyuhai: 九種九牌の条件を満たしていません");
  return {
    ...round,
    phase: "round-over",
    result: { type: "abortive-draw", winners: [], dealerContinues: true },
  };
}

function applyAnkanAction(round: RoundState, action: AnkanAction): RoundState {
  if (round.phase !== "awaiting-discard" || round.currentTurn !== action.player) {
    throw new Error("ankan: 暗槓できる局面ではありません");
  }
  if (round.kanCount >= 4) throw new Error("ankan: これ以上カンできません（四槓散了）");
  const p = round.players[action.player];
  const matching = p.hand.concealed.filter((t) => t.code === action.tileCode);
  if (matching.length !== 4) throw new Error("ankan: 対象の牌が4枚揃っていません");

  let hand = p.hand;
  for (const t of matching) hand = removeTileFromHand(hand, t.id).hand;
  const meld: Meld = { type: "ankan", tiles: matching };
  hand = { ...hand, melds: [...hand.melds, meld] };

  let players = updatePlayer(round.players, action.player, (pl) => ({ ...pl, hand }));
  players = clearAllIppatsu(players);

  const { tile: rinshanTile, wall: wallAfterDraw } = drawRinshan(round.wall);
  const wall = revealNextDora(wallAfterDraw);
  players = updatePlayer(players, action.player, (pl) => ({ ...pl, hand: addTileToHand(pl.hand, rinshanTile) }));

  return {
    ...round,
    players,
    wall,
    lastDrawnTile: rinshanTile,
    phase: "awaiting-discard",
    isRinshanTurn: true,
    kanCount: round.kanCount + 1,
    anyCallOrRiichiMade: true,
  };
}

function applyKakanAction(round: RoundState, action: KakanAction): RoundState {
  if (round.phase !== "awaiting-discard" || round.currentTurn !== action.player) {
    throw new Error("kakan: 加槓できる局面ではありません");
  }
  if (round.kanCount >= 4) throw new Error("kakan: これ以上カンできません（四槓散了）");
  const p = round.players[action.player];
  const { tile, hand: handAfterRemove } = removeTileFromHand(p.hand, action.tileId);
  const meldIdx = handAfterRemove.melds.findIndex((m) => m.type === "pon" && m.tiles[0]!.code === tile.code);
  if (meldIdx === -1) throw new Error("kakan: 対応するポンがありません");

  const existingMeld = handAfterRemove.melds[meldIdx]!;
  const newMeld: Meld = { type: "kakan", tiles: [...existingMeld.tiles, tile], calledFromRelative: existingMeld.calledFromRelative, calledTile: tile };
  const melds = [...handAfterRemove.melds];
  melds[meldIdx] = newMeld;
  const hand: Hand = { ...handAfterRemove, melds };

  const players = updatePlayer(round.players, action.player, (pl) => ({ ...pl, hand }));

  return {
    ...round,
    players,
    phase: "awaiting-calls",
    pendingCallWindow: {
      discarderIndex: action.player,
      discardTile: tile,
      isChankan: true,
      awaitingPlayers: otherPlayers(action.player),
      respondedBy: [],
      declaredCalls: [],
    },
  };
}

function finalizeKakanAfterChankanWindow(round: RoundState): RoundState {
  let players = clearAllIppatsu(round.players);
  const { tile: rinshanTile, wall: wallAfterDraw } = drawRinshan(round.wall);
  const wall = revealNextDora(wallAfterDraw);
  const player = round.pendingCallWindow!.discarderIndex;
  players = updatePlayer(players, player, (pl) => ({ ...pl, hand: addTileToHand(pl.hand, rinshanTile) }));
  return {
    ...round,
    players,
    wall,
    lastDrawnTile: rinshanTile,
    phase: "awaiting-discard",
    isRinshanTurn: true,
    pendingCallWindow: null,
    kanCount: round.kanCount + 1,
    anyCallOrRiichiMade: true,
    currentTurn: player,
  };
}

function applyChiAction(round: RoundState, action: ChiAction): RoundState {
  return applyCallDeclaration(round, action.player, { type: "chi", player: action.player, tileCodes: action.tileCodes, usedHandTileIds: action.usedHandTileIds });
}
function applyPonAction(round: RoundState, action: PonAction): RoundState {
  return applyCallDeclaration(round, action.player, { type: "pon", player: action.player, usedHandTileIds: action.usedHandTileIds });
}
function applyMinkanAction(round: RoundState, action: MinkanAction): RoundState {
  return applyCallDeclaration(round, action.player, { type: "minkan", player: action.player, usedHandTileIds: action.usedHandTileIds });
}
function applyRonDeclaration(round: RoundState, player: PlayerIndex): RoundState {
  return applyCallDeclaration(round, player, { type: "ron", player });
}

function applyCallDeclaration(round: RoundState, player: PlayerIndex, call: DeclaredCallAction): RoundState {
  const window = round.pendingCallWindow;
  if (!window || round.phase !== "awaiting-calls") throw new Error("call: 現在鳴き/ロンを宣言できる局面ではありません");
  if (!window.awaitingPlayers.includes(player)) throw new Error("call: このプレイヤーは応答対象ではありません");
  if (window.respondedBy.includes(player)) throw new Error("call: 既に応答済みです");

  const nextWindow: PendingCallWindow = {
    ...window,
    respondedBy: [...window.respondedBy, player],
    declaredCalls: [...window.declaredCalls, call],
  };
  return resolveCallWindowIfComplete({ ...round, pendingCallWindow: nextWindow });
}

function applySkipAction(round: RoundState, player: PlayerIndex): RoundState {
  const window = round.pendingCallWindow;
  if (!window || round.phase !== "awaiting-calls") throw new Error("skip: 現在応答できる局面ではありません");
  if (!window.awaitingPlayers.includes(player)) throw new Error("skip: このプレイヤーは応答対象ではありません");
  if (window.respondedBy.includes(player)) throw new Error("skip: 既に応答済みです");

  const nextWindow: PendingCallWindow = { ...window, respondedBy: [...window.respondedBy, player] };
  return resolveCallWindowIfComplete({ ...round, pendingCallWindow: nextWindow });
}

function resolveCallWindowIfComplete(round: RoundState): RoundState {
  const window = round.pendingCallWindow!;
  if (window.respondedBy.length < window.awaitingPlayers.length) {
    return round;
  }

  const ronCalls = window.declaredCalls.filter((c) => c.type === "ron");
  if (ronCalls.length > 0) {
    return buildWinRoundResult(round, ronCalls.map((c) => c.player) as PlayerIndex[], window.discarderIndex, window.isChankan);
  }

  if (window.isChankan) {
    return finalizeKakanAfterChankanWindow(round);
  }

  const kanOrPon = window.declaredCalls.find((c) => c.type === "pon" || c.type === "minkan");
  if (kanOrPon) {
    return executeMeldCall(round, window, kanOrPon);
  }

  const chi = window.declaredCalls.find((c) => c.type === "chi");
  if (chi) {
    return executeMeldCall(round, window, chi);
  }

  // 誰も鳴かなかった: 次のプレイヤーのツモ番へ
  return {
    ...round,
    pendingCallWindow: null,
    phase: "awaiting-draw",
    currentTurn: nextSeat(window.discarderIndex),
  };
}

function executeMeldCall(round: RoundState, window: PendingCallWindow, call: DeclaredCallAction): RoundState {
  if (call.type === "ron") throw new Error("unreachable");
  const discardTile = window.discardTile;
  const caller = call.player;
  const p = round.players[caller];

  let hand = p.hand;
  let meld: Meld;
  if (call.type === "pon") {
    for (const id of call.usedHandTileIds) hand = removeTileFromHand(hand, id).hand;
    meld = { type: "pon", tiles: [discardTile, ...call.usedHandTileIds.map((id) => findRemovedTile(p.hand, id))], calledFromRelative: relativeSeat(caller, window.discarderIndex), calledTile: discardTile };
  } else if (call.type === "minkan") {
    for (const id of call.usedHandTileIds) hand = removeTileFromHand(hand, id).hand;
    meld = { type: "minkan", tiles: [discardTile, ...call.usedHandTileIds.map((id) => findRemovedTile(p.hand, id))], calledFromRelative: relativeSeat(caller, window.discarderIndex), calledTile: discardTile };
  } else {
    for (const id of call.usedHandTileIds) hand = removeTileFromHand(hand, id).hand;
    meld = { type: "chi", tiles: [discardTile, ...call.usedHandTileIds.map((id) => findRemovedTile(p.hand, id))], calledFromRelative: relativeSeat(caller, window.discarderIndex), calledTile: discardTile };
  }
  hand = { ...hand, melds: [...hand.melds, meld] };

  let players = updatePlayer(round.players, caller, (pl) => ({ ...pl, hand }));
  players = updatePlayer(players, window.discarderIndex, (pl) => ({
    ...pl,
    discards: pl.discards.map((d) => (d.tile.id === discardTile.id ? { ...d, calledAway: true } : d)),
  }));
  players = clearAllIppatsu(players);

  const isKan = call.type === "minkan";
  if (isKan) {
    const { tile: rinshanTile, wall: wallAfterDraw } = drawRinshan(round.wall);
    const wall = revealNextDora(wallAfterDraw);
    players = updatePlayer(players, caller, (pl) => ({ ...pl, hand: addTileToHand(pl.hand, rinshanTile) }));
    return {
      ...round,
      players,
      wall,
      lastDrawnTile: rinshanTile,
      currentTurn: caller,
      phase: "awaiting-discard",
      isRinshanTurn: true,
      pendingCallWindow: null,
      kanCount: round.kanCount + 1,
      anyCallOrRiichiMade: true,
    };
  }

  return {
    ...round,
    players,
    currentTurn: caller,
    phase: "awaiting-discard",
    pendingCallWindow: null,
    anyCallOrRiichiMade: true,
    isRinshanTurn: false,
  };
}

function findRemovedTile(hand: Hand, id: string) {
  const tile = hand.concealed.find((t) => t.id === id);
  if (!tile) throw new Error(`tile ${id} not found`);
  return tile;
}

function relativeSeat(caller: PlayerIndex, from: PlayerIndex): 1 | 2 | 3 {
  return (((from - caller + 4) % 4) as 1 | 2 | 3);
}

function buildWinRoundResult(round: RoundState, winners: PlayerIndex[], discarder: PlayerIndex, chankan: boolean): RoundState {
  const dealerContinues = winners.includes(round.dealerSeat);
  void chankan;
  return {
    ...round,
    phase: "round-over",
    result: { type: "ron", winners, loser: discarder, dealerContinues },
  };
}

function applyTsumoAction(round: RoundState, player: PlayerIndex): RoundState {
  const analysis = canDeclareTsumo(round, player);
  if (!analysis) throw new Error("tsumo: 和了条件を満たしていません");
  return {
    ...round,
    phase: "round-over",
    result: { type: "tsumo", winners: [player], dealerContinues: player === round.dealerSeat },
  };
}

export function applyAction(round: RoundState, action: GameAction): RoundState {
  switch (action.type) {
    case "draw":
      return applyDrawAction(round, action.player);
    case "discard":
      return applyDiscardAction(round, action);
    case "riichi":
      return applyRiichiAction(round, action);
    case "chi":
      return applyChiAction(round, action);
    case "pon":
      return applyPonAction(round, action);
    case "minkan":
      return applyMinkanAction(round, action);
    case "ankan":
      return applyAnkanAction(round, action);
    case "kakan":
      return applyKakanAction(round, action);
    case "ron":
      return applyRonDeclaration(round, action.player);
    case "tsumo":
      return applyTsumoAction(round, action.player);
    case "kyushukyuhai":
      return applyKyushuKyuhaiAction(round, action.player);
    case "skip":
      return applySkipAction(round, action.player);
    default:
      throw new Error(`unknown action: ${JSON.stringify(action)}`);
  }
}

export interface RoundScoreOutcome {
  scoreDeltas: [number, number, number, number];
  winAnalyses: Partial<Record<PlayerIndex, { analysis: WinAnalysis; score: ScoreResult }>>;
}

/** 局終了結果から点数移動を計算する（供託・積み棒込み）。呼び出し側で match.scores に加算する。 */
export function computeRoundScoreOutcome(round: RoundState): RoundScoreOutcome {
  const deltas: [number, number, number, number] = [0, 0, 0, 0];
  const winAnalyses: RoundScoreOutcome["winAnalyses"] = {};
  const result = round.result;
  if (!result) return { scoreDeltas: deltas, winAnalyses };

  if (result.type === "tsumo") {
    const winner = result.winners[0]!;
    const winTile = round.lastDrawnTile!.code;
    const ctx = buildWinContext(round, winner, winTile, true);
    const analysis = analyzeWin(round.players[winner].hand, ctx)!;
    const score = scoreWin(analysis, winner === round.dealerSeat, true);
    const payments = applyHonba(score.payments, round.honba, true);
    winAnalyses[winner] = { analysis, score: { ...score, payments } };

    let received = payments.total + round.kyotaku * 1000;
    deltas[winner] += received;
    for (const other of otherPlayers(winner)) {
      const pay = winner === round.dealerSeat ? payments.fromEachNonDealer! : other === round.dealerSeat ? payments.fromDealer! : payments.fromEachNonDealer!;
      deltas[other] -= pay;
    }
  } else if (result.type === "ron") {
    const discarder = result.loser!;
    for (const winner of result.winners) {
      const winTile = round.pendingCallWindow?.discardTile.code ?? round.lastDiscard!.tile.code;
      const isChankan = round.pendingCallWindow?.isChankan ?? false;
      const winnerHand: Hand = {
        concealed: sortTiles([...round.players[winner].hand.concealed, { id: "__ronwin__", code: winTile }]),
        melds: round.players[winner].hand.melds,
      };
      const ctx = buildWinContext(round, winner, winTile, false, isChankan);
      const analysis = analyzeWin(winnerHand, ctx)!;
      const score = scoreWin(analysis, winner === round.dealerSeat, false);
      const payments = applyHonba(score.payments, round.honba, false);
      winAnalyses[winner] = { analysis, score: { ...score, payments } };
      deltas[winner] += payments.total;
      deltas[discarder] -= payments.fromDiscarder!;
    }
    deltas[result.winners[0]!] += round.kyotaku * 1000;
  } else if (result.type === "exhaustive-draw") {
    const tenpai = result.tenpaiPlayers ?? [];
    const noten = ([0, 1, 2, 3] as PlayerIndex[]).filter((p) => !tenpai.includes(p));
    if (tenpai.length > 0 && tenpai.length < 4) {
      const totalPot = 3000;
      const perTenpai = totalPot / tenpai.length;
      const perNoten = totalPot / noten.length;
      for (const p of tenpai) deltas[p] += perTenpai;
      for (const p of noten) deltas[p] -= perNoten;
    }
  }

  return { scoreDeltas: deltas, winAnalyses };
}
