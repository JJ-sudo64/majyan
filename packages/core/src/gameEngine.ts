import {
  prevTileForDora,
  sortTiles,
  tileCodeToIndex,
  type Tile,
  type TileCode,
  type Wind,
} from "./tiles.js";
import {
  addTileToHand,
  allHandTileCodes,
  createEmptyHand,
  getWaitingTiles,
  isConcealedHand,
  removeTileFromHand,
  tileCodeCounts,
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
  extraUraDoraIndicator,
  forceFirstUraDoraIndicator,
  liveTilesRemaining,
  type WallState,
} from "./wall.js";
import { analyzeWin, type WinAnalysis, type WinContext } from "./yaku/index.js";
import { scoreWin, applyHonba, type PaymentBreakdown, type ScoreResult } from "./scoring.js";
import { CHARACTERS } from "./characters.js";
import { CARDS } from "./cards.js";
import { globalRoundIndex, maxGlobalRoundIndex } from "./matchFormat.js";
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
  SwapTilesAction,
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

/** 一発を全員ぶん消す（鳴き/カン等が入った瞬間に呼ぶ）。カード「一発延長」を
    持つプレイヤーだけは、自分の一発中に限り1度だけ消えずに継続する
    （カードはその瞬間に消費される）。 */
function clearAllIppatsu(
  round: RoundState,
  players: RoundState["players"],
): { players: RoundState["players"]; cardUsesRemaining: RoundState["cardUsesRemaining"] } {
  const cardUsesRemaining = [...round.cardUsesRemaining] as RoundState["cardUsesRemaining"];
  const next = players.map((p, i) => {
    if (!p.ippatsuActive) return p;
    if (round.cardIds[i] === "ippatsu-extend" && cardUsesRemaining[i]! > 0) {
      cardUsesRemaining[i]!--;
      return p;
    }
    return { ...p, ippatsuActive: false };
  }) as RoundState["players"];
  return { players: next, cardUsesRemaining };
}

interface RinshanResolution {
  tile: Tile;
  wall: WallState;
  clearGuarantee: boolean;
}

/** トキの必殺技で予約された「次に聴牌中でカンしたら嶺上開花」の保証を、
    実際のカン（暗槓/加槓/大明槓のいずれも）の嶺上ツモに適用する。
    聴牌でなければ何もせず保証を温存する。聴牌でのカンであれば、山に
    残っている待ち牌1枚と嶺上ツモをすり替えて成功させる（成功/不発を
    問わず、聴牌でのカンが実際に起きた時点で保証は消費される）。 */
function resolveGuaranteedRinshan(
  players: RoundState["players"],
  player: PlayerIndex,
  meldedHand: Hand,
  rinshanTile: Tile,
  wall: WallState,
): RinshanResolution {
  if (!players[player].guaranteedRinshan || calcShanten(meldedHand) !== 0) {
    return { tile: rinshanTile, wall, clearGuarantee: false };
  }
  const waits = new Set(getWaitingTiles(meldedHand));
  const wallIndex = wall.liveTiles.findIndex((t) => waits.has(t.code));
  if (wallIndex === -1) {
    return { tile: rinshanTile, wall, clearGuarantee: true };
  }
  const target = wall.liveTiles[wallIndex]!;
  const liveTiles = [...wall.liveTiles.slice(0, wallIndex), ...wall.liveTiles.slice(wallIndex + 1), rinshanTile];
  return { tile: target, wall: { ...wall, liveTiles }, clearGuarantee: true };
}

/** 必殺技ゲージを加算する（キャラのgaugeMaxで頭打ち）。キャラ未設定なら何もしない。
    ルナの「運命の采配」発動後、次局の配牌入れ替えがまだ未消費(pendingTileSwapNextRound)
    の間はゲージ加算自体を止める。これが無いと次局を待つ間にもゲージが再度満タンに
    なり、効果の解決を待たずに何度も連発できてしまう。 */
/** オーラス（この対局形式の最終局。本場を重ねている間もroundWind/roundNumberは
    据え置きなのでその間ずっとtrueのまま）かどうか。カード「最後の粘り」用。 */
function isFinalHand(round: RoundState): boolean {
  return globalRoundIndex(round.roundWind, round.roundNumber) === maxGlobalRoundIndex(round.format);
}

function gainGauge(round: RoundState, player: PlayerIndex, players: RoundState["players"], amount: number): RoundState["players"] {
  const character = CHARACTERS[round.characterIds[player]];
  if (!character || amount <= 0) return players;
  if (players[player].pendingTileSwapNextRound) return players;
  // カード「最後の粘り」: 持っているだけの常時効果。オーラスの間だけゲージ
  // 増加量が2倍になる（消費はされない）。
  const boosted = round.cardIds[player] === "last-stand" && isFinalHand(round) ? amount * 2 : amount;
  return updatePlayer(players, player, (pl) => ({ ...pl, skillGauge: Math.min(character.gaugeMax, pl.skillGauge + boosted) }));
}

/** 発動者以外の座席で「無効化」カードが構えられていれば、その座席番号を返す
    （複数居れば最初の1人）。必殺技の能動的な発動（onActivate/onRiichi）2箇所
    でだけ使う（onDealHand/onBeforeDraw等のパッシブは対象外）。 */
function findNegatingCardOwner(round: RoundState, activatingPlayer: PlayerIndex): PlayerIndex | null {
  for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
    if (seat === activatingPlayer) continue;
    if (round.cardIds[seat] !== null && round.cardNegateArmed[seat]) return seat;
  }
  return null;
}

function disarmNegate(round: RoundState, seat: PlayerIndex): RoundState {
  const next = [...round.cardNegateArmed] as RoundState["cardNegateArmed"];
  next[seat] = false;
  return { ...round, cardNegateArmed: next };
}

