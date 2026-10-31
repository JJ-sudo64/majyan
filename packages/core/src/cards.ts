/**
 * カードシステム。対局開始前にキャラクターとは別に1枚だけ選んで持っていける
 * 追加要素。人間は自分で選択、CPU3人は対局開始時にランダムで1枚割り当てられる。
 * キャラクターの必殺技システム（skills/types.ts・characters.ts）と同じ
 * フック方式で実装し、実際の発動タイミングはgameEngine.ts/matchFormat.ts側で
 * 呼び出す。
 */
import type { PlayerIndex } from "./actions.js";
import type { Hand } from "./hand.js";
import { seatWindOf, type RoundState } from "./gameState.js";
import { isHonor, isTerminal, type TileCode } from "./tiles.js";
import { revealNextDora, type WallState } from "./wall.js";
import { CHARACTERS } from "./characters.js";
import { ensureAtLeastOneMeld, ensureAtLeastOneDora, ensureAtLeastOneRedTile, ensureAtLeastPairs, ensureYakuhaiPair, countPairs, ensureAtLeastDoraTiles, ensureAtLeastOneTriplet, lowerShanten, ensureAtLeastOneYakuhaiTile, ensureAtLeastOneTileNearDora, leanTowardMainSuit, swapTerminalsForSimples } from "./dealAdjust.js";

export interface CardContext {
  round: RoundState;
  /** カードの持ち主の座席。 */
  owner: PlayerIndex;
}

export interface CardMatchEndContext {
  /** 対局全体が終了し、供託精算まで終わった最終点数。 */
  scores: [number, number, number, number];
  /** カードの持ち主の座席。 */
  owner: PlayerIndex;
}

export interface CardHooks {
  /** 配牌直後（matchFormat.tsのdealNewRoundの終わり）。パッシブ専用カードの
      効果はここで発揮する（characters.tsのonDealHandと同じ形）。条件を
      満たさない場合はctx.roundをそのまま返せばよい。 */
  onDealHand?: (ctx: CardContext) => RoundState;
  /** 消費型カードをuseCardアクションで使った瞬間に呼ばれる。新しいRoundStateを
      返す。呼び出し側（gameEngine）がこの戻り値のcardUsesRemaining[owner]を
      1減らすため、ここでその値を操作する必要はない。onUseを持たない
      consumableカード（例:一閃の盾）は、useCardボタン自体が出ず、代わりに
      gameEngine.ts側の専用ロジックが条件を満たした瞬間に自動でcardUsesRemaining
      を減らす。 */
  onUse?: (ctx: CardContext) => RoundState;
  /** 対局全体が終了した瞬間（gameStore.tsがmatch.finishedを立てる瞬間）に
      呼ばれる。最終順位を見て点数を調整するカード用。新しい最終点数を
      返す（対象外なら引数のscoresをそのまま返せばよい）。 */
  onMatchEnd?: (ctx: CardMatchEndContext) => [number, number, number, number];
}

export interface Card {
  id: string;
  name: string;
  description: string;
  /** passive: 持っているだけで常時効果を発揮する（onDealHand）。
      consumable: useCardアクションで使うたびに1回ぶん消費される（onUse）。 */
  kind: "passive" | "consumable";
  /** consumableカードの対局を通した総使用可能回数。未指定なら1回
      （＝従来通りの「使うと無くなる」使い切りカード）。passiveカードでは
      無視される。matchFormat.tsのdealNewRoundが対局の最初にこの値を
      RoundState.cardUsesRemaining[owner]へセットし、以後useCardのたびに
      gameEngine.tsのapplyUseCardActionが1減らす（局をまたいで持ち越す）。 */
  maxUses?: number;
  hooks: CardHooks;
}

/** 座席が持つカードのID（1枠目・2枠目のうち、付いているもの）。 */
export function seatCardIds(round: RoundState, seat: PlayerIndex): string[] {
  const ids: string[] = [];
  const first = round.cardIds[seat];
  const second = round.cardIds2[seat];
  if (first) ids.push(first);
  if (second) ids.push(second);
  return ids;
}

/** 座席がそのカードを持っているか（どちらの枠でもよい）。残り回数は見ない。 */
export function hasCard(round: RoundState, seat: PlayerIndex, cardId: string): boolean {
  return round.cardIds[seat] === cardId || round.cardIds2[seat] === cardId;
}

/** そのカードの残り使用可能回数。持っていなければ0。 */
export function cardUsesLeft(round: RoundState, seat: PlayerIndex, cardId: string): number {
  if (round.cardIds[seat] === cardId) return round.cardUsesRemaining[seat];
  if (round.cardIds2[seat] === cardId) return round.cardUsesRemaining2[seat];
  return 0;
}

/** 持っていて、残り回数もあるか。 */
export function hasLiveCard(round: RoundState, seat: PlayerIndex, cardId: string): boolean {
  return cardUsesLeft(round, seat, cardId) > 0;
}

/** そのカードの使用回数を1減らしたRoundStateを返す（持っていなければそのまま）。 */
export function spendCardUse(round: RoundState, seat: PlayerIndex, cardId: string): RoundState {
  if (round.cardIds[seat] === cardId) {
    return { ...round, cardUsesRemaining: setAt(round.cardUsesRemaining, seat, round.cardUsesRemaining[seat] - 1) };
  }
  if (round.cardIds2[seat] === cardId) {
    return { ...round, cardUsesRemaining2: setAt(round.cardUsesRemaining2, seat, round.cardUsesRemaining2[seat] - 1) };
  }
  return round;
}

