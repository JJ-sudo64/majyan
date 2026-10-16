/**
 * カードシステム。対局開始前にキャラクターとは別に1枚だけ選んで持っていける
 * 追加要素。人間は自分で選択、CPU3人は対局開始時にランダムで1枚割り当てられる。
 * キャラクターの必殺技システム（skills/types.ts・characters.ts）と同じ
 * フック方式で実装し、実際の発動タイミングはgameEngine.ts/matchFormat.ts側で
 * 呼び出す。
 */
import type { PlayerIndex } from "./actions.js";
import { seatWindOf, type RoundState } from "./gameState.js";
import { isHonor, isTerminal, type TileCode } from "./tiles.js";
import { revealNextDora } from "./wall.js";
import { CHARACTERS } from "./characters.js";
import { ensureAtLeastOneMeld, ensureAtLeastOneDora, ensureAtLeastOneRedTile, ensureAtLeastPairs, ensureYakuhaiPair, countPairs, ensureAtLeastDoraTiles, ensureAtLeastOneTriplet, ensureAtLeastOneYakuhaiTile, ensureAtLeastOneTileNearDora, leanTowardMainSuit, swapTerminalsForSimples } from "./dealAdjust.js";

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
/** カード「断么確約」で入れ替える么九牌の最大枚数。 */
const TANYAO_GUARANTEE_MAX_SWAPS = 4;

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
    description: "持っているだけの常時効果。配牌時、手牌に完成した面子（同じ牌3枚の刻子、または連続する3つの数牌の順子）が1つも無ければ、山から調達できる面子を1つ見つけて手牌の適当な3枚と入れ替え、必ず1つ以上揃える（山にも該当する3枚が無ければ不発）。",
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
    description: "持っているだけの常時効果。配牌時、手牌にドラ（表ドラ、および赤ドラの5m/5p/5s）が1枚も無ければ、山から該当する1枚を見つけて手牌の適当な1枚と入れ替え、必ず1枚以上入った状態にする（山にも見つからなければ不発）。",
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
    description: "持っているだけの常時効果。配牌時、手牌のトイツ（同じ牌2枚の組）が3組に満たなければ、山から同じ牌を調達して入れ替え、必ず3組以上にする（山に該当する牌が無ければ不発）。",
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
    description: "持っているだけの常時効果。配牌時、手牌に赤ドラ（赤5）が1枚も無ければ、山から赤ドラを1枚見つけて手牌の適当な1枚と入れ替え、必ず1枚以上入った状態にする（山にも見つからなければ不発）。",
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
    description: "使用すると、ドラ表示牌がもう1枚めくられ、新しいドラが1種類増える（全員に見え、全員に効く）。ドラ表示牌が既に5枚（上限）なら何も起きない。使用すると無くなる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({ ...ctx.round, wall: revealNextDora(ctx.round.wall) }),
    },
  },
  "gauge-fill": {
    id: "gauge-fill",
    name: "気合充填",
    description: "使用すると、自分の必殺技ゲージが一気に満タンになる。ゲージを持たないキャラでは何も起きない。使用すると無くなる。",
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
    description: "持っているだけの常時効果。配牌時、手牌に役牌（白發中、自風、場風）のトイツが無ければ、山から役牌を調達して必ず1組以上のトイツにする（山に材料が無ければ不発）。",
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
    description: "持っているだけの常時効果。配牌時、手牌の么九牌（1・9・字牌）を最大4枚まで山の中張牌（2〜8）と入れ替え、断么九を狙いやすい手にする。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const p = round.players[owner]!;
        const { hand, wall } = swapTerminalsForSimples(p.hand, round.wall, TANYAO_GUARANTEE_MAX_SWAPS);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "point-drain-tiny": {
    id: "point-drain-tiny",
    name: "ささやかな吸収",
    description: "使用すると、他の3人から300点ずつ（合計900点）を即座に奪い取る。和了や流局を待たない即時効果。使用すると無くなる。",
    kind: "consumable",
    hooks: { onUse: (ctx) => drainPointsEach(ctx, 300) },
  },
  "gauge-fill-small": {
    id: "gauge-fill-small",
    name: "ちょい充填",
    description: "使用すると、自分の必殺技ゲージが最大値の4割ぶん増える（最大値を超えない）。ゲージを持たないキャラでは何も起きない。使用すると無くなる。",
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
    description: "使用すると、通常のローテーション（誰も鳴かない前提）で次に自分が自摸ってくるはずの牌1枚だけを、あらかじめ見ることができる。対局を通して1回だけ使える。誰かが鳴いて手番の巡りがズレると、予知は外れる。",
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
    description: "持っているだけの常時効果。配牌時、手牌のトイツ（同じ牌2枚の組）が2組に満たなければ、山から同じ牌を調達して入れ替え、必ず2組以上にする（山に該当する牌が無ければ不発）。",
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
    description: "持っているだけの常時効果。配牌時、手牌の么九牌（1・9・字牌）を1枚だけ山の中張牌（2〜8）と入れ替える（么九牌が無ければ何も起きない）。",
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
    description: "持っているだけの常時効果。配牌時、手牌に役牌（白發中、自風、場風）が1枚も無ければ、山から役牌を1枚持ってきて手牌の適当な1枚と入れ替える（山に無ければ不発）。",
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
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分が最下位（4位。同点最下位も含む）だった場合に限り、最終点数に2000点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.every((s, i) => i === owner || s >= scores[owner]!), 2000),
    },
  },
  "catch-up-small": {
    id: "catch-up-small",
    name: "負け惜しみ",
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分が1位でなければ、最終点数に1000点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => !scores.every((s, i) => i === owner || s <= scores[owner]!), 1000),
    },
  },
  "gauge-boost-small": {
    id: "gauge-boost-small",
    name: "ゲージ微加速",
    description: "持っているだけの常時効果。自分の必殺技ゲージの増加量が常に1.2倍（端数は切り上げ）になる。使っても無くならない（何度でも発動する）。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのgainGaugeが行う。
    },
  },
  "dealer-tithe": {
    id: "dealer-tithe",
    name: "親からいただき",
    description: "使用すると、親から1000点を即座に奪い取る（自分が親の時は何も起きない）。和了や流局を待たない即時効果。使用すると無くなる。",
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
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分がちょうど2位（同点の場合は上の順位）だった場合に限り、最終点数に1000点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.filter((s) => s > scores[owner]!).length === 1, 1000),
    },
  },
  "third-place-small": {
    id: "third-place-small",
    name: "三着の粘り",
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分がちょうど3位（同点の場合は上の順位）だった場合に限り、最終点数に1500点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.filter((s) => s > scores[owner]!).length === 2, 1500),
    },
  },
  "suit-lean": {
    id: "suit-lean",
    name: "染め寄せの一歩",
    description: "持っているだけの常時効果。配牌時、手牌で一番多い色（数牌）以外の数牌を最大2枚まで、山にある同じ色の牌と入れ替える。",
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
    description: "持っているだけの常時効果。配牌時、手牌に自風牌のトイツが無ければ、山から自風牌を調達して作る（山に材料が無ければ不発）。",
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
    description: "持っているだけの常時効果。配牌時、手牌に三元牌（白發中）のトイツが無ければ、山から三元牌を調達して作る（山に材料が無ければ不発）。",
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
    description: "持っているだけの常時効果。配牌時、手牌の字牌を最大2枚まで山の中張牌（2〜8）と入れ替える。",
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
    description: "持っているだけの常時効果。毎局の配牌時に、自分の必殺技ゲージが少しだけ（3）増える。ゲージを持たないキャラでは何も起きない。",
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
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、順位に関係なく最終点数に500点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, () => true, PARTICIPATION_BONUS),
    },
  },
  "opening-gauge": {
    id: "opening-gauge",
    name: "初期ゲージ",
    description: "持っているだけの常時効果。対局の最初の局（東1局・0本場）の配牌時に、自分の必殺技ゲージが少しだけ（15）増える。ゲージを持たないキャラでは何も起きない。",
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
    description: "持っているだけの常時効果。自分が親の局の配牌時に、必殺技ゲージが少しだけ（5）増える。ゲージを持たないキャラでは何も起きない。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => (ctx.round.dealerSeat === ctx.owner ? addGauge(ctx.round, ctx.owner, DEALER_GAUGE) : ctx.round),
    },
  },
  "dora-neighbor": {
    id: "dora-neighbor",
    name: "ドラ隣の贈り物",
    description: "持っているだけの常時効果。配牌時、手牌にドラか、その隣の数牌（ドラの1つ上・1つ下の同じ色）が1枚も無ければ、山からそのような牌を1枚持ってきて手牌の適当な1枚と入れ替える（山に無ければ不発）。",
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
    description: "持っているだけの常時効果。オーラス（この対局形式の最終局）に限り、自分の必殺技ゲージの増加量が1.5倍（端数は切り上げ）になる。使っても無くならない（何度でも発動する）。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのgainGauge（isFinalHand）が行う。
    },
  },
  "gauge-fill-tiny": {
    id: "gauge-fill-tiny",
    name: "一口充填",
    description: "使用すると、自分の必殺技ゲージが最大値の2割ぶん増える（最大値を超えない）。ゲージを持たないキャラでは何も起きない。使用すると無くなる。",
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
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分が1位（同点1位も含む）だった場合に限り、最終点数に500点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores.every((s, i) => i === owner || s <= scores[owner]!), TOP_PLACE_TRIM_BONUS),
    },
  },
  "round-up-bonus": {
    id: "round-up-bonus",
    name: "切り上げの恩恵",
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分の最終点数が次の1000点単位まで切り上げられる（ちょうど1000点単位ならそのまま）。",
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
    description: "持っているだけの常時効果。配牌時、手牌の数牌の端（1・9）を最大2枚まで山の中張牌（2〜8）と入れ替える（字牌は対象外）。",
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
    description: "持っているだけの常時効果。配牌時、手牌のトイツ（同じ牌2枚の組）を、山から同じ牌を調達してもう1組だけ増やす（山に該当する牌が無ければ不発）。",
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
    description: "持っているだけの常時効果。配牌時、手牌に場風牌のトイツが無ければ、山から場風牌を調達して作る（山に材料が無ければ不発）。",
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
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分より上の順位の誰かとの点差が1000点以内だった場合に限り、最終点数に500点が加算される。",
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
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分の最終点数が10000点未満だった場合に限り、最終点数に1000点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores[owner]! < 10000, 1000),
    },
  },
  "big-win-afterglow": {
    id: "big-win-afterglow",
    name: "大勝の余韻",
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分の最終点数が40000点以上だった場合に限り、最終点数に500点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores[owner]! >= 40000, 500),
    },
  },
  "origin-blessing": {
    id: "origin-blessing",
    name: "原点の加護",
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分の最終点数が原点（25000点）の前後1000点以内（24000〜26000点）だった場合に限り、最終点数に300点が加算される。",
    kind: "passive",
    hooks: {
      onMatchEnd: (ctx) => bonusOnMatchEnd(ctx, (scores, owner) => scores[owner]! >= 24000 && scores[owner]! <= 26000, 300),
    },
  },
  "dealer-collection": {
    id: "dealer-collection",
    name: "親の集金",
    description: "使用すると、自分が親の時に限り、他の3人から400点ずつ（合計1200点）を即座に奪い取る（自分が親でなければ何も起きない）。使用すると無くなる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => (ctx.round.dealerSeat === ctx.owner ? drainPointsEach(ctx, 400) : ctx.round),
    },
  },
  "insight-3": {
    id: "insight-3",
    name: "偵察・三度",
    description: "使用すると、次に自分がツモるまでの1巡の間、他家3人の手牌がすべて見える（偵察と同じ効果）。対局を通して3回まで使用できる（使うたびに1回消費、使い切ると無くなる）。",
    kind: "consumable",
    maxUses: 3,
    hooks: {
      onUse: (ctx) => ({ ...ctx.round, handsRevealedTo: ctx.owner }),
    },
  },
  "future-sight-double": {
    id: "future-sight-double",
    name: "未来視・二連",
    description: "使用すると、通常のローテーション（誰も鳴かない前提）で次に自分が自摸ってくるはずの牌と、その次の1枚の計2枚を、あらかじめ見ることができる。対局を通して2回まで使用でき、誰かが鳴いて手番の巡りがズレると、以降の予知は外れる。",
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
    description: "使用すると、次に敵が必殺技を使った瞬間、その効果を1度だけ無効化する（無効化の効果は無効化と同じ）。対局を通して2回まで使用できる（使うたびに1回消費、使い切ると無くなる）。",
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
    description: "使用すると、自分が親の時に限り、他の3人から1500点ずつ（合計4500点）を即座に奪い取る（自分が親でなければ何も起きない）。使用すると無くなる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => (ctx.round.dealerSeat === ctx.owner ? drainPointsEach(ctx, 1500) : ctx.round),
    },
  },
  "dora-guarantee-2": {
    id: "dora-guarantee-2",
    name: "ドラ二枚確約",
    description: "持っているだけの常時効果。配牌時、手牌のドラ（表ドラ、および赤ドラ）が2枚に満たなければ、山から該当する牌を調達して手牌の別の牌と入れ替え、必ず2枚以上入った状態にする（山のドラが尽きれば不発）。",
    kind: "passive",
    hooks: {
      onDealHand: (ctx) => {
        const { round, owner } = ctx;
        const { hand, wall } = ensureAtLeastDoraTiles(round.players[owner]!.hand, round.wall, DORA_GUARANTEE_2_COUNT);
        return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
      },
    },
  },
  "dealer-boon": {
    id: "dealer-boon",
    name: "親の加護",
    description: "持っているだけの常時効果。自分が親の局で和了した時、翻数が1翻アップする（他に役が無い手には乗らない。役満には影響しない）。使っても無くならない。",
    kind: "passive",
    hooks: {
      // 実際の加算はgameEngine.tsのpassiveBonusHanが行う。
    },
  },
  "riichi-boon": {
    id: "riichi-boon",
    name: "立直の加護",
    description: "持っているだけの常時効果。自分が立直して和了した時、翻数が1翻アップする（他に役が無い手には乗らない。役満には影響しない）。使っても無くならない。",
    kind: "passive",
    hooks: {
      // 実際の加算はgameEngine.tsのpassiveBonusHanが行う。
    },
  },
  "tsumo-boon": {
    id: "tsumo-boon",
    name: "ツモの加護",
    description: "持っているだけの常時効果。自分がツモ和了した時、翻数が1翻アップする（他に役が無い手には乗らない。役満には影響しない）。使っても無くならない。",
    kind: "passive",
    hooks: {
      // 実際の加算はgameEngine.tsのpassiveBonusHanが行う。
    },
  },
  "triplet-seed": {
    id: "triplet-seed",
    name: "暗刻の種",
    description: "持っているだけの常時効果。配牌時、手牌に刻子（同じ牌3枚）が無ければ、トイツの1つに山から同じ牌を1枚足して刻子にする（トイツが無い、または山に同じ牌が無ければ不発）。",
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
    description: "使用すると、自分の必殺技ゲージが最大値の6割ぶん増える（最大値を超えない）。ゲージを持たないキャラでは何も起きない。使用すると無くなる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => {
        const character = CHARACTERS[ctx.round.characterIds[ctx.owner]];
        if (!character || character.gaugeMax <= 0) return ctx.round;
        return addGauge(ctx.round, ctx.owner, Math.ceil(character.gaugeMax * GAUGE_FILL_HALF_RATIO));
      },
    },
  },
  nullify: {
    id: "nullify",
    name: "無効化",
    description: "使用すると、次に敵が必殺技を使った瞬間、その効果を1度だけ無効化する（発動自体は取り消せないため、相手はゲージだけ失って空撃ちになる）。使用すると無くなる。",
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
    description: "使用すると、通常のローテーション（誰も鳴かない前提）で次に自分が自摸ってくるはずの牌1枚だけを、あらかじめ見ることができる。対局を通して3回まで使用でき（使うたびに1回消費、使い切ると無くなる）、誰かが鳴いて手番の巡りがズレると、以降の予知は外れる。",
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
    description: "使用すると、この局で次に自分が和了した時、翻数が1翻アップする（他に役が無い手には乗らない。役満には影響しない）。この局中に和了できなければ不発。使用すると無くなる。",
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
    description: "使用すると、この局で次に自分が和了した時、翻数が2翻アップする（他に役が無い手には乗らない。役満には影響しない）。この局中に和了できなければ不発。使用すると無くなる。",
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
    description: "使用すると、この局で次に自分が和了した時、翻数が3翻アップする（他に役が無い手には乗らない。役満には影響しない）。この局中に和了できなければ不発。使用すると無くなる。",
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
    description: "使用すると、他の3人から500点ずつ（合計1500点）を即座に奪い取る。和了や流局を待たない即時効果。使用すると無くなる。",
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
    description: "使用すると、他の3人から1000点ずつ（合計3000点）を即座に奪い取る。和了や流局を待たない即時効果。使用すると無くなる。",
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
    description: "持っているだけの常時効果。当たり牌（本来なら他家にロンされてしまう牌）を切っても1度だけロンされなくなる（フリテンとは別枠の無効化）。実際にロンを防いだ瞬間に消費されて無くなる（安全な牌を切っている間は温存される）。",
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
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分が最下位（4位。同点最下位も含む）だった場合に限り、最終点数に5000点が加算される。",
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
    description: "持っているだけの常時効果。対局（半荘/東風戦）が終了した瞬間、自分が1位でなければ、最終点数に3000点が加算される。",
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
    description: "持っているだけの常時効果。自分の必殺技ゲージの増加量が常に1.5倍（端数は切り上げ）になる。使っても無くならない（何度でも発動する）。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのgainGaugeが行う。
    },
  },
  "tenpai-insurance": {
    id: "tenpai-insurance",
    name: "聴牌保険",
    description: "持っているだけの常時効果。荒牌流局した時、自分がテンパイしていなくても1度だけテンパイ扱いにしてもらえる（ノーテン罰符を回避できる）。実際に発動した瞬間に消費されて無くなる（自力でテンパイしていた場合は消費されない）。",
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
    description: "使用すると、この局で立直中に和了した時、裏ドラ表示牌をもう1枚追加でめくる（通常の裏ドラに加えて数える）。この局中に立直和了できなければ不発。使用すると無くなる。",
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
    description: "持っているだけの常時効果。自分の持ち点が0点未満に落ちる瞬間、1度だけ0点で踏みとどまる（箱割れによる即終了を防げる）。実際に発動した瞬間に消費されて無くなる。",
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
    description: "使用すると、次に自分がツモるまでの1巡の間、他家3人の手牌がすべて見える（カゲロウの必殺技「透視の術」と同じ効果）。使用すると無くなる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({ ...ctx.round, handsRevealedTo: ctx.owner }),
    },
  },
  "tile-count-insight": {
    id: "tile-count-insight",
    name: "牌読み",
    description: "使用すると、この局が終わるまで、待ち牌表示の残り枚数が「見えている牌からの推測」ではなく「実際に山に残っている正確な枚数」になる（スバルの必殺技「山読み」と同じ効果）。使用すると無くなる。",
    kind: "consumable",
    hooks: {
      onUse: (ctx) => ({ ...ctx.round, wallReadRevealedTo: ctx.owner }),
    },
  },
  "furiten-clear": {
    id: "furiten-clear",
    name: "フリテン解除",
    description: "持っているだけの常時効果。自分の見逃しによるフリテンでも1度だけロンできるようになる。実際にロンが成立した瞬間に消費されて無くなる（フリテンでない普通のロンでは消費しない）。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定はgameEngine.tsの
      // analyzeRonForPlayer、消費はapplyRonDeclarationが行う。
    },
  },
  "uncallable-yakuhai": {
    id: "uncallable-yakuhai",
    name: "鳴かれず",
    description: "持っているだけの常時効果。対局中1度だけ、自分が切った役牌（白發中）を他家にポン/カンされない。実際にブロックした瞬間に消費されて無くなる。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定・消費は
      // gameEngine.tsのapplyCallDeclaration（isYakuhaiGuarded）が行う。
    },
  },
  "ippatsu-extend": {
    id: "ippatsu-extend",
    name: "一発延長",
    description: "持っているだけの常時効果。自分の一発中に他家が鳴いても、その一発の権利を1度だけ消えずに継続させる。実際に発動した瞬間に消費されて無くなる。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定・消費は
      // gameEngine.tsのclearAllIppatsuが行う。
    },
  },
  "no-cost-riichi": {
    id: "no-cost-riichi",
    name: "ノーコストリーチ",
    description: "持っているだけの常時効果。次に自分がリーチする時だけ、1000点の供託を払わずに立直できる。実際にリーチが成立した瞬間に消費されて無くなる。",
    kind: "consumable",
    hooks: {
      // onUseを持たない＝useCardボタンでは使えない。実際の判定・消費は
      // gameEngine.tsのapplyRiichiActionが行う。
    },
  },
  "score-double": {
    id: "score-double",
    name: "大逆転の目",
    description: "使用すると、この局で次に自分が和了した時の最終得点（本場込み・供託は除く）が2倍になる（役満は対象外）。この局中に和了できなければ不発。使用すると無くなる。",
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
    description: "持っているだけの常時効果。オーラス（この対局形式の最終局）に限り、自分の必殺技ゲージの増加量が2倍になる。使っても無くならない（何度でも発動する）。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameEngine.tsのgainGauge（isFinalHand）が行う。
    },
  },
  "kyotaku-collector": {
    id: "kyotaku-collector",
    name: "供託回収",
    description: "持っているだけの常時効果。対局終了時、場にまだ残っている供託（リーチ棒）があれば、通常は総合トップのプレイヤーが受け取るところを自分がまとめて受け取る。",
    kind: "passive",
    hooks: {
      // 実際の判定はgameStore.tsのresolveKyotakuWithCardが行う
      // （settleLeftoverKyotakuの代わりに呼ぶ）。
    },
  },
  "dealer-honba-boost": {
    id: "dealer-honba-boost",
    name: "親孝行",
    description: "持っているだけの常時効果。自分が親として和了した時に受け取る本場ボーナスが2倍になる。",
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
    const cardId = round.cardIds[seat];
    if (!cardId) continue;
    const onMatchEnd = CARDS[cardId]?.hooks.onMatchEnd;
    if (onMatchEnd) next = onMatchEnd({ scores: next, owner: seat });
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
  const collector = ([0, 1, 2, 3] as PlayerIndex[]).find((seat) => round.cardIds[seat] === "kyotaku-collector");
  if (collector === undefined) return fallback(scores, kyotaku);
  const next = [...scores] as [number, number, number, number];
  next[collector] += kyotaku * 1000;
  return next;
}