export { getWaitingTiles };

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
    openRiichi: p.openRiichi,
    haitei: isTsumo && liveTilesRemaining(round.wall) === 0,
    houtei: !isTsumo && !chankan && liveTilesRemaining(round.wall) === 0,
    rinshan: isTsumo && round.isRinshanTurn,
    chankan,
    doraIndicators: doraIndicators(round.wall),
    // カード「裏ドラ倍加」使用済みの立直和了には、通常公開ぶんに加えてもう1枚
    // 裏ドラ表示牌を追加する（王牌に対応する枠が無ければextraUraDoraIndicatorが
    // nullを返し不発）。
    uraDoraIndicators: (() => {
      const base = uraDoraIndicators(round.wall);
      if (!p.riichi || !round.cardExtraUraDora[player]) return base;
      const extra = extraUraDoraIndicator(round.wall);
      return extra ? [...base, extra] : base;
    })(),
    // カード「小手先の一翻」「会心の二翻」で加算される翻数。カードの持ち主
    // 本人の和了にのみ乗る。
    bonusHan: round.cardBonusHan[player],
  };
}

export function canDeclareTsumo(round: RoundState, player: PlayerIndex): WinAnalysis | null {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return null;
  const p = round.players[player];
  if (!round.lastDrawnTile) return null;
  const ctx = buildWinContext(round, player, round.lastDrawnTile.code, true);
  return analyzeWin(p.hand, ctx);
}

/** 和了判定そのもの（フリテンチェック込み）。タカハルの「アトミックベタ降り」の
    盾は「そのプレイヤーからは誰もロンできない」という別枠の防御であって
    フリテンとは無関係なため、ここでは含めない（canDeclareRon側で別途チェックする）。 */
function analyzeRonForPlayer(round: RoundState, player: PlayerIndex, discardTile: TileCode, chankan: boolean): WinAnalysis | null {
  const p = round.players[player];
  // カード「フリテン解除」: 持っていて未消費の間はフリテンでもロン判定を通す
  // （実際に成立した瞬間の消費はapplyRonDeclaration側で行う）。
  const furitenCleared = round.cardIds[player] === "furiten-clear" && round.cardUsesRemaining[player] > 0;
  if (isFuriten(p) && !furitenCleared) return null;
  const testHand: Hand = { concealed: sortTiles([...p.hand.concealed, { id: "__ron__", code: discardTile }]), melds: p.hand.melds };
  const ctx = buildWinContext(round, player, discardTile, false, chankan);
  return analyzeWin(testHand, ctx);
}

export function canDeclareRon(round: RoundState, player: PlayerIndex, discardTile: TileCode, discarder: PlayerIndex, chankan = false): WinAnalysis | null {
  // タカハルの「アトミックベタ降り」: 盾が立っている間はその捨て牌からは
  // 誰もロンできない（成立した瞬間、applyDiscardAction/applyRiichiAction側で消費される）。
  if (round.players[discarder]!.bettaoriShield) return null;
  // カード「一閃の盾」: 持っていて未消費の間は同様にその捨て牌からロンできない
  // （成立した瞬間、resolveCallWindowIfComplete側で消費される）。
  if (round.cardIds[discarder] === "houjuu-guard" && round.cardUsesRemaining[discarder] > 0) return null;
  return analyzeRonForPlayer(round, player, discardTile, chankan);
}

export function canRiichi(round: RoundState, player: PlayerIndex): boolean {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return false;
  const p = round.players[player];
  if (p.riichi) return false;
  // にゃん次郎の「アトミックリーチ」が発動した局は、発動者以外リーチできない。
  if (round.riichiLockedBy !== null && round.riichiLockedBy !== player) return false;
  if (!isConcealedHand(p.hand)) return false;
  if (liveTilesRemaining(round.wall) < 4) return false;
  // いずれか1枚を切ればテンパイになる（=リーチ可能な形をしている）ことを確認する。
  // これが無いと、テンパイしていない手でもリーチボタンが常に表示されてしまう。
  if (riichiCandidateTileIds(round, player).length === 0) return false;
  // 25000点持ちルールに限らずシンプルに1000点以上を要求
  return true;
}

/** 必殺技ゲージが満タンで、かつ自分の打牌前（ツモ直後）で発動できる状況かどうか。
    リーチ後は打牌そのものを選べない（ツモ切り強制）ため、手牌を動かせる余地の
    ある必殺技も同様に使えない（canRetrieveDiscardと同じ理由）。 */
export function canUseSkill(round: RoundState, player: PlayerIndex): boolean {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return false;
  if (round.players[player]!.riichi) return false;
  const character = CHARACTERS[round.characterIds[player]];
  if (!character || !character.skill.hooks.onActivate) return false;
  if (round.players[player]!.skillGauge < character.gaugeMax) return false;
  const canActivate = character.skill.hooks.canActivate;
  if (canActivate && !canActivate({ round, owner: player })) return false;
  return true;
}

/** カリンの「借り物」が今、指定した相手(target)の必殺技を借りて発動できるかどうか。
    自分自身のゲージが満タンで、targetがonActivateを持ち、かつtarget側の追加発動条件
    （canActivate。例: ライコの「一発中のみ」）を借りる側（player）が満たしている
    必要がある（カガミのcanCopyLastSkillと同様の考え方。characters.ts参照）。
    canUseSkillと同じ理由でリーチ中は使えない。 */
export function canBorrowSkill(round: RoundState, player: PlayerIndex, target: PlayerIndex): boolean {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return false;
  if (round.players[player]!.riichi) return false;
  if (target === player) return false;
  const character = CHARACTERS[round.characterIds[player]];
  if (!character?.borrowsSkill) return false;
  if (round.players[player]!.skillGauge < character.gaugeMax) return false;
  const targetHooks = CHARACTERS[round.characterIds[target]]?.skill.hooks;
  if (!targetHooks?.onActivate) return false;
  if (targetHooks.canActivate && !targetHooks.canActivate({ round, owner: player })) return false;
  return true;
}

/** カリンが今借りられる相手の一覧（自分以外で条件を満たす席）。UI側の選択肢表示用。 */
export function borrowableSkillTargets(round: RoundState, player: PlayerIndex): PlayerIndex[] {
  return ([0, 1, 2, 3] as PlayerIndex[]).filter((seat) => canBorrowSkill(round, player, seat));
}

/** ミオの「取り返し」用: 自分の河のうち鳴かれていない（calledAway===false）discardの
    tile idの一覧。これらだけが手牌に戻せる対象（鳴かれてしまったものは既に他家の
    副露に組み込まれているため戻せない）。 */