/** 対局開始時の残り回数の初期値（カードごとのmaxUses、未指定なら1、カード無しは0）。 */
export function initialCardUses(cardIds: readonly (string | null)[]): [number, number, number, number] {
  return cardIds.map((id) => (id ? CARDS[id]?.maxUses ?? 1 : 0)) as [number, number, number, number];
}

function updatePlayer(round: RoundState, index: PlayerIndex, updater: (p: RoundState["players"][number]) => RoundState["players"][number]): RoundState["players"] {
  const next = [...round.players] as RoundState["players"];
  next[index] = updater(next[index]!);
  return next;
}

function setAt<T>(tuple: [T, T, T, T], index: PlayerIndex, value: T): [T, T, T, T] {
  const next = [...tuple] as [T, T, T, T];
  next[index] = value;
  return next;
}

/** カード「対子確約」で保証するトイツの組数（コウジの必殺技は4組）。 */
const PAIR_GUARANTEE_MIN_PAIRS = 3;
/** カード「二対子確約」で保証するトイツの組数。 */
const PAIR_GUARANTEE_LITE_MIN_PAIRS = 2;
/** カード「ちょい充填」で増えるゲージの割合（ゲージ最大値に対して）。 */
const GAUGE_FILL_SMALL_RATIO = 0.4;
/** カード「ゲージ貯金」が局の開始ごとに足すゲージの量。 */
const GAUGE_SAVINGS_PER_ROUND = 3;
/** カード「初期ゲージ」「親のゲージ」で足すゲージの量。 */
const OPENING_GAUGE = 15;
const DEALER_GAUGE = 5;
/** カード「参加賞」で対局終了時に足す点数。 */
const PARTICIPATION_BONUS = 500;
/** カード「一口充填」で増えるゲージの割合（ゲージ最大値に対して）。 */
const GAUGE_FILL_TINY_RATIO = 0.2;
/** カード「勝ち逃げ」で1位に足す点数。 */
const TOP_PLACE_TRIM_BONUS = 500;
/** カード「ドラ二枚確約」で保証するドラの枚数。 */
const DORA_GUARANTEE_2_COUNT = 2;
/** カード「気合半充填」で増えるゲージの割合（ゲージ最大値に対して）。 */
const GAUGE_FILL_HALF_RATIO = 0.6;
/** カード「配牌の底上げ」「配牌の大底上げ」: 目標のシャンテン数と、入れ替える最大枚数。 */
const HAND_LIFT_TARGET = 3;
const HAND_LIFT_BIG_TARGET = 2;
const HAND_LIFT_MAX_SWAPS = 4;
/** 加護系カードが効く和了の回数、配牌の底上げ系が効く局の回数（対局を通して）。 */
const BOON_USES = 2;
const HAND_LIFT_USES = 3;
/** カード「断么確約」で入れ替える么九牌の最大枚数。 */
const TANYAO_GUARANTEE_MAX_SWAPS = 4;
/** 断么確約が効く局の回数。測定（10-20、200席）で無制限だと平均順位1.96と抜けていたため絞る。 */
const TANYAO_GUARANTEE_USES = 2;

/** 配牌を書き換える強めのカードの共通処理。残り回数が無ければ何もせず、実際に牌を入れ替えた局だけ1回消費する。 */
function limitedDealAdjust(ctx: CardContext, cardId: string, adjust: (hand: Hand, wall: WallState) => { hand: Hand; wall: WallState }): RoundState {
  const { round, owner } = ctx;
  if (!hasLiveCard(round, owner, cardId)) return round;
  const before = round.players[owner]!.hand;
  const { hand, wall } = adjust(before, round.wall);
  const beforeIds = new Set(before.concealed.map((t) => t.id));
  if (hand.concealed.every((t) => beforeIds.has(t.id))) return round;
  return spendCardUse({ ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) }, owner, cardId);
}

/** 配牌の底上げ系カードの本体（回数制限つき）。 */
function liftHand(ctx: CardContext, cardId: string, target: number): RoundState {
  return limitedDealAdjust(ctx, cardId, (hand, wall) => lowerShanten(hand, wall, target, HAND_LIFT_MAX_SWAPS));
}

/** 加護系カード（親・立直・ツモ・ロン・門前の加護）の使用回数を、終わった局の和了ぶん減らした
    cardUsesRemainingを返す。次局へ進む時（matchController.advanceToNextRound）に呼ぶ。
    和了していない・条件を満たしていない・残りが無い座席は変えない。 */
export function consumeBoonUses(round: RoundState): Pick<RoundState, "cardUsesRemaining" | "cardUsesRemaining2"> {
  let next = round;
  const result = round.result;
  if (!result || (result.type !== "tsumo" && result.type !== "ron")) return pick(next);
  const isTsumo = result.type === "tsumo";
  for (const seat of result.winners) {
    const p = round.players[seat]!;
    const boons: [string, boolean][] = [
      ["dealer-boon", seat === round.dealerSeat],
      ["riichi-boon", p.riichi],
      ["tsumo-boon", isTsumo],
      ["ron-boon", !isTsumo],
      ["menzen-boon", p.hand.melds.every((m) => m.type === "ankan")],
    ];
    for (const [id, applies] of boons) {
      if (applies && hasLiveCard(next, seat, id)) next = spendCardUse(next, seat, id);
    }
  }
  return pick(next);
}