/** カード「箱割れ防止」の判定・消費。局が終わって点数(scores)が確定した瞬間
    （gameStore.tsが対局終了/箱割れを判定する直前）に呼ぶ。持ち点が0点未満に
    落ちている座席それぞれについて、そのカードを持ち未消費なら0点まで
    引き上げ、cardUsesRemainingを1減らす。RoundState.cardIds/cardUsesRemaining
    は次局へ持ち越されるフィールドのため、更新後のRoundStateも一緒に返す
    （呼び出し側はこれをmatch.roundへ書き戻す必要がある）。 */
export function applyCardBustGuards(
  round: RoundState,
  scores: [number, number, number, number],
): { round: RoundState; scores: [number, number, number, number] } {
  const nextScores = [...scores] as [number, number, number, number];
  const cardUsesRemaining = [...round.cardUsesRemaining] as RoundState["cardUsesRemaining"];
  let changed = false;
  for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
    if (nextScores[seat]! >= 0) continue;
    if (round.cardIds[seat] !== "bust-guard" || cardUsesRemaining[seat] <= 0) continue;
    nextScores[seat] = 0;
    cardUsesRemaining[seat] -= 1;
    changed = true;
  }
  if (!changed) return { round, scores };
  return { round: { ...round, cardUsesRemaining }, scores: nextScores };
}

/** CPU座席用に、全カードの中からランダムに1枚選ぶ（必ず何か持つ。「なし」は無い）。 */
export function randomCardId(rng: () => number = Math.random): string {
  return CARD_IDS[Math.floor(rng() * CARD_IDS.length)]!;
}