export function reclaimableDiscardTileIds(round: RoundState, player: PlayerIndex): string[] {
  return round.players[player]!.discards.filter((d) => !d.calledAway).map((d) => d.tile.id);
}

/** ミオの「取り返し」が今、指定した河の1枚(reclaimTileId)を手牌の指定した1枚
    (replacementTileId)と交換して発動できるかどうか。リーチ中は打牌そのものを
    選べない（ツモ切り強制）ため、この技も使えない。 */
export function canRetrieveDiscard(
  round: RoundState,
  player: PlayerIndex,
  reclaimTileId: string,
  replacementTileId: string,
): boolean {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return false;
  const character = CHARACTERS[round.characterIds[player]];
  if (!character?.retrievesDiscard) return false;
  const p = round.players[player]!;
  if (p.riichi) return false;
  if (p.skillGauge < character.gaugeMax) return false;
  if (!reclaimableDiscardTileIds(round, player).includes(reclaimTileId)) return false;
  if (!p.hand.concealed.some((t) => t.id === replacementTileId)) return false;
  return true;
}

/** 所持カード（消費型のみ）が今使えるかどうか。canUseSkillと同じ構え
    （自分の打牌前＝ツモ直後）で使う。パッシブカード（onDealHandのみ持つ）は
    useCardアクション自体が無いため対象外。 */
export function canUseCard(round: RoundState, player: PlayerIndex): boolean {
  if (round.currentTurn !== player || round.phase !== "awaiting-discard") return false;
  const cardId = round.cardIds[player];
  if (cardId === null) return false;
  if (round.cardUsesRemaining[player] <= 0) return false;
  const card = CARDS[cardId];
  return !!card && card.kind === "consumable" && !!card.hooks.onUse;
}

/** ルナの必殺技で得た配牌入れ替え権が今使えるかどうか。手番順とは無関係に、
    「まだ一度も打牌・副露しておらず、自分の配牌がそのまま残っている」間だけ使える。 */