function pick(round: RoundState): Pick<RoundState, "cardUsesRemaining" | "cardUsesRemaining2"> {
  return { cardUsesRemaining: round.cardUsesRemaining, cardUsesRemaining2: round.cardUsesRemaining2 };
}

/** 他家から1人あたりamount点を奪う、点棒吸収系カードのonUse。 */
function drainPointsEach(ctx: CardContext, amount: number): RoundState {
  const delta: [number, number, number, number] = [0, 0, 0, 0];
  for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
    if (p === ctx.owner) continue;
    delta[p] -= amount;
    delta[ctx.owner] += amount;
  }
  return { ...ctx.round, pendingScoreAdjustment: delta };
}

/** 役牌（白發中、自風、場風）の牌コード。 */
function yakuhaiCodesFor(round: RoundState, owner: PlayerIndex): TileCode[] {
  const codes = [`${seatWindOf(round.dealerSeat, owner)}z`, `${round.roundWind}z`, "5z", "6z", "7z"] as TileCode[];
  return [...new Set(codes)];
}

/** 持ち主のゲージをamountだけ増やす（最大値まで。ゲージを持たないキャラなら何もしない）。 */
function addGauge(round: RoundState, owner: PlayerIndex, amount: number): RoundState {
  const character = CHARACTERS[round.characterIds[owner]];
  if (!character || character.gaugeMax <= 0) return round;
  return {
    ...round,
    players: updatePlayer(round, owner, (pl) => ({ ...pl, skillGauge: Math.min(character.gaugeMax, pl.skillGauge + amount) })),
  };
}

/** onMatchEndで、条件に合う持ち主へ点数を足す。 */
function bonusOnMatchEnd(
  ctx: CardMatchEndContext,
  applies: (scores: CardMatchEndContext["scores"], owner: PlayerIndex) => boolean,
  bonus: number,
): [number, number, number, number] {
  if (!applies(ctx.scores, ctx.owner)) return ctx.scores;
  const next = [...ctx.scores] as [number, number, number, number];
  next[ctx.owner] += bonus;
  return next;
}

