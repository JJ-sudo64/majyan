/**
 * 座席ごとの「見え方」。
 *
 * ネット対戦ではサーバーが本物の対局状態（MatchState）を持ち、各プレイヤーには
 * その座席から見えてよい情報だけを渡す。ここではそのための純粋関数をまとめる:
 * - redactMatchForSeat: 他家の手牌・山など、その座席から見えない牌の中身を伏せる
 * - computeSeatOptions: その座席が今選べる操作（本物の状態から計算する。伏せた
 *   状態のまま canUseSkill 等を呼ぶと、山や他家の状態を見る判定が狂うため）
 * - rotateMatchForViewer 等: 画面は「自分＝座席0（手前）」前提で描いているため、
 *   見る人の座席が0番に来るよう座席番号を回す（ローカル対戦の人間は常に座席0
 *   なので何も変わらない）。操作を送り返す時は actionFromViewer で元の座席へ戻す。
 */
import type { Tile, TileCode } from "./tiles.js";
import { compareTileCode } from "./tiles.js";
import type { GameAction, PlayerIndex } from "./actions.js";
import type {
  DeclaredCallAction,
  MatchState,
  PendingCallWindow,
  PlayerRoundState,
  RoundEndResult,
  RoundState,
} from "./gameState.js";
import type { WallState } from "./wall.js";
import type { WinAnalysis } from "./yaku/index.js";
import { CHARACTERS } from "./characters.js";
import {
  ankanOptions,
  borrowSkillBlockReason,
  canDeclareRon,
  canDeclareTsumo,
  canKyushuKyuhai,
  canRiichi,
  canSwapStartingTile,
  canUseCard,
  canUseSkill,
  kakanOptions,
  reclaimableDiscardTileIds,
  riichiCandidateTileIds,
  type RoundScoreOutcome,
} from "./gameEngine.js";
import { canRespondToCall, computeCallOptions, type CallOptions } from "./matchController.js";

const SEATS: readonly PlayerIndex[] = [0, 1, 2, 3];

// ---------------------------------------------------------------------------
// 情報の秘匿
// ---------------------------------------------------------------------------

/** 伏せた牌に入れておくダミーの牌コード（Tile.hidden===trueの時は意味を持たない）。 */
export const HIDDEN_TILE_CODE: TileCode = "1z";

function hideTile(tile: Tile): Tile {
  return { id: tile.id, code: HIDDEN_TILE_CODE, hidden: true };
}

/** 王牌の中で、ドラ表示牌として既にめくられている位置か（wall.tsのレイアウト参照）。 */
function isRevealedDoraIndicator(wall: WallState, index: number): boolean {
  const offset = index - 4;
  return offset >= 0 && offset % 2 === 0 && offset / 2 < wall.revealedDoraCount;
}

/**
 * その座席から見えない情報を伏せたRoundStateを返す（型は同じなので画面側は
 * そのまま描画できる）。伏せるもの:
 * - 他家の手の内（カゲロウの「透視の術」で見えている間・オープンリーチ中・
 *   局終了時の和了者/テンパイ者は公開）
 * - 他家の直前のツモ牌（lastDrawnTile）
 * - 山（残り枚数だけ見せる。スバルの「山読み」中は、並び順が分からないよう
 *   牌種順に並べ替えて中身だけ見せる）
 * - 王牌（めくられたドラ表示牌以外。局終了時は裏ドラ確認のため表示牌の枠を全て公開）
 * - 他家だけが知っている内部状態（未来視の予知牌・テンパイ判定・盾などの権利）
 * - 鳴きの応答中、他家が既に宣言した鳴き・既に応答したかどうか（解決前に見えると
 *   判断が有利になる）
 * 牌のIDは伏せない（buildWallがシャッフル後の並びでIDを振るため、IDから
 * 牌の種類は分からない）。山の牌だけは山読みの並べ替えで位置が漏れないよう
 * 並び順の番号に振り直す。
 */