export function canSwapStartingTile(round: RoundState, player: PlayerIndex): boolean {
  if (round.phase === "round-over") return false;
  const p = round.players[player];
  return p.tileSwapsRemaining > 0 && p.discards.length === 0 && p.hand.melds.length === 0;
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

/** 打牌が解決される瞬間、次の手番をどうするか決める共通処理。通常は
    応答ウィンドウ（鳴き/ロン）を開いて他家に回すが、discarderが必殺技
    「時を止める」の効果中（timeStopTurnsRemaining>0）の間は、応答ウィンドウ
    自体を作らずdiscarderの次のツモへ直接進む。残り回数を1減らし、それでも
    まだ0より大きければ手番はdiscarder自身に戻る（＝2巡連続で行動できる）。
    0になった時点で通常通り次家(nextSeat)へ手番が進む。
    applyDiscardAction/applyRiichiActionの両方から使う。 */
function resolveDiscardTurnTransition(round: RoundState, discarder: PlayerIndex, tile: Tile): RoundState {
  // ??0で防御する: undefined <= 0 はfalseになる（比較前にNaNへ変換される
  // ため）ため、素の値のままだと未初期化時に誤って「時間停止中」の分岐へ
  // 入ってしまう（応答ウィンドウを開かずに手番だけ進めてしまう）。
  const remaining = round.players[discarder]!.timeStopTurnsRemaining ?? 0;
  if (remaining <= 0) {
    return {
      ...round,
      lastDiscard: { player: discarder, tile },
      phase: "awaiting-calls",
      pendingCallWindow: startCallWindow(round, discarder, { player: discarder, tile }, false),
    };
  }
  const nextRemaining = remaining - 1;
  const players = updatePlayer(round.players, discarder, (pl) => ({ ...pl, timeStopTurnsRemaining: nextRemaining }));
  return {
    ...round,
    players,
    lastDiscard: { player: discarder, tile },
    pendingCallWindow: null,
    phase: "awaiting-draw",
    currentTurn: nextRemaining > 0 ? discarder : nextSeat(discarder),
  };
}

function buildExhaustiveDrawResult(round: RoundState): RoundState {
  const tenpaiPlayers: PlayerIndex[] = [];
  const cardUsesRemaining = [...round.cardUsesRemaining] as RoundState["cardUsesRemaining"];
  for (const idx of [0, 1, 2, 3] as PlayerIndex[]) {
    if (calcShanten(round.players[idx].hand) === 0) {
      tenpaiPlayers.push(idx);
      continue;
    }
    // カード「聴牌保険」: 自力でノーテンでも1度だけテンパイ扱いにしてもらえる
    // （ノーテン罰符を回避できる）。実際に発動した瞬間にだけ消費する。
    if (round.cardIds[idx] === "tenpai-insurance" && cardUsesRemaining[idx] > 0) {
      tenpaiPlayers.push(idx);
      cardUsesRemaining[idx] -= 1;
    }
  }
  const dealerContinues = tenpaiPlayers.includes(round.dealerSeat);
  return {
    ...round,
    cardUsesRemaining,
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
  // トモヒロの「手牌が一枚しかいない人」等、他家のツモ牌を操作するパッシブ
  // 効果を実際にツモを引く前に適用する。持ち主自身のツモには影響しないよう
  // 各hooks側でowner===drawerを弾く前提。
  let preDrawRound = round;
  for (const owner of [0, 1, 2, 3] as PlayerIndex[]) {
    const onBeforeDraw = CHARACTERS[preDrawRound.characterIds[owner]]?.skill.hooks.onBeforeDraw;
    if (onBeforeDraw) preDrawRound = onBeforeDraw({ round: preDrawRound, owner }, player);
  }
  const { tile, wall } = drawFromLive(preDrawRound.wall);
  const players = updatePlayer(preDrawRound.players, player, (p) => ({
    ...p,
    hand: addTileToHand(p.hand, tile),
    // ミライの「未来視」も、予知した本人が次に自分でツモした瞬間＝1巡した
    // 瞬間に古い予知として消える（下のhandsRevealedToと同じ「1巡で切れる」設計）。
    revealedFutureDraws: [],
  }));
  // カゲロウの「透視の術」は発動者が次に自分でツモした瞬間＝1巡した瞬間に切れる。
  const handsRevealedTo = preDrawRound.handsRevealedTo === player ? null : preDrawRound.handsRevealedTo;
  return { ...preDrawRound, wall, players, lastDrawnTile: tile, phase: "awaiting-discard", isRinshanTurn: false, handsRevealedTo };
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
  // リーチ宣言牌が他家に鳴かれて河から消えると、「リーチをどこから始めたか」の
  // 目印（横向き表示）が自分の河から失われてしまう。実際の麻雀のルール通り、
  // その場合は次に切る牌へ目印を引き継ぐ（さらにそれも鳴かれたら、また次の
  // 牌へ…と連鎖する）。「現在、鳴かれていない状態のリーチ宣言目印が自分の
  // 河に存在するか」で判定することで、この連鎖を追加の状態管理なしに表現する。
  const needsRiichiMarker = p.riichi && !p.discards.some((d) => d.isRiichiDeclaration && !d.calledAway);
  let players = updatePlayer(round.players, action.player, (pl) => ({
    ...pl,
    hand,
    discards: [...pl.discards, { tile, calledAway: false, isRiichiDeclaration: needsRiichiMarker, isTsumogiri }],
    ippatsuActive: pl.riichi ? false : pl.ippatsuActive,
  }));
  const gaugeRate = CHARACTERS[round.characterIds[action.player]]?.gaugePerTurn ?? 0;
  players = gainGauge(round, action.player, players, gaugeRate);

  // コウキの「太っ腹」等、自分の打牌に反応するパッシブ効果を適用する。
  // 他家の打牌には反応しないため打牌者自身のキャラクターに対してのみ呼ぶ。
  let afterDiscardRound = { ...round, players };
  const onAfterDiscard = CHARACTERS[round.characterIds[action.player]]?.skill.hooks.onAfterDiscard;
  if (onAfterDiscard) afterDiscardRound = onAfterDiscard({ round: afterDiscardRound, owner: action.player }, tile);
  // タカハルの盾(bettaoriShield)は、ここでは消費しない。ここで「この牌は
  // 本来ロンされていたはず」という判定だけでbettaoriShieldをfalseにして
  // しまうと、まさにこの直後に行われるcanDeclareRon（鳴き応答ウィンドウ・
  // hasAnyoneWhoCanRon）が盾を見た時には既にfalseになっており、盾が実際に
  // 誰のロンも防げないまま消費されるだけの不具合になる（実際に発生した）。
  // 盾は「その捨て牌に対する応答ウィンドウが誰のロンも無いまま終わった
  // （＝盾がまさにロンを防いだ）瞬間」に消費する必要があるため、
  // resolveCallWindowIfComplete側で行う。

  // 時を止めている間は誰もロンできないため、hasAnyoneWhoCanRonのチェック自体が無意味。
  const timeStopped = (afterDiscardRound.players[action.player]!.timeStopTurnsRemaining ?? 0) > 0;
  if (liveTilesRemaining(round.wall) === 0 && (timeStopped || !hasAnyoneWhoCanRon(afterDiscardRound, afterDiscardRound.players, action.player, tile.code))) {
    return buildExhaustiveDrawResult(afterDiscardRound);
  }

  return resolveDiscardTurnTransition(afterDiscardRound, action.player, tile);
}

function hasAnyoneWhoCanRon(round: RoundState, players: RoundState["players"], discarder: PlayerIndex, tile: TileCode): boolean {
  for (const p of otherPlayers(discarder)) {
    const probe: RoundState = { ...round, players };
    if (canDeclareRon(probe, p, tile, discarder)) return true;
  }
  return false;
}

/** タカハルの「アトミックベタ降り」の盾を、実際に守った瞬間（＝盾が無ければ
    誰かにロンされていたはずの捨て牌に対する応答ウィンドウが、誰のロンも
    無いまま終わった瞬間）に消費する。安全な牌を切っている間（誰の当たり
    牌でもない間）は盾を温存し続ける（無駄撃ちしない）。
    呼び出し側（resolveCallWindowIfComplete）は必ず「ronCalls.length===0
    が確定した後」に呼ぶこと。まだ応答が出揃っていない、またはロンが
    宣言された時点でこれを呼んでしまうと、盾がロンを防いでいる最中に
    自分で盾を消費してしまい、意味が無くなる。 */
function consumeBettaoriShieldIfItJustSaved(round: RoundState, discarder: PlayerIndex, tile: TileCode, chankan: boolean): RoundState {
  if (!round.players[discarder]!.bettaoriShield) return round;
  const wouldHaveDealtIn = otherPlayers(discarder).some((p) => analyzeRonForPlayer(round, p, tile, chankan) !== null);
  if (!wouldHaveDealtIn) return round;
  return { ...round, players: updatePlayer(round.players, discarder, (pl) => ({ ...pl, bettaoriShield: false })) };
}

/** カード「一閃の盾」を、実際に守った瞬間（＝盾が無ければ誰かにロンされて
    いたはずの捨て牌に対する応答ウィンドウが、誰のロンも無いまま終わった瞬間）
    に消費する。タカハルのbettaoriShieldと全く同じ考え方（安全な牌を切っている
    間は温存する）。呼び出し側の制約もconsumeBettaoriShieldIfItJustSavedと同じ。 */
function consumeCardGuardIfItJustSaved(round: RoundState, discarder: PlayerIndex, tile: TileCode, chankan: boolean): RoundState {
  if (round.cardIds[discarder] !== "houjuu-guard" || round.cardUsesRemaining[discarder] <= 0) return round;
  const wouldHaveDealtIn = otherPlayers(discarder).some((p) => analyzeRonForPlayer(round, p, tile, chankan) !== null);
  if (!wouldHaveDealtIn) return round;
  const cardUsesRemaining = [...round.cardUsesRemaining] as RoundState["cardUsesRemaining"];
  cardUsesRemaining[discarder] -= 1;
  return { ...round, cardUsesRemaining };
}

function applyRiichiAction(round: RoundState, action: RiichiAction): RoundState {
  if (!canRiichi(round, action.player)) throw new Error("riichi: リーチできない状況です");
  const p = round.players[action.player];
  const { tile, hand } = removeTileFromHand(p.hand, action.tileId);
  if (calcShanten(hand) !== 0) throw new Error("riichi: その牌を切るとテンパイが崩れます");

  const isFirstDiscardOfHand = p.discards.length === 0 && !round.anyCallOrRiichiMade;
  const isTsumogiri = action.tileId === round.lastDrawnTile?.id;
  let players = updatePlayer(round.players, action.player, (pl) => ({
    ...pl,
    hand,
    discards: [...pl.discards, { tile, calledAway: false, isRiichiDeclaration: true, isTsumogiri }],
    riichi: true,
    doubleRiichi: isFirstDiscardOfHand,
    ippatsuActive: true,
    // 必殺技「大明立直」（onRiichiフック、下記参照）がゲージ満タンなら
    // ここではなく後段でtrueに上書きする。ここではまず素のリーチとして
    // 初期化しておく。
    openRiichi: false,
  }));
  const gaugeRate = CHARACTERS[round.characterIds[action.player]]?.gaugePerTurn ?? 0;
  players = gainGauge(round, action.player, players, gaugeRate);

  // コウキの「太っ腹」/タカハルの「アトミックベタ降り」等、自分の打牌に
  // 反応するパッシブ効果はリーチ宣言の打牌に対しても同様に適用する。
  // タカハルの盾はここでは消費しない（applyDiscardAction側の同様のコメント
  // 参照）。resolveCallWindowIfComplete側でロン不成立が確定した時に消費する。
  let afterDiscardRound = { ...round, players };
  const character = CHARACTERS[round.characterIds[action.player]];
  const onAfterDiscard = character?.skill.hooks.onAfterDiscard;
  if (onAfterDiscard) afterDiscardRound = onAfterDiscard({ round: afterDiscardRound, owner: action.player }, tile);

  // にゃん次郎の「アトミックリーチ」等、useSkillを介さず「ゲージ満タンでの
  // リーチ宣言」そのものが自動発動のトリガーになるキャラ用。判定は
  // リーチを宣言する前の時点でゲージが満タンだったかどうかで行う
  // （この立直の打牌で得るgaugePerTurn分の増加はカウントしない）。
  const onRiichi = character?.skill.hooks.onRiichi;
  if (onRiichi && p.skillGauge >= character!.gaugeMax) {
    // カード「無効化」の対象: 敵（カード所持者以外）の自動発動も対象に含む。
    // 効果そのものは無かったことにする（普通のリーチのまま）が、ゲージは
    // 消費された(空撃ち)扱いにする。
    const negatingOwner = findNegatingCardOwner(afterDiscardRound, action.player);
    if (negatingOwner !== null) {
      afterDiscardRound = disarmNegate(
        {
          ...afterDiscardRound,
          players: updatePlayer(afterDiscardRound.players, action.player, (pl) => ({ ...pl, skillGauge: 0 })),
        },
        negatingOwner,
      );
    } else {
      afterDiscardRound = onRiichi({ round: afterDiscardRound, owner: action.player });
      afterDiscardRound = {
        ...afterDiscardRound,
        players: updatePlayer(afterDiscardRound.players, action.player, (pl) => ({ ...pl, skillGauge: 0 })),
      };
    }
  }

  // カード「ノーコストリーチ」: 持っていて未消費の間、次のリーチ宣言だけ
  // 供託(kyotaku)を積まずに済む。積まない＝gameStore.ts側の1000点減点も
  // 起きない（riichiPlayerを渡さない）ため、点数の帳尻は崩れない。
  const freeRiichi = round.cardIds[action.player] === "no-cost-riichi" && round.cardUsesRemaining[action.player] > 0;
  const resultRound = {
    ...resolveDiscardTurnTransition(afterDiscardRound, action.player, tile),
    anyCallOrRiichiMade: true,
    kyotaku: freeRiichi ? round.kyotaku : round.kyotaku + 1,
  };
  if (!freeRiichi) return resultRound;
  const cardUsesRemaining = [...resultRound.cardUsesRemaining] as RoundState["cardUsesRemaining"];
  cardUsesRemaining[action.player]! -= 1;
  return { ...resultRound, cardUsesRemaining };
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
  const ippatsuResult = clearAllIppatsu(round, players);
  players = ippatsuResult.players;

  const { tile: rinshanTile, wall: wallAfterDraw } = drawRinshan(round.wall);
  const wall = revealNextDora(wallAfterDraw);
  const resolved = resolveGuaranteedRinshan(players, action.player, players[action.player].hand, rinshanTile, wall);
  players = updatePlayer(players, action.player, (pl) => ({
    ...pl,
    hand: addTileToHand(pl.hand, resolved.tile),
    guaranteedRinshan: resolved.clearGuarantee ? false : pl.guaranteedRinshan,
  }));

  return {
    ...round,
    players,
    cardUsesRemaining: ippatsuResult.cardUsesRemaining,
    wall: resolved.wall,
    lastDrawnTile: resolved.tile,
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
  // 元のポンで鳴いた牌（横向き表示の基準）はカン後も同じ位置・向きのまま残す
  // （calledTileを追加牌に差し替えると、どの方向から鳴いたポンだったかの
  // 表示が失われ、代わりに配列末尾の追加牌が横向きになって見た目がおかしく
  // なっていた）。追加した4枚目はその元の牌のすぐ隣に挿入し、実際の卓上で
  // 「ポンの牌に1枚足す」見た目に近づける。
  const calledIdx = existingMeld.tiles.findIndex((t) => t.id === existingMeld.calledTile?.id);
  const insertAt = calledIdx === -1 ? existingMeld.tiles.length : calledIdx + 1;
  const tiles = [...existingMeld.tiles.slice(0, insertAt), tile, ...existingMeld.tiles.slice(insertAt)];
  const newMeld: Meld = { type: "kakan", tiles, calledFromRelative: existingMeld.calledFromRelative, calledTile: existingMeld.calledTile };
  const melds = [...handAfterRemove.melds];
  melds[meldIdx] = newMeld;
  const hand: Hand = { ...handAfterRemove, melds };

  const players = updatePlayer(round.players, action.player, (pl) => ({ ...pl, hand }));
  const kakanRound = { ...round, players };

  // 時を止めている間は槍槓（ロン）も含め誰も反応できないため、応答ウィンドウ
  // 自体を開かずそのまま嶺上へ進む。
  if ((players[action.player]!.timeStopTurnsRemaining ?? 0) > 0) {
    return finalizeKakanAfterChankanWindow(kakanRound, action.player);
  }

  return {
    ...kakanRound,
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

function finalizeKakanAfterChankanWindow(round: RoundState, player: PlayerIndex): RoundState {
  const ippatsuResult = clearAllIppatsu(round, round.players);
  let players = ippatsuResult.players;
  const { tile: rinshanTile, wall: wallAfterDraw } = drawRinshan(round.wall);
  const wall = revealNextDora(wallAfterDraw);
  const resolved = resolveGuaranteedRinshan(players, player, players[player].hand, rinshanTile, wall);
  players = updatePlayer(players, player, (pl) => ({
    ...pl,
    hand: addTileToHand(pl.hand, resolved.tile),
    guaranteedRinshan: resolved.clearGuarantee ? false : pl.guaranteedRinshan,
  }));
  return {
    ...round,
    players,
    cardUsesRemaining: ippatsuResult.cardUsesRemaining,
    wall: resolved.wall,
    lastDrawnTile: resolved.tile,
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
  // カード「フリテン解除」: 本来ならフリテンでロンできないはずの宣言（＝canDeclareRon
  // 側のフリテン迂回チェックで許された宣言）を、実際に成立させる瞬間だけ消費する
  // （自力でフリテンでない普通のロンでは消費しない）。
  let nextRound = round;
  if (isFuriten(round.players[player]) && round.cardIds[player] === "furiten-clear" && round.cardUsesRemaining[player] > 0) {
    const cardUsesRemaining = [...round.cardUsesRemaining] as RoundState["cardUsesRemaining"];
    cardUsesRemaining[player]! -= 1;
    nextRound = { ...round, cardUsesRemaining };
  }
  return applyCallDeclaration(nextRound, player, { type: "ron", player });
}

const YAKUHAI_DRAGON_CODES = new Set<TileCode>(["5z", "6z", "7z"]);

/** カード「鳴かれず」: discarderがこのカードを持ち未消費の間、切った役牌
    （白發中）はポン/カンされない。 */
function isYakuhaiGuarded(round: RoundState, discarder: PlayerIndex, tileCode: TileCode): boolean {
  if (!YAKUHAI_DRAGON_CODES.has(tileCode)) return false;
  return round.cardIds[discarder] === "uncallable-yakuhai" && round.cardUsesRemaining[discarder] > 0;
}

function applyCallDeclaration(round: RoundState, player: PlayerIndex, call: DeclaredCallAction): RoundState {
  const window = round.pendingCallWindow;
  if (!window || round.phase !== "awaiting-calls") throw new Error("call: 現在鳴き/ロンを宣言できる局面ではありません");
  if (!window.awaitingPlayers.includes(player)) throw new Error("call: このプレイヤーは応答対象ではありません");
  if (window.respondedBy.includes(player)) throw new Error("call: 既に応答済みです");
  // リーチ後は手牌が固定されるため、ロン以外（チー/ポン/カン）は宣言できない。
  if (call.type !== "ron" && round.players[player].riichi) {
    throw new Error("call: リーチ後はチー/ポン/カンを宣言できません");
  }

  // カード「鳴かれず」: 実際にブロックした瞬間だけ消費し、この応答自体は
  // （宣言は受け付けつつ効果を発生させない、ではなく）スキップと同じ扱いにする。
  if ((call.type === "pon" || call.type === "minkan") && isYakuhaiGuarded(round, window.discarderIndex, window.discardTile.code)) {
    const cardUsesRemaining = [...round.cardUsesRemaining] as RoundState["cardUsesRemaining"];
    cardUsesRemaining[window.discarderIndex]! -= 1;
    const nextWindow: PendingCallWindow = { ...window, respondedBy: [...window.respondedBy, player] };
    return resolveCallWindowIfComplete({ ...round, cardUsesRemaining, pendingCallWindow: nextWindow });
  }

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

  // 誰もロンを宣言できなかった（宣言しなかったのではなく、盾があれば
  // canDeclareRonが常にnullを返すため誰も「できなかった」）ことがここで
  // 確定した。タカハルの盾は「このタイミングで初めて」消費する。
  round = consumeBettaoriShieldIfItJustSaved(round, window.discarderIndex, window.discardTile.code, window.isChankan);
  round = consumeCardGuardIfItJustSaved(round, window.discarderIndex, window.discardTile.code, window.isChankan);

  if (window.isChankan) {
    return finalizeKakanAfterChankanWindow(round, window.discarderIndex);
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
  const ippatsuResult = clearAllIppatsu(round, players);
  players = ippatsuResult.players;

  const isKan = call.type === "minkan";
  if (isKan) {
    const { tile: rinshanTile, wall: wallAfterDraw } = drawRinshan(round.wall);
    const wall = revealNextDora(wallAfterDraw);
    const resolved = resolveGuaranteedRinshan(players, caller, players[caller].hand, rinshanTile, wall);
    players = updatePlayer(players, caller, (pl) => ({
      ...pl,
      hand: addTileToHand(pl.hand, resolved.tile),
      guaranteedRinshan: resolved.clearGuarantee ? false : pl.guaranteedRinshan,
    }));
    return {
      ...round,
      players,
      cardUsesRemaining: ippatsuResult.cardUsesRemaining,
      wall: resolved.wall,
      lastDrawnTile: resolved.tile,
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
    cardUsesRemaining: ippatsuResult.cardUsesRemaining,
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

/** 必殺技「捲る運命」（guaranteedUraDoraフラグ）の消費処理。立直中の
    winnerが和了した瞬間、手牌（+和了牌）の中で最も多い牌が裏ドラとして
    数えられるよう、山の最初の裏ドラ表示牌を強制的に入れ替える。対象牌が
    山に残っていなければ何もしない（不発。フラグ自体は消費する）。
    ロン和了時はwinTileForRonに放銃牌のコードを渡す（ツモは既に本人の
    手牌concealedに含まれているため不要）。 */
function applyGuaranteedUraDoraForWinner(round: RoundState, winner: PlayerIndex, winTileForRon?: TileCode): RoundState {
  const p = round.players[winner];
  if (!p.riichi || !p.guaranteedUraDora) return round;

  const handCodes = winTileForRon ? [...allHandTileCodes(p.hand), winTileForRon] : allHandTileCodes(p.hand);
  const counts = tileCodeCounts(handCodes);
  let targetCode: TileCode | undefined;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      targetCode = code;
    }
  }

  const players = updatePlayer(round.players, winner, (pl) => ({ ...pl, guaranteedUraDora: false }));
  if (!targetCode) return { ...round, players };
  const wall = forceFirstUraDoraIndicator(round.wall, prevTileForDora(targetCode));
  return { ...round, players, wall };
}

function buildWinRoundResult(round: RoundState, winners: PlayerIndex[], discarder: PlayerIndex, chankan: boolean): RoundState {
  const dealerContinues = winners.includes(round.dealerSeat);
  void chankan;
  // 放銃（槍槓含む）は本人にとって痛手なぶん、必殺技ゲージへの逆転要素として
  // 多めに加算する。
  const dealInBonus = CHARACTERS[round.characterIds[discarder]]?.gaugePerDealIn ?? 0;
  let players = gainGauge(round, discarder, round.players, dealInBonus);
  let wall = round.wall;
  const winTile = round.pendingCallWindow?.discardTile.code ?? round.lastDiscard?.tile.code;
  if (winTile) {
    for (const winner of winners) {
      const applied = applyGuaranteedUraDoraForWinner({ ...round, players, wall }, winner, winTile);
      players = applied.players;
      wall = applied.wall;
    }
  }
  return {
    ...round,
    players,
    wall,
    phase: "round-over",
    result: { type: "ron", winners, loser: discarder, dealerContinues },
  };
}

function applyTsumoAction(round: RoundState, player: PlayerIndex): RoundState {
  const analysis = canDeclareTsumo(round, player);
  if (!analysis) throw new Error("tsumo: 和了条件を満たしていません");
  const withUraDora = applyGuaranteedUraDoraForWinner(round, player);
  return {
    ...withUraDora,
    phase: "round-over",
    result: { type: "tsumo", winners: [player], dealerContinues: player === round.dealerSeat },
  };
}

function applyUseSkillAction(round: RoundState, player: PlayerIndex): RoundState {
  if (!canUseSkill(round, player)) throw new Error("useSkill: 現在必殺技を発動できません");
  const character = CHARACTERS[round.characterIds[player]]!;

  // カード「無効化」の対象: 敵（カード所持者以外）が必殺技を発動した瞬間。
  // 効果そのものは無かったことにするが、ゲージは消費された(空撃ち)扱いにする。
  const negatingOwner = findNegatingCardOwner(round, player);
  if (negatingOwner !== null) {
    const players = updatePlayer(round.players, player, (pl) => ({ ...pl, skillGauge: 0 }));
    return disarmNegate({ ...round, players }, negatingOwner);
  }

  const activated = character.skill.hooks.onActivate!({ round, owner: player });
  const players = updatePlayer(activated.players, player, (pl) => ({ ...pl, skillGauge: 0 }));
  // カガミの「写し身」がコピー元の能力を伝播させるため、onActivateがlastActivatedSkill
  // 自体を書き換えていればそれを優先する（同じ参照のままなら未変更とみなし、
  // ここで「このキャラ自身が発動した」という既定値をセットする。gameState.tsの
  // lastActivatedSkillの説明、characters.tsのkagami参照）。
  const lastActivatedSkill =
    activated.lastActivatedSkill !== round.lastActivatedSkill
      ? activated.lastActivatedSkill
      : { owner: player, characterId: character.id };
  return { ...activated, players, lastActivatedSkill };
}

/** カリンの「借り物」。borrowSkillアクションの実処理。targetのonActivateを、
    ownerを借りた側（player）に差し替えて呼び出すことで、効果自体は借りた側に
    及ぶ（カガミがコピー先のonActivateを呼ぶ際と同じ考え方。characters.ts参照）。 */
function applyBorrowSkillAction(round: RoundState, player: PlayerIndex, target: PlayerIndex): RoundState {
  if (!canBorrowSkill(round, player, target)) throw new Error("borrowSkill: 現在必殺技を借りられません");
  const targetCharacter = CHARACTERS[round.characterIds[target]]!;

  // カード「無効化」の対象: 敵（カード所持者以外）が必殺技を発動した瞬間。
  // applyUseSkillActionと同じ扱い（実際に効果を発揮するのは借りた側=playerのため、
  // 無効化判定もplayerを基準にする）。
  const negatingOwner = findNegatingCardOwner(round, player);
  if (negatingOwner !== null) {
    const players = updatePlayer(round.players, player, (pl) => ({ ...pl, skillGauge: 0 }));
    return disarmNegate({ ...round, players }, negatingOwner);
  }

  const activated = targetCharacter.skill.hooks.onActivate!({ round, owner: player });
  const players = updatePlayer(activated.players, player, (pl) => ({ ...pl, skillGauge: 0 }));
  const lastActivatedSkill =
    activated.lastActivatedSkill !== round.lastActivatedSkill
      ? activated.lastActivatedSkill
      : { owner: player, characterId: targetCharacter.id };
  return { ...activated, players, lastActivatedSkill };
}

/** ミオの「取り返し」。retrieveDiscardアクションの実処理。自分の河から1枚を
    手牌へ戻し、代わりに手牌の別の1枚をその場で切り直す（実質的な打牌交換）。
    交換後の1枚は通常の打牌と全く同じ扱いで河へ追加され、鳴き/ロンの応答
    ウィンドウも通常どおり開く（applyDiscardActionと同じ後処理を踏襲する）。 */
function applyRetrieveDiscardAction(round: RoundState, player: PlayerIndex, reclaimTileId: string, replacementTileId: string): RoundState {
  if (!canRetrieveDiscard(round, player, reclaimTileId, replacementTileId)) {
    throw new Error("retrieveDiscard: 現在この牌を取り返せません");
  }
  const character = CHARACTERS[round.characterIds[player]]!;
  const p = round.players[player]!;
  const discardIndex = p.discards.findIndex((d) => d.tile.id === reclaimTileId);
  const reclaimed = p.discards[discardIndex]!.tile;
  const discardsWithoutReclaimed = [...p.discards.slice(0, discardIndex), ...p.discards.slice(discardIndex + 1)];
  const handWithReclaimed = addTileToHand(p.hand, reclaimed);
  const { tile: replaced, hand } = removeTileFromHand(handWithReclaimed, replacementTileId);
  const isTsumogiri = replacementTileId === round.lastDrawnTile?.id;
  const players = updatePlayer(round.players, player, (pl) => ({
    ...pl,
    hand,
    discards: [...discardsWithoutReclaimed, { tile: replaced, calledAway: false, isRiichiDeclaration: false, isTsumogiri }],
    skillGauge: 0,
  }));

  // 「取り返し」自身がlastActivatedSkillに記録される必要がある（カガミの
  // canCopyLastSkillが「直近に発動した技」として正しく認識できるように）。
  // ただしミオのskill.hooksにはonActivateが無いため、カガミ側は
  // copiedHooks?.onActivateが無いと判定して結局コピー不可になる
  // （カリンのborrowsSkill同様、この技自体はカガミの写し身の対象外）。
  let afterRound: RoundState = { ...round, players, lastActivatedSkill: { owner: player, characterId: character.id } };
  const onAfterDiscard = character.skill.hooks.onAfterDiscard;
  if (onAfterDiscard) afterRound = onAfterDiscard({ round: afterRound, owner: player }, replaced);

  const timeStopped = (afterRound.players[player]!.timeStopTurnsRemaining ?? 0) > 0;
  if (liveTilesRemaining(round.wall) === 0 && (timeStopped || !hasAnyoneWhoCanRon(afterRound, afterRound.players, player, replaced.code))) {
    return buildExhaustiveDrawResult(afterRound);
  }
  return resolveDiscardTurnTransition(afterRound, player, replaced);
}

function applyUseCardAction(round: RoundState, player: PlayerIndex): RoundState {
  if (!canUseCard(round, player)) throw new Error("useCard: 現在カードを使用できません");
  const card = CARDS[round.cardIds[player]!]!;
  const activated = card.hooks.onUse!({ round, owner: player });
  const cardUsesRemaining = [...activated.cardUsesRemaining] as RoundState["cardUsesRemaining"];
  cardUsesRemaining[player] -= 1;
  return { ...activated, cardUsesRemaining };
}

function applySwapTilesAction(round: RoundState, action: SwapTilesAction): RoundState {
  if (!canSwapStartingTile(round, action.player)) throw new Error("swapTiles: 今は配牌の入れ替えができません");
  const p = round.players[action.player];
  // 1枚ずつ小出しにできると連打の余地が生まれるため、権利の残り枚数
  // ちょうどぶんをまとめて同時に選ばせ、1回のアクションで一括処理する。
  if (action.tileIds.length !== p.tileSwapsRemaining) {
    throw new Error("swapTiles: 交換は残り枚数ぶんまとめて同時に行う必要があります");
  }
  if (new Set(action.tileIds).size !== action.tileIds.length) {
    throw new Error("swapTiles: 同じ牌を重複して指定しています");
  }

  let hand = p.hand;
  const removedTiles: Tile[] = [];
  for (const tileId of action.tileIds) {
    const { tile, hand: nextHand } = removeTileFromHand(hand, tileId);
    removedTiles.push(tile);
    hand = nextHand;
  }
  // ナギの「積み込み」と同じ要領で、外した牌をまとめて山の下に戻してから
  // 同じ枚数ぶん山の先頭から引き直す（山の合計牌数は変わらない）。
  let wall: WallState = { ...round.wall, liveTiles: [...round.wall.liveTiles, ...removedTiles] };
  for (let i = 0; i < removedTiles.length; i++) {
    const { tile: redrawn, wall: nextWall } = drawFromLive(wall);
    hand = addTileToHand(hand, redrawn);
    wall = nextWall;
  }

  const players = updatePlayer(round.players, action.player, (pl) => ({ ...pl, hand, tileSwapsRemaining: 0 }));
  return { ...round, players, wall };
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
    case "useSkill":
      return applyUseSkillAction(round, action.player);
    case "borrowSkill":
      return applyBorrowSkillAction(round, action.player, action.target);
    case "retrieveDiscard":
      return applyRetrieveDiscardAction(round, action.player, action.reclaimTileId, action.replacementTileId);
    case "swapTiles":
      return applySwapTilesAction(round, action);
    case "useCard":
      return applyUseCardAction(round, action.player);
    default:
      throw new Error(`unknown action: ${JSON.stringify(action)}`);
  }
}

export interface RoundScoreOutcome {
  scoreDeltas: [number, number, number, number];
  winAnalyses: Partial<Record<PlayerIndex, { analysis: WinAnalysis; score: ScoreResult }>>;
}

/** カード「親孝行」: 自分が親として和了した時、本場ボーナスが2倍になる。
    honba自体を2倍にしてapplyHonbaへ渡すことで実現する（持っているだけの
    常時効果。消費はされない）。 */
function effectiveHonba(round: RoundState, winner: PlayerIndex): number {
  if (winner === round.dealerSeat && round.cardIds[winner] === "dealer-honba-boost") return round.honba * 2;
  return round.honba;
}

/** カード「大逆転の目」: 使用済み(cardScoreDoubled)なら、この和了の最終支払額
    （本場込み）をまるごと2倍にする（役満は対象外。ドラ等と同じ扱い）。 */
function doubleForScoreCard(round: RoundState, winner: PlayerIndex, analysis: WinAnalysis, payments: PaymentBreakdown): PaymentBreakdown {
  if (!round.cardScoreDoubled[winner] || analysis.isYakuman) return payments;
  return {
    total: payments.total * 2,
    fromDiscarder: payments.fromDiscarder !== undefined ? payments.fromDiscarder * 2 : undefined,
    fromDealer: payments.fromDealer !== undefined ? payments.fromDealer * 2 : undefined,
    fromEachNonDealer: payments.fromEachNonDealer !== undefined ? payments.fromEachNonDealer * 2 : undefined,
  };
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
    const payments = doubleForScoreCard(round, winner, analysis, applyHonba(score.payments, effectiveHonba(round, winner), true));
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
      const payments = doubleForScoreCard(round, winner, analysis, applyHonba(score.payments, effectiveHonba(round, winner), false));
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