export const CARDS: Record<string, Card> = {
  "meld-guarantee": {
    id: "meld-guarantee",
    name: "面子確約",
    description: "配牌に3枚の組（同じ牌3枚か連番）が無ければ、1組つくる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const p = round.players[owner]!;
        const { hand, wall } = ensureAtLeastOneMeld(p.hand, round.wall);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "dora-guarantee": {
    id: "dora-guarantee",
    name: "ドラ確約",
    description: "配牌にドラが無ければ、1枚入れる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const p = round.players[owner]!;
        const { hand, wall } = ensureAtLeastOneDora(p.hand, round.wall);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "pair-guarantee": {
    id: "pair-guarantee",
    name: "対子確約",
    description: "配牌で、同じ牌2枚の組を3組以上にする。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const p = round.players[owner]!;
        const { hand, wall } = ensureAtLeastPairs(p.hand, round.wall, PAIR_GUARANTEE_MIN_PAIRS);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "red-guarantee": {
    id: "red-guarantee",
    name: "赤ドラ確約",
    description: "配牌に赤ドラが無ければ、1枚入れる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const p = round.players[owner]!;
        const { hand, wall } = ensureAtLeastOneRedTile(p.hand, round.wall);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "extra-dora": {
    id: "extra-dora",
    name: "新ドラ",
    description: "ドラ表示牌をもう1枚めくる（ドラが増える）。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({ ...ctx.round, wall: revealNextDora(ctx.round.wall) }),
    },
  },
  "gauge-fill": {
    id: "gauge-fill",
    name: "気合充填",
    description: "必殺技ゲージが満タンになる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const character = CHARACTERS[ctx.round.characterIds[ctx.owner]];
        if (!character || character.gaugeMax <= 0) return ctx.round;
        return {
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, skillGauge: Math.max(pl.skillGauge, character.gaugeMax) })),
        };
      },
    },
  },
  "yakuhai-guarantee": {
    id: "yakuhai-guarantee",
    name: "役牌確約",
    description: "配牌に役牌2枚の組が無ければ、1組つくる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const p = round.players[owner]!;
        const yakuhai = [`${seatWindOf(round.dealerSeat, owner)}z`, `${round.roundWind}z`, "5z", "6z", "7z"] as TileCode[];
        const { hand, wall } = ensureYakuhaiPair(p.hand, round.wall, [...new Set(yakuhai)]);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "tanyao-guarantee": {
    id: "tanyao-guarantee",
    name: "断么確約",
    description: "配牌の1・9・字牌を最大4枚、2〜8の牌に替える。2局まで。",
    kind: "passive",
    maxUses: TANYAO_GUARANTEE_USES,
    hooks: {
      onDealHand: (ctx) =>
        limitedDealAdjust(ctx, "tanyao-guarantee", (hand, wall) => swapTerminalsForSimples(hand, wall, TANYAO_GUARANTEE_MAX_SWAPS)),
    },
  },
  "point-drain-tiny": {
    id: "point-drain-tiny",
    name: "ささやかな吸収",
    description: "他の3人から300点ずつもらう。",
    kind: "consumable",
    hooks: { onUse: (ctx) => drainPointsEach(ctx, 300) },
  },
  "gauge-fill-small": {
    id: "gauge-fill-small",
    name: "ちょい充填",
    description: "必殺技ゲージが4割たまる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const character = CHARACTERS[ctx.round.characterIds[ctx.owner]];
        if (!character || character.gaugeMax <= 0) return ctx.round;
        return {
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({
            ...pl,
            skillGauge: Math.min(character.gaugeMax, pl.skillGauge + Math.ceil(character.gaugeMax * GAUGE_FILL_SMALL_RATIO)),
          })),
        };
      },
    },
  },
  "peek-once": {
    id: "peek-once",
    name: "ちら見",
    description: "次の自分のツモ牌を1枚見る。1回だけ。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const next = ctx.round.wall.liveTiles[3];
        const revealedFutureDraws: TileCode[] = next ? [next.code] : [];
        return {
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, revealedFutureDraws })),
        };
      },
    },
  },
  "pair-guarantee-lite": {
    id: "pair-guarantee-lite",
    name: "二対子確約",
    description: "配牌で、同じ牌2枚の組を2組以上にする。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = ensureAtLeastPairs(round.players[owner]!.hand, round.wall, PAIR_GUARANTEE_LITE_MIN_PAIRS);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "tanyao-step": {
    id: "tanyao-step",
    name: "断么の一歩",
    description: "配牌の1・9・字牌を1枚、2〜8の牌に替える。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = swapTerminalsForSimples(round.players[owner]!.hand, round.wall, 1);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "yakuhai-seed": {
    id: "yakuhai-seed",
    name: "役牌の種",
    description: "配牌に役牌が無ければ、1枚入れる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = ensureAtLeastOneYakuhaiTile(round.players[owner]!.hand, round.wall, yakuhaiCodesFor(round, owner));
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "last-place-small": {
    id: "last-place-small",
    name: "小さな起死回生",
    description: "最下位なら、終局時に+2000点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.every((s, i) => i === owner || s >= scores[owner]!), 2000),
    },
  },
  "catch-up-small": {
    id: "catch-up-small",
    name: "負け惜しみ",
    description: "1位以外なら、終局時に+1000点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => !scores.every((s, i) => i === owner || s <= scores[owner]!), 1000),
    },
  },
  "gauge-boost-small": {
    id: "gauge-boost-small",
    name: "ゲージ微加速",
    description: "必殺技ゲージのたまり方が1.2倍になる。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのgainGaugeが行う。
    },
  },
  "dealer-tithe": {
    id: "dealer-tithe",
    name: "親からいただき",
    description: "親から1000点もらう。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const { round, owner } = ctx;
        if (round.dealerSeat === owner) return round;
        const delta: [number, number, number, number] = [0, 0, 0, 0];
        delta[round.dealerSeat] -= 1000;
        delta[owner] += 1000;
        return { ...round, pendingScoreAdjustment: delta };
      },
    },
  },
  "second-place-small": {
    id: "second-place-small",
    name: "連対の意地",
    description: "2位なら、終局時に+1000点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.filter((s) => s > scores[owner]!).length === 1, 1000),
    },
  },
  "third-place-small": {
    id: "third-place-small",
    name: "三着の粘り",
    description: "3位なら、終局時に+1500点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.filter((s) => s > scores[owner]!).length === 2, 1500),
    },
  },
  "suit-lean": {
    id: "suit-lean",
    name: "染め寄せの一歩",
    description: "少ない色の数牌を最大2枚、多い色の牌に替える。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = leanTowardMainSuit(round.players[owner]!.hand, round.wall, 2);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "seat-wind-pair": {
    id: "seat-wind-pair",
    name: "自風の約束",
    description: "配牌に自風牌2枚の組が無ければ、1組つくる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = ensureYakuhaiPair(round.players[owner]!.hand, round.wall, [`${seatWindOf(round.dealerSeat, owner)}z` as TileCode]);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "dragon-pair": {
    id: "dragon-pair",
    name: "三元の約束",
    description: "配牌に三元牌（白・發・中）2枚の組が無ければ、1組つくる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = ensureYakuhaiPair(round.players[owner]!.hand, round.wall, ["5z", "6z", "7z"]);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "honor-sweep": {
    id: "honor-sweep",
    name: "字牌掃除",
    description: "配牌の字牌を最大2枚、2〜8の牌に替える。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = swapTerminalsForSimples(round.players[owner]!.hand, round.wall, 2, isHonor);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "gauge-savings": {
    id: "gauge-savings",
    name: "ゲージ貯金",
    description: "毎局の配牌時に、必殺技ゲージが3たまる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const character = CHARACTERS[round.characterIds[owner]];
        if (!character || character.gaugeMax <= 0) return round;
        return {
          ...round,
          players: updatePlayer(round, owner, (pl) => ({ ...pl, skillGauge: Math.min(character.gaugeMax, pl.skillGauge + GAUGE_SAVINGS_PER_ROUND) })),
        };
      },
    },
  },
  "participation-prize": {
    id: "participation-prize",
    name: "参加賞",
    description: "順位に関係なく、終局時に+500点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, () => true, PARTICIPATION_BONUS),
    },
  },
  "opening-gauge": {
    id: "opening-gauge",
    name: "初期ゲージ",
    description: "最初の局（東1局）の配牌時に、必殺技ゲージが15たまる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        if (round.roundWind !== 1 || round.roundNumber !== 1 || round.honba !== 0) return round;
        return addGauge(round, owner, OPENING_GAUGE);
      },
    },
  },
  "dealer-gauge": {
    id: "dealer-gauge",
    name: "親のゲージ",
    description: "親の局の配牌時に、必殺技ゲージが5たまる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => (ctx.round.dealerSeat === ctx.owner ? addGauge(ctx.round, ctx.owner, DEALER_GAUGE) : ctx.round),
    },
  },
  "dora-neighbor": {
    id: "dora-neighbor",
    name: "ドラ隣の贈り物",
    description: "配牌にドラかその隣の数牌が無ければ、1枚入れる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = ensureAtLeastOneTileNearDora(round.players[owner]!.hand, round.wall);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "last-stand-small": {
    id: "last-stand-small",
    name: "終盤の粘り",
    description: "最終局だけ、必殺技ゲージのたまり方が1.5倍になる。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのgainGauge（isFinalHand）が行う。
    },
  },
  "gauge-fill-tiny": {
    id: "gauge-fill-tiny",
    name: "一口充填",
    description: "必殺技ゲージが2割たまる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const character = CHARACTERS[ctx.round.characterIds[ctx.owner]];
        if (!character || character.gaugeMax <= 0) return ctx.round;
        return addGauge(ctx.round, ctx.owner, Math.ceil(character.gaugeMax * GAUGE_FILL_TINY_RATIO));
      },
    },
  },
  "top-place-trim": {
    id: "top-place-trim",
    name: "勝ち逃げ",
    description: "1位なら、終局時に+500点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.every((s, i) => i === owner || s <= scores[owner]!), TOP_PLACE_TRIM_BONUS),
    },
  },
  "round-up-bonus": {
    id: "round-up-bonus",
    name: "切り上げの恩恵",
    description: "終局時、最終点数を次の1000点まで切り上げる。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => {
        const { scores, owner } = ctx;
        const rounded = Math.ceil(scores[owner]! / 1000) * 1000 + 0; // +0で-0を0にする
        if (rounded === scores[owner]) return scores;
        const next = [...scores] as [number, number, number, number];
        next[owner] = rounded;
        return next;
      },
    },
  },
  "terminal-sweep": {
    id: "terminal-sweep",
    name: "端牌整理",
    description: "配牌の数牌の1・9を最大2枚、2〜8の牌に替える。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = swapTerminalsForSimples(round.players[owner]!.hand, round.wall, 2, isTerminal);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "pair-step": {
    id: "pair-step",
    name: "対子の一歩",
    description: "配牌で、同じ牌2枚の組を1組増やす。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const p = round.players[owner]!;
        const target = Math.min(countPairs(p.hand.concealed) + 1, 6);
        const { hand, wall } = ensureAtLeastPairs(p.hand, round.wall, target);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "round-wind-pair": {
    id: "round-wind-pair",
    name: "場風の約束",
    description: "配牌に場風牌2枚の組が無ければ、1組つくる。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = ensureYakuhaiPair(round.players[owner]!.hand, round.wall, [`${round.roundWind}z` as TileCode]);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "close-race": {
    id: "close-race",
    name: "僅差の追い風",
    description: "終局時、上の順位と1000点差以内なら+500点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) =>
        bonusOnMatchEnd(
          ctx,
          (scores, owner) => {
            const above = scores.filter((s) => s > scores[owner]!);
            return above.length > 0 && Math.min(...above) - scores[owner]! <= 1000;
          },
          500,
        ),
    },
  },
  "soften-defeat": {
    id: "soften-defeat",
    name: "傷口を浅く",
    description: "終局時、10000点未満なら+1000点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores[owner]! < 10000, 1000),
    },
  },
  "big-win-afterglow": {
    id: "big-win-afterglow",
    name: "大勝の余韻",
    description: "終局時、40000点以上なら+500点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores[owner]! >= 40000, 500),
    },
  },
  "origin-blessing": {
    id: "origin-blessing",
    name: "原点の加護",
    description: "終局時、24000〜26000点なら+300点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores[owner]! >= 24000 && scores[owner]! <= 26000, 300),
    },
  },
  "dealer-collection": {
    id: "dealer-collection",
    name: "親の集金",
    description: "自分が親の時、他の3人から400点ずつもらう。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => (ctx.round.dealerSeat === ctx.owner ? drainPointsEach(ctx, 400) : ctx.round),
    },
  },
  "insight-3": {
    id: "insight-3",
    name: "偵察・三度",
    description: "次のツモまでの1巡、他の3人の手牌が見える。3回まで。",
    kind: "consumable",
    maxUses: 3,
    hooks: {
      onUse: (ctx) => ({ ...ctx.round, handsRevealedTo: ctx.owner }),
    },
  },
  "future-sight-double": {
    id: "future-sight-double",
    name: "未来視・二連",
    description: "次の自分のツモ牌を2枚見る。2回まで。",
    kind: "consumable",
    maxUses: 2,
    hooks: {
      onUse: (ctx) => {
        const live = ctx.round.wall.liveTiles;
        const revealedFutureDraws: TileCode[] = [live[3], live[7]].filter((t): t is NonNullable<typeof t> => !!t).map((t) => t.code);
        return {
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, revealedFutureDraws })),
        };
      },
    },
  },
  "nullify-double": {
    id: "nullify-double",
    name: "二重無効化",
    description: "次に相手が使う必殺技を無効にする。2回まで。",
    kind: "consumable",
    maxUses: 2,
    hooks: {
      onUse: (ctx) => ({
        ...ctx.round,
        cardNegateArmed: setAt(ctx.round.cardNegateArmed, ctx.owner, true),
      }),
    },
  },
  "dealer-big-collection": {
    id: "dealer-big-collection",
    name: "親の大集金",
    description: "自分が親の時、他の3人から800点ずつもらう。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => (ctx.round.dealerSeat === ctx.owner ? drainPointsEach(ctx, 800) : ctx.round),
    },
  },
  "dora-guarantee-2": {
    id: "dora-guarantee-2",
    name: "ドラ二枚確約",
    description: "配牌のドラ（赤ドラ含む）を2枚以上にする。3局まで。",
    kind: "passive",
    maxUses: HAND_LIFT_USES,
    hooks: {
      onDealHand: (ctx) => limitedDealAdjust(ctx, "dora-guarantee-2", (hand, wall) => ensureAtLeastDoraTiles(hand, wall, DORA_GUARANTEE_2_COUNT)),
    },
  },
  "dealer-boon": {
    id: "dealer-boon",
    name: "親の加護",
    description: "親で和了すると+1翻。2回まで。",
    kind: "passive",
    maxUses: BOON_USES,
    hooks: {
      // 実際の加算はgameEngine.tsのpassiveBonusHanが行う。
    },
  },
  "riichi-boon": {
    id: "riichi-boon",
    name: "立直の加護",
    description: "リーチして和了すると+1翻。2回まで。",
    kind: "passive",
    maxUses: BOON_USES,
    hooks: {
      // 実際の加算はgameEngine.tsのpassiveBonusHanが行う。
    },
  },
  "tsumo-boon": {
    id: "tsumo-boon",
    name: "ツモの加護",
    description: "ツモ和了すると+1翻。2回まで。",
    kind: "passive",
    maxUses: BOON_USES,
    hooks: {
      // 実際の加算はgameEngine.tsのpassiveBonusHanが行う。
    },
  },
  "triplet-seed": {
    id: "triplet-seed",
    name: "暗刻の種",
    description: "配牌で、同じ牌2枚の組の1つを3枚にする。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = ensureAtLeastOneTriplet(round.players[owner]!.hand, round.wall);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "gauge-fill-half": {
    id: "gauge-fill-half",
    name: "気合半充填",
    description: "必殺技ゲージが6割たまる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const character = CHARACTERS[ctx.round.characterIds[ctx.owner]];
        if (!character || character.gaugeMax <= 0) return ctx.round;
        return addGauge(ctx.round, ctx.owner, Math.ceil(character.gaugeMax * GAUGE_FILL_HALF_RATIO));
      },
    },
  },
  "ron-boon": {
    id: "ron-boon",
    name: "ロンの加護",
    description: "ロン和了すると+1翻。2回まで。",
    kind: "passive",
    maxUses: BOON_USES,
    hooks: {
      // 実際の加算はgameEngine.tsのpassiveBonusHanが行う。
    },
  },
  "menzen-boon": {
    id: "menzen-boon",
    name: "門前の加護",
    description: "鳴かずに和了すると+1翻。2回まで。",
    kind: "passive",
    maxUses: BOON_USES,
    hooks: {
      // 実際の加算はgameEngine.tsのpassiveBonusHanが行う。
    },
  },
  "dealer-extort": {
    id: "dealer-extort",
    name: "親への強請",
    description: "親から2000点もらう。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const { round, owner } = ctx;
        if (round.dealerSeat === owner) return round;
        const delta: [number, number, number, number] = [0, 0, 0, 0];
        delta[round.dealerSeat] -= 2000;
        delta[owner] += 2000;
        return { ...round, pendingScoreAdjustment: delta };
      },
    },
  },
  "second-place-pride": {
    id: "second-place-pride",
    name: "連対の矜持",
    description: "2位なら、終局時に+2000点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.filter((s) => s > scores[owner]!).length === 1, 2000),
    },
  },
  "third-place-grit": {
    id: "third-place-grit",
    name: "三位の底力",
    description: "3位なら、終局時に+3000点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.filter((s) => s > scores[owner]!).length === 2, 3000),
    },
  },
  "hand-lift": {
    id: "hand-lift",
    name: "配牌の底上げ",
    description: "配牌が悪い時、最大4枚入れ替えて手を良くする。3局まで。",
    kind: "passive",
    maxUses: HAND_LIFT_USES,
    hooks: {
      onDealHand: (ctx) => liftHand(ctx, "hand-lift", HAND_LIFT_TARGET),
    },
  },
  "hand-lift-big": {
    id: "hand-lift-big",
    name: "配牌の大底上げ",
    description: "配牌が悪い時、最大4枚入れ替えて、より手を良くする。3局まで。",
    kind: "passive",
    maxUses: HAND_LIFT_USES,
    hooks: {
      onDealHand: (ctx) => liftHand(ctx, "hand-lift-big", HAND_LIFT_BIG_TARGET),
    },
  },
  nullify: {
    id: "nullify",
    name: "無効化",
    description: "次に相手が使う必殺技を、1度だけ無効にする。",
    kind: "consumable",
    hooks: {
      // 実際の無効化はgameEngine.tsのapplyUseSkillAction/applyRiichiActionが
      // 「敵（このカードのowner以外）がonActivate/onRiichiで必殺技を発動した瞬間」
      // に行う。ここでは構えるフラグを立てるだけ。
      onUse: (ctx) => ({
        ...ctx.round,
        cardNegateArmed: setAt(ctx.round.cardNegateArmed, ctx.owner, true),
      }),
    },
  },
  "future-sight": {
    id: "future-sight",
    name: "未来視",
    description: "次の自分のツモ牌を1枚見る。3回まで。",
    kind: "consumable",
    maxUses: 3,
    hooks: {
      // ミライの必殺技「未来視」(characters.ts)の1回ぶん(3+0*4番目)だけを見る版。
      onUse: (ctx) => {
        const next = ctx.round.wall.liveTiles[3];
        const revealedFutureDraws: TileCode[] = next ? [next.code] : [];
        return {
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, revealedFutureDraws })),
        };
      },
    },
  },
  "han-up-1": {
    id: "han-up-1",
    name: "小手先の一翻",
    description: "この局、次の和了で+1翻。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({
        ...ctx.round,
        cardBonusHan: setAt(ctx.round.cardBonusHan, ctx.owner, 1),
      }),
    },
  },
  "han-up-2": {
    id: "han-up-2",
    name: "会心の二翻",
    description: "この局、次の和了で+2翻。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({
        ...ctx.round,
        cardBonusHan: setAt(ctx.round.cardBonusHan, ctx.owner, 2),
      }),
    },
  },
  "han-up-3": {
    id: "han-up-3",
    name: "渾身の三翻",
    description: "この局、次の和了で+3翻。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({
        ...ctx.round,
        cardBonusHan: setAt(ctx.round.cardBonusHan, ctx.owner, 3),
      }),
    },
  },
  "point-drain-small": {
    id: "point-drain-small",
    name: "小銭拾い",
    description: "他の3人から500点ずつもらう。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const { round, owner } = ctx;
        const delta: [number, number, number, number] = [0, 0, 0, 0];
        for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
          if (p === owner) continue;
          delta[p] -= 500;
          delta[owner] += 500;
        }
        return { ...round, pendingScoreAdjustment: delta };
      },
    },
  },
  "point-drain": {
    id: "point-drain",
    name: "点棒吸収",
    description: "他の3人から1000点ずつもらう。",
    kind: "consumable",
    hooks: {
      // RoundStateは点数(scores)を持たないため、この一時的な差分を
      // gameStore.tsのapplyRoundUpdateが検知してmatch.scoresへ反映する。
      onUse: (ctx) => {
        const { round, owner } = ctx;
        const delta: [number, number, number, number] = [0, 0, 0, 0];
        for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
          if (p === owner) continue;
          delta[p] -= 1000;
          delta[owner] += 1000;
        }
        return { ...round, pendingScoreAdjustment: delta };
      },
    },
  },
  "houjuu-guard": {
    id: "houjuu-guard",
    name: "一閃の盾",
    description: "当たり牌を切っても、1度だけロンされない。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の無効化・消費は
      // gameEngine.tsのcanDeclareRon/consumeCardGuardIfItJustSavedが
      // 「持っているだけで常に有効、守った瞬間だけ自動消費」という形で行う。
    },
  },
  "last-place-bonus": {
    id: "last-place-bonus",
    name: "起死回生",
    description: "最下位なら、終局時に+5000点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => {
        const { scores, owner } = ctx;
        const isLastPlace = scores.every((s, i) => i === owner || s >= scores[owner]!);
        if (!isLastPlace) return scores;
        const next = [...scores] as [number, number, number, number];
        next[owner] += 5000;
        return next;
      },
    },
  },
  "catch-up": {
    id: "catch-up",
    name: "追い上げ",
    description: "1位以外なら、終局時に+3000点。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => {
        const { scores, owner } = ctx;
        const isTop = scores.every((s, i) => i === owner || s <= scores[owner]!);
        if (isTop) return scores;
        const next = [...scores] as [number, number, number, number];
        next[owner] += 3000;
        return next;
      },
    },
  },
  "gauge-boost": {
    id: "gauge-boost",
    name: "ゲージ加速",
    description: "必殺技ゲージのたまり方が1.5倍になる。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのgainGaugeが行う。
    },
  },
  "tenpai-insurance": {
    id: "tenpai-insurance",
    name: "聴牌保険",
    description: "流局の時、1度だけテンパイ扱いになる。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定・消費は
      // gameEngine.tsのbuildExhaustiveDrawResultが「荒牌流局が確定した瞬間」
      // に行う。
    },
  },
  "double-ura-dora": {
    id: "double-ura-dora",
    name: "裏ドラ倍加",
    description: "この局、リーチして和了した時、裏ドラが1枚増える。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({
        ...ctx.round,
        cardExtraUraDora: setAt(ctx.round.cardExtraUraDora, ctx.owner, true),
      }),
    },
  },
  "bust-guard": {
    id: "bust-guard",
    name: "箱割れ防止",
    description: "持ち点が0点を下回る時、1度だけ0点で止まる。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定・消費は
      // gameStore.tsのapplyCardBustGuards（局が終わって点数が確定した瞬間）
      // が行う（RoundStateは点数(scores)自体を持たないため）。
    },
  },
  insight: {
    id: "insight",
    name: "偵察",
    description: "次のツモまでの1巡、他の3人の手牌が見える。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({ ...ctx.round, handsRevealedTo: ctx.owner }),
    },
  },
  "tile-count-insight": {
    id: "tile-count-insight",
    name: "牌読み",
    description: "この局、待ち牌の残り枚数が正確に分かる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({ ...ctx.round, wallReadRevealedTo: ctx.owner }),
    },
  },
  "furiten-clear": {
    id: "furiten-clear",
    name: "フリテン解除",
    description: "見逃しフリテンでも、1度だけロンできる。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定はgameEngine.tsの
      // analyzeRonForPlayer、消費はapplyRonDeclarationが行う。
    },
  },
  "uncallable-yakuhai": {
    id: "uncallable-yakuhai",
    name: "鳴かれず",
    description: "自分が切った役牌（白・發・中）を、1度だけ鳴かれない。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定・消費は
      // gameEngine.tsのapplyCallDeclaration（isYakuhaiGuarded）が行う。
    },
  },
  "ippatsu-extend": {
    id: "ippatsu-extend",
    name: "一発延長",
    description: "一発中に誰かが鳴いても、1度だけ一発が続く。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定・消費は
      // gameEngine.tsのclearAllIppatsuが行う。
    },
  },
  "no-cost-riichi": {
    id: "no-cost-riichi",
    name: "ノーコストリーチ",
    description: "次のリーチだけ、1000点を払わずにできる。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定・消費は
      // gameEngine.tsのapplyRiichiActionが行う。
    },
  },
  "score-double": {
    id: "score-double",
    name: "大逆転の目",
    description: "この局、次の和了の得点が2倍になる（役満は除く）。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({
        ...ctx.round,
        cardScoreDoubled: setAt(ctx.round.cardScoreDoubled, ctx.owner, true),
      }),
    },
  },
  "last-stand": {
    id: "last-stand",
    name: "最後の粘り",
    description: "最終局だけ、必殺技ゲージのたまり方が2倍になる。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのgainGauge（isFinalHand）が行う。
    },
  },
  "kyotaku-collector": {
    id: "kyotaku-collector",
    name: "供託回収",
    description: "終局時、場に残ったリーチ棒を全部もらう。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameStore.tsのresolveKyotakuWithCardが行う
      // （settleLeftoverKyotakuの代わりに呼ぶ）。
    },
  },
  "dealer-honba-boost": {
    id: "dealer-honba-boost",
    name: "親孝行",
    description: "親で和了した時、本場の点が2倍になる。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのeffectiveHonbaが行う。
    },
  },
};

