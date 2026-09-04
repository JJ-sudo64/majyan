/**
 * カードシステム。対局開始前にキャラクターとは別に1枚だけ選んで持っていける
 * 追加要素。人間は自分で選択、CPU3人は対局開始時にランダムで1枚割り当てられる。
 * キャラクターの必殺技システム（skills/types.ts・characters.ts）と同じ
 * フック方式で実装し、実際の発動タイミングはgameEngine.ts/matchFormat.ts側で
 * 呼び出す。
 */
import type { PlayerIndex } from "./actions.js";
import type { RoundState } from "./gameState.js";
import type { TileCode } from "./tiles.js";
import { ensureAtLeastOneMeld, ensureAtLeastOneDora } from "./dealAdjust.js";

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