export function redactRoundForSeat(round: RoundState, seat: PlayerIndex | null): RoundState {
  const roundOver = round.phase === "round-over";
  const shownAtEnd = new Set<PlayerIndex>(
    roundOver && round.result ? [...round.result.winners, ...(round.result.tenpaiPlayers ?? [])] : [],
  );
  const hiddenIds = new Set<string>();
  const players = round.players.map((p, i): PlayerRoundState => {
    if (i === seat) return p;
    // seatがnull（観戦者）の時、誰にも公開されていない(null)と一致させないよう、席がある時だけ比べる。
    const handVisible = (seat !== null && round.handsRevealedTo === seat) || p.openRiichi || shownAtEnd.has(i as PlayerIndex);
    if (!handVisible) for (const t of p.hand.concealed) hiddenIds.add(t.id);
    return {
      ...p,
      hand: handVisible ? p.hand : { ...p.hand, concealed: p.hand.concealed.map(hideTile) },
      isTenpai: roundOver ? p.isTenpai : false,
      revealedFutureDraws: [],
      guaranteedRinshan: false,
      guaranteedUraDora: false,
      guaranteedUsefulDraw: false,
      bettaoriShield: false,
      // 見逃しフリテンは、その人がその牌で待っていた（テンパイしている）ことを表すので伏せる。
      missedRonFuriten: false,
      riichiFuriten: false,
    };
  }) as RoundState["players"];

  const liveTiles =
    seat !== null && round.wallReadRevealedTo === seat
      ? [...round.wall.liveTiles]
          .sort((a, b) => compareTileCode(a.code, b.code))
          .map((t, i): Tile => ({ id: `live-${i}`, code: t.code, ...(t.isRed ? { isRed: true } : {}) }))
      : round.wall.liveTiles.map((_, i): Tile => ({ id: `live-${i}`, code: HIDDEN_TILE_CODE, hidden: true }));
  const wall: WallState = {
    ...round.wall,
    liveTiles,
    // 局終了時は裏ドラ確認のため表示牌の枠(index 4以降)を全て公開するが、嶺上牌の
    // 枠(0〜3)は公開しない。drawRinshanは引いた嶺上牌を王牌の配列に残したままに
    // するため、既に誰かが引いて手に持っている牌の中身まで見えてしまう。
    deadWall: round.wall.deadWall.map((t, i) =>
      (roundOver && i >= 4) || isRevealedDoraIndicator(round.wall, i) ? t : hideTile(t),
    ),
  };

  const lastDrawnTile = round.lastDrawnTile && hiddenIds.has(round.lastDrawnTile.id) ? hideTile(round.lastDrawnTile) : round.lastDrawnTile;
  // 他家の応答状況も伏せる。鳴ける選択肢の無い人は即座に見送られるため、
  // 「誰がまだ答えていないか」が見えると、その人が鳴ける・テンパイ等とばれる。
  const pendingCallWindow = round.pendingCallWindow && {
    ...round.pendingCallWindow,
    respondedBy: round.pendingCallWindow.respondedBy.filter((p) => p === seat),
    declaredCalls: round.pendingCallWindow.declaredCalls.filter((c) => c.player === seat),
  };
  return { ...round, players, wall, lastDrawnTile, pendingCallWindow };
}

export function redactMatchForSeat(match: MatchState, seat: PlayerIndex | null): MatchState {
  return { ...match, round: redactRoundForSeat(match.round, seat) };
}

/** 観戦者に見せる版。どの席の手の内も見せない（誰にでも見えている情報だけ）。 */
export function redactMatchForSpectator(match: MatchState): MatchState {
  return redactMatchForSeat(match, null);
}

// ---------------------------------------------------------------------------
// その座席が選べる操作
// ---------------------------------------------------------------------------

/** 自分の手番（ツモ後・打牌前）に選べる操作。 */
export interface TurnOptions {
  /** ツモ和了できるならその判定結果（役の表示にも使う）。 */
  tsumo: WinAnalysis | null;
  canRiichi: boolean;
  /** リーチ宣言と同時に切れる牌のID。 */
  riichiTileIds: string[];
  ankan: TileCode[];
  kakan: string[];
  kyushuKyuhai: boolean;
  skill: boolean;
  /** カリンの「借り物競争」でゲージ満タンの時の相手一覧。今借りられない相手も
      理由付きで含める（黙って消すと不具合に見えるとの指摘により）。 */
  borrowTargets: { target: PlayerIndex; blockReason: string | null }[];
  /** ミオの「取り返し」が使えるか（ゲージ満タン・リーチ前・取り返せる牌がある）。 */
  retrieve: boolean;
  card: boolean;
}

export interface SeatOptions {
  /** 自分の手番でなければnull。 */
  turn: TurnOptions | null;
  /** 応答すべき呼び出しウィンドウが無ければnull。 */
  call: (CallOptions & { ronAnalysis: WinAnalysis | null }) | null;
  /** ルナの「運命の采配」による配牌交換がいま使えるか（手番に関係なく使える）。 */
  canSwapStartingTile: boolean;
}