export const CARD_IDS: string[] = Object.keys(CARDS);

/** 対局終了時、カードを持つ全座席の onMatchEnd フックを順に適用した最終点数を返す。
    gameStore.tsがmatch.finishedを立てる箇所（供託精算の直後）で呼ぶ。 */
export function applyCardMatchEndBonuses(
  round: RoundState,
  scores: [number, number, number, number],
): [number, number, number, number] {
  let next = scores;
  for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
    for (const cardId of seatCardIds(round, seat)) {
      const onMatchEnd = CARDS[cardId]?.hooks.onMatchEnd;
      if (onMatchEnd) next = onMatchEnd({ scores: next, owner: seat });
    }
  }
  return next;
}

/** カード「供託回収」の判定。対局終了時、まだ場に残っている供託の行き先を
    決める。誰かがこのカードを持っていればその座席へ、居なければ従来通り
    fallback（matchFormat.tsのsettleLeftoverKyotaku）の結果を使う。
    matchFormat.tsが既にcards.tsをimportしているため、循環importを避けて
    fallbackを引数として受け取る形にしている。 */
export function resolveKyotakuWithCard(
  round: RoundState,
  scores: [number, number, number, number],
  kyotaku: number,
  fallback: (scores: [number, number, number, number], kyotaku: number) => [number, number, number, number],
): [number, number, number, number] {
  if (kyotaku <= 0) return scores;
  const collector = ([0, 1, 2, 3] as PlayerIndex[]).find((seat) => hasCard(round, seat, "kyotaku-collector"));
  if (collector === undefined) return fallback(scores, kyotaku);
  const next = [...scores] as [number, number, number, number];
  next[collector] += kyotaku * 1000;
  return next;
}

/** カード「箱割れ防止」の判定・消費。局が終わって点数(scores)が確定した瞬間
    （gameStore.tsが対局終了/箱割れを判定する直前）に呼ぶ。持ち点が0点未満に
    落ちている座席それぞれについて、そのカードを持ち未消費なら0点まで
    引き上げ、その枠の残り回数を1減らす。RoundState.cardIds/cardUsesRemaining(2)
    は次局へ持ち越されるフィールドのため、更新後のRoundStateも一緒に返す
    （呼び出し側はこれをmatch.roundへ書き戻す必要がある）。 */
export function applyCardBustGuards(
  round: RoundState,
  scores: [number, number, number, number],
): { round: RoundState; scores: [number, number, number, number] } {
  const nextScores = [...scores] as [number, number, number, number];
  let nextRound = round;
  for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
    if (nextScores[seat]! >= 0) continue;
    if (!hasLiveCard(nextRound, seat, "bust-guard")) continue;
    nextScores[seat] = 0;
    nextRound = spendCardUse(nextRound, seat, "bust-guard");
  }
  if (nextRound === round) return { round, scores };
  return { round: nextRound, scores: nextScores };
}

/** CPU座席用に、全カードの中からランダムに1枚選ぶ（必ず何か持つ。「なし」は無い）。 */
export function randomCardId(rng: () => number = Math.random): string {
  return CARD_IDS[Math.floor(rng() * CARD_IDS.length)]!;
}

/** CPU座席用に、指定した種類（パッシブ/消費型）のカードからランダムに1枚選ぶ。 */
export function randomCardIdOfKind(kind: Card["kind"], rng: () => number = Math.random): string {
  const ids = CARD_IDS.filter((id) => CARDS[id]!.kind === kind);
  return ids[Math.floor(rng() * ids.length)]!;
}