export function computeTurnOptions(round: RoundState, seat: PlayerIndex): TurnOptions | null {
  if (round.currentTurn !== seat || round.phase !== "awaiting-discard") return null;
  const player = round.players[seat];
  const character = CHARACTERS[round.characterIds[seat]];
  const gaugeFull = !!character && player.skillGauge >= character.gaugeMax;
  const riichiOk = canRiichi(round, seat);
  return {
    tsumo: canDeclareTsumo(round, seat),
    canRiichi: riichiOk,
    riichiTileIds: riichiOk ? riichiCandidateTileIds(round, seat) : [],
    ankan: ankanOptions(round, seat),
    kakan: kakanOptions(round, seat),
    kyushuKyuhai: canKyushuKyuhai(round, seat),
    skill: canUseSkill(round, seat),
    borrowTargets:
      character?.borrowsSkill && gaugeFull
        ? SEATS.filter((s) => s !== seat).map((target) => ({ target, blockReason: borrowSkillBlockReason(round, seat, target) }))
        : [],
    retrieve: !!character?.retrievesDiscard && !player.riichi && gaugeFull && reclaimableDiscardTileIds(round, seat).length > 0,
    card: canUseCard(round, seat),
  };
}

export function computeSeatOptions(round: RoundState, seat: PlayerIndex): SeatOptions {
  let call: SeatOptions["call"] = null;
  if (canRespondToCall(round, seat)) {
    const options = computeCallOptions(round, seat);
    const window = round.pendingCallWindow!;
    const ronAnalysis = options.canRon
      ? canDeclareRon(round, seat, window.discardTile.code, window.discarderIndex, window.isChankan)
      : null;
    call = { ...options, ronAnalysis };
  }
  return { turn: computeTurnOptions(round, seat), call, canSwapStartingTile: canSwapStartingTile(round, seat) };
}

// ---------------------------------------------------------------------------
// 見る人の座席を0番に回す
// ---------------------------------------------------------------------------

/** 本物の座席番号 → 見る人(viewer)から見た座席番号（自分=0、下家=1、対面=2、上家=3）。 */
export function toViewerSeat(seat: PlayerIndex, viewer: PlayerIndex): PlayerIndex {
  return ((seat - viewer + 4) % 4) as PlayerIndex;
}

/** 見る人から見た座席番号 → 本物の座席番号（toViewerSeatの逆）。 */
export function fromViewerSeat(seat: PlayerIndex, viewer: PlayerIndex): PlayerIndex {
  return ((seat + viewer) % 4) as PlayerIndex;
}

type Four<T> = [T, T, T, T];
function rotateFour<T>(arr: Four<T>, viewer: PlayerIndex): Four<T> {
  return [arr[viewer]!, arr[(viewer + 1) % 4]!, arr[(viewer + 2) % 4]!, arr[(viewer + 3) % 4]!];
}

function rotateDeclaredCall(call: DeclaredCallAction, viewer: PlayerIndex): DeclaredCallAction {
  return { ...call, player: toViewerSeat(call.player, viewer) };
}

function rotateCallWindow(w: PendingCallWindow, viewer: PlayerIndex): PendingCallWindow {
  // スプレッドを使わず全フィールドを列挙しているのは、座席番号を持つ
  // フィールドが後から増えた時に回し忘れないよう、型エラーで気付けるようにするため
  // （rotateRoundForViewer等も同じ）。
  return {
    discarderIndex: toViewerSeat(w.discarderIndex, viewer),
    discardTile: w.discardTile,
    isChankan: w.isChankan,
    awaitingPlayers: w.awaitingPlayers.map((p) => toViewerSeat(p, viewer)),
    respondedBy: w.respondedBy.map((p) => toViewerSeat(p, viewer)),
    declaredCalls: w.declaredCalls.map((c) => rotateDeclaredCall(c, viewer)),
  };
}

function rotateResult(r: RoundEndResult, viewer: PlayerIndex): RoundEndResult {
  return {
    type: r.type,
    winners: r.winners.map((p) => toViewerSeat(p, viewer)),
    ...(r.loser !== undefined ? { loser: toViewerSeat(r.loser, viewer) } : {}),
    ...(r.tenpaiPlayers !== undefined ? { tenpaiPlayers: r.tenpaiPlayers.map((p) => toViewerSeat(p, viewer)) } : {}),
    dealerContinues: r.dealerContinues,
  };
}

const rotateNullableSeat = (seat: PlayerIndex | null, viewer: PlayerIndex) => (seat === null ? null : toViewerSeat(seat, viewer));

export function rotateRoundForViewer(round: RoundState, viewer: PlayerIndex): RoundState {
  return {
    format: round.format,
    roundWind: round.roundWind,
    roundNumber: round.roundNumber,
    honba: round.honba,
    kyotaku: round.kyotaku,
    dealerSeat: toViewerSeat(round.dealerSeat, viewer),
    players: rotateFour(round.players, viewer),
    wall: round.wall,
    currentTurn: toViewerSeat(round.currentTurn, viewer),
    phase: round.phase,
    lastDiscard: round.lastDiscard && { player: toViewerSeat(round.lastDiscard.player, viewer), tile: round.lastDiscard.tile },
    lastDrawnTile: round.lastDrawnTile,
    isRinshanTurn: round.isRinshanTurn,
    pendingCallWindow: round.pendingCallWindow && rotateCallWindow(round.pendingCallWindow, viewer),
    kanCount: round.kanCount,
    result: round.result && rotateResult(round.result, viewer),
    characterIds: rotateFour(round.characterIds, viewer),
    anyCallOrRiichiMade: round.anyCallOrRiichiMade,
    handsRevealedTo: rotateNullableSeat(round.handsRevealedTo, viewer),
    wallReadRevealedTo: rotateNullableSeat(round.wallReadRevealedTo, viewer),
    dealerRenchanByWin: round.dealerRenchanByWin,
    riichiLockedBy: rotateNullableSeat(round.riichiLockedBy, viewer),
    tomohiroGuardCount: round.tomohiroGuardCount,
    cardIds: rotateFour(round.cardIds, viewer),
    cardUsesRemaining: rotateFour(round.cardUsesRemaining, viewer),
    cardNegateArmed: rotateFour(round.cardNegateArmed, viewer),
    cardBonusHan: rotateFour(round.cardBonusHan, viewer),
    cardExtraUraDora: rotateFour(round.cardExtraUraDora, viewer),
    cardScoreDoubled: rotateFour(round.cardScoreDoubled, viewer),
    pendingScoreAdjustment: round.pendingScoreAdjustment && rotateFour(round.pendingScoreAdjustment, viewer),
    lastActivatedSkill: round.lastActivatedSkill && {
      owner: toViewerSeat(round.lastActivatedSkill.owner, viewer),
      characterId: round.lastActivatedSkill.characterId,
    },
    ...(round.reclaimedDrawnTileId !== undefined ? { reclaimedDrawnTileId: round.reclaimedDrawnTileId } : {}),
    ...(round.pendingRiichiStick !== undefined ? { pendingRiichiStick: rotateNullableSeat(round.pendingRiichiStick, viewer) } : {}),
    ...(round.points ? { points: rotateFour(round.points, viewer) } : {}),
  };
}

export function rotateMatchForViewer(match: MatchState, viewer: PlayerIndex): MatchState {
  return {
    format: match.format,
    scores: rotateFour(match.scores, viewer),
    round: rotateRoundForViewer(match.round, viewer),
    finished: match.finished,
    finalRanking: match.finalRanking && match.finalRanking.map((p) => toViewerSeat(p, viewer)),
    startingDealer: toViewerSeat(match.startingDealer, viewer),
    continueBelowZero: match.continueBelowZero,
  };
}

export function rotateOutcomeForViewer(outcome: RoundScoreOutcome, viewer: PlayerIndex): RoundScoreOutcome {
  const winAnalyses: RoundScoreOutcome["winAnalyses"] = {};
  for (const seat of SEATS) {
    const entry = outcome.winAnalyses[seat];
    if (entry) winAnalyses[toViewerSeat(seat, viewer)] = entry;
  }
  return { scoreDeltas: rotateFour(outcome.scoreDeltas, viewer), winAnalyses };
}

export function rotateSeatOptionsForViewer(options: SeatOptions, viewer: PlayerIndex): SeatOptions {
  return {
    turn: options.turn && {
      ...options.turn,
      borrowTargets: options.turn.borrowTargets.map((b) => ({ target: toViewerSeat(b.target, viewer), blockReason: b.blockReason })),
    },
    call: options.call,
    canSwapStartingTile: options.canSwapStartingTile,
  };
}

/** 見る人の座席番号で組み立てた操作を、本物の座席番号の操作に戻す。 */
export function actionFromViewer(action: GameAction, viewer: PlayerIndex): GameAction {
  const player = fromViewerSeat(action.player, viewer);
  if (action.type === "borrowSkill") return { ...action, player, target: fromViewerSeat(action.target, viewer) };
  return { ...action, player };
}
