/**
 * キャラクター定義の一覧。
 * 強力な効果ほどgaugePerTurn/gaugePerDealInを小さくして溜まりにくくし、
 * 控えめな効果は溜まりやすくすることで強さと発動頻度のバランスを取る。
 * ライコのように発動条件（canActivate）自体を絞ったキャラは、その分
 * ゲージを溜めやすくしても釣り合う。
 */
import type { Character, SkillContext } from "./skills/types.js";
import type { RoundState } from "./gameState.js";
import type { PlayerIndex } from "./actions.js";
import { revealNextDora, drawFromLive, doraIndicators, type WallState } from "./wall.js";
import { addTileToHand, getWaitingTiles, removeTileFromHand, type Hand } from "./hand.js";
import { calcShanten, bestShantenAfterDiscard } from "./shanten.js";
import { nextTileForDora, sortTiles, isNumbered, numberOf, suitOf, tileCodeToIndex, type Tile, type TileCode } from "./tiles.js";
import { countsFromCodes } from "./decompose.js";
import { ensureAtLeastOneMeld, ensureNoMelds } from "./dealAdjust.js";

function updatePlayer(round: RoundState, index: number, updater: (p: RoundState["players"][number]) => RoundState["players"][number]): RoundState["players"] {
  const next = [...round.players] as RoundState["players"];
  next[index] = updater(next[index]!);
  return next;
}

/** セナの「様子見」用。gameEngine.tsのnextSeatと同じ計算だが、あちらは
    モジュール非公開のためここで同じ内容を持つ（4人打ち固定のため常に
    この式で次家が求まる）。 */
function nextSeat(player: PlayerIndex): PlayerIndex {
  return ((player + 1) % 4) as PlayerIndex;
}

/** ナギ/ライコのように「今の自摸牌をすり替える」タイプの必殺技が発動可能かどうか。
    チー/ポン/大明槓で手番だけ回ってきた直後はphaseが"awaiting-discard"でも
    round.lastDrawnTileが（鳴く前の別プレイヤーの）自摸のまま更新されておらず、
    本人の手牌には存在しない。これに気づかずonActivateがremoveTileFromHandを
    呼ぶと例外が飛び、CPUの自動発動ループ（gameStore.tsのtick）がtry/catch無しで
    それを踏むと対局が無言のまま進行しなくなる（フリーズしたように見える）。 */
function hasOwnPendingDraw(round: RoundState, owner: number): boolean {
  const drawn = round.lastDrawnTile;
  if (!drawn) return false;
  return round.players[owner]!.hand.concealed.some((t) => t.id === drawn.id);
}

/** ナオキの「クマクマタイム」で配牌改善に使う最大試行回数。大きいほど
    強力（テンパイに達しやすい）だが計算量も増える。元は20だったが
    「強すぎる」との指摘を受けて半分にした。 */
const NAOKI_DRAFT_ATTEMPTS = 10;

/** サキの「特技ドラ引き」用: gaugeMaxと同じ値。ゲージ満タン判定を
    onBeforeDraw側（＝キャラのgaugeMaxフィールドとは別の場所）で自前で
    行う必要があるため、値を二重管理しないよう定数として切り出している。 */
const SAKI_GAUGE_MAX = 100;

/** ライコの「一閃」用: gaugeMaxと同じ値。サキと同じ理由でonBeforeDraw側の
    自前のゲージ満タン判定に定数として切り出している。 */
const RAIKO_GAUGE_MAX = 100;

/** ナオキの「クマクマタイム」用: 配牌済みの13枚を山からの1枚ずつの
    入れ替え（ヒルクライム法）で改善する。各試行で山から1枚引き、
    それを手牌のどれかと入れ替えた時に最もシャンテン数が良くなる組み合わせ
    があれば採用（元の牌は山の末尾へ戻す）、無ければ引いた牌をそのまま
    山の末尾へ戻して次の試行へ。既にテンパイ以上（シャンテン<=0）になった
    時点、または試行回数上限に達した時点で終了する。山と手牌の間で牌を
    交換するだけなので、合計牌数・各牌の総数（4枚ずつ）は常に保たれる。 */
function draftExceptionalHand(hand: Hand, wall: WallState, attempts: number): { hand: Hand; wall: WallState } {
  let currentHand = hand;
  let currentWall = wall;
  let currentShanten = calcShanten(currentHand);

  for (let i = 0; i < attempts; i++) {
    if (currentShanten <= 0) break;
    if (currentWall.liveTiles.length === 0) break;

    const { tile: candidate, wall: wallAfterDraw } = drawFromLive(currentWall);
    let bestIndex = -1;
    let bestShanten = currentShanten;
    for (let j = 0; j < currentHand.concealed.length; j++) {
      const trialConcealed = [...currentHand.concealed.slice(0, j), ...currentHand.concealed.slice(j + 1), candidate];
      const trialShanten = calcShanten({ concealed: trialConcealed, melds: [] });
      if (trialShanten < bestShanten) {
        bestShanten = trialShanten;
        bestIndex = j;
      }
    }

    if (bestIndex === -1) {
      // 改善なし。引いた牌はそのまま山の末尾へ戻して次の試行へ。
      currentWall = { ...wallAfterDraw, liveTiles: [...wallAfterDraw.liveTiles, candidate] };
      continue;
    }

    const displaced = currentHand.concealed[bestIndex]!;
    const newConcealed = [...currentHand.concealed.slice(0, bestIndex), ...currentHand.concealed.slice(bestIndex + 1), candidate];
    currentHand = { concealed: sortTiles(newConcealed), melds: [] };
    currentShanten = bestShanten;
    currentWall = { ...wallAfterDraw, liveTiles: [...wallAfterDraw.liveTiles, displaced] };
  }

  return { hand: currentHand, wall: currentWall };
}

/** 手牌が4面子+単騎待ちの1枚（＝副露で埋まりきった「裸単騎」）かどうか。
    手牌の総枚数（副露4組+濃厚1枚=13枚）は常に保たれるため、この形は
    必ずテンパイ（単騎待ち）になる。 */
function isNakedTanki(hand: Hand): boolean {
  return hand.melds.length === 4 && hand.concealed.length === 1;
}

/** タカハルの「アトミックベタ降り」用: 打牌によって、手の内で既に完成していた
    面子（刻子＝同じ牌3枚、または順子＝連続する3つの数牌）が崩れたかどうかを
    判定する。preDiscardConcealedCodesは打牌前（切った牌を含む）の手牌コード。
    刻子は「切る前にちょうど3枚あった（4枚以上は暗槓相当で崩れたとは言えない）」、
    順子は「切った牌を含む3連続の数字が切る前は全て1枚以上揃っていて、かつ
    切った牌自身は控えが無い（ちょうど1枚だった）」場合に「崩した」とみなす。 */
function breaksCompletedMeld(preDiscardConcealedCodes: TileCode[], discarded: TileCode): boolean {
  const counts = countsFromCodes(preDiscardConcealedCodes);
  const idx = tileCodeToIndex(discarded);
  if (counts[idx] === 3) return true; // 刻子(暗刻)を崩した

  if (!isNumbered(discarded)) return false;
  const n = numberOf(discarded);
  const suit = suitOf(discarded);
  if (counts[idx] !== 1) return false; // 控えがあるなら他の順子はまだ組める

  for (const start of [n - 2, n - 1, n]) {
    if (start < 1 || start + 2 > 9) continue;
    const a = tileCodeToIndex(`${start}${suit}` as TileCode);
    const b = tileCodeToIndex(`${start + 1}${suit}` as TileCode);
    const c = tileCodeToIndex(`${start + 2}${suit}` as TileCode);
    if (counts[a]! >= 1 && counts[b]! >= 1 && counts[c]! >= 1) return true; // 順子を崩した
  }
  return false;
}

/** メビウスの「陰陽配牌」で崩す面子を探す試行回数の上限。13枚の手牌に
    含まれる完成面子は現実的にはせいぜい1〜2個だが、安全マージンとして
    十分大きめに取っている。 */
const MEBIUS_BREAK_ATTEMPTS = 20;

/** カガミの「写し身」が今、同卓者が直近に発動した必殺技を再現できる状態かどうか。
    以下すべてを満たす場合のみtrue: (1) round.lastActivatedSkillが存在する、
    (2) その発動者が自分以外（同卓者）である、(3) コピー元キャラクターが
    onActivateを持つ（onRiichi専用の自動発動技はボタン経由で再現できないため
    対象外）、(4) コピー元自身の追加発動条件（canActivate。例:
    ライコの「一発中のみ」、タカハルの「未発動中のみ」等）を自分（コピーする側）
    が満たしている。(4)が無いと、コピー元のonActivateが前提とする状態
    （例: 自分の自摸牌が手牌に存在する等）を満たさないまま呼び出され、
    例外が飛ぶおそれがある（nagi/raiko/kaedeのhasOwnPendingDraw等）。
    gameEngine.tsのcanUseSkillがこのcanActivateを経由するため、onActivate側は
    このチェックを通過済みの状態でのみ呼ばれる想定でよい。 */
function canCopyLastSkill(ctx: SkillContext): boolean {
  const last = ctx.round.lastActivatedSkill;
  if (!last || last.owner === ctx.owner) return false;
  const copiedHooks = CHARACTERS[last.characterId]?.skill.hooks;
  if (!copiedHooks?.onActivate) return false;
  if (copiedHooks.canActivate && !copiedHooks.canActivate(ctx)) return false;
  return true;
}

export const CHARACTERS: Record<string, Character> = {
  hiiragi: {
    id: "hiiragi",
    name: "開花の巫女・ヒイラギ",
    description: "必殺技「開花」: ドラ表示牌をもう1枚めくって、ドラを増やす。",
    winQuote: "花は散っても、想いは散りません。だから、また咲かせましょう…！",
    avatar: "/avatars/characters/hiiragi.webp",
    cutin: "/avatars/characters/hiiragi-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    skill: {
      id: "hiiragi-kaika",
      name: "開花",
      description: "ドラ表示牌をもう1枚めくって、ドラを増やす。",
      hooks: {
        onActivate: (ctx) => ({ ...ctx.round, wall: revealNextDora(ctx.round.wall) }),
      },
    },
  },
  nagi: {
    id: "nagi",
    name: "積み込み師・ナギ",
    // 「積み込み師」は実在の職業名ではない造語のため、読み上げが不自然な
    // 区切り方をすることがある。表示名はそのままに読み上げ専用の読みを指定する。
    voiceName: "ツミコミシ・ナギ",
    description: "必殺技「積み込み」: 今引いた牌を山に戻し、代わりに新しい牌を引き直す。",
    winQuote: "牌の並びなんて、ちょっと手を加えるだけ。運も実力のうち、でしょう？",
    avatar: "/avatars/characters/nagi.webp",
    cutin: "/avatars/characters/nagi-cutin.webp",
    // 引き直す牌はランダム（カエデと違い有効牌が保証されない賭け）なので、
    // 制約なしで発動できる点を割り引いてカエデより速くする。
    gaugeMax: 100,
    gaugePerTurn: 8,
    gaugePerDealIn: 25,
    skill: {
      id: "nagi-tsumikomi",
      name: "積み込み",
      voiceName: "ツミコミ",
      description: "今引いた牌を山に戻し、代わりに新しい牌を引き直す。",
      hooks: {
        // チー/ポン/大明槓で手番だけ回ってきた直後（自分ではまだ何も自摸っていない）
        // は発動できない。hasOwnPendingDrawの説明コメント参照。
        canActivate: (ctx) => hasOwnPendingDraw(ctx.round, ctx.owner),
        onActivate: (ctx) => {
          const { round, owner } = ctx;
          const drawn = round.lastDrawnTile;
          if (!drawn) return round;
          const p = round.players[owner]!;
          const { hand: handWithoutDrawn } = removeTileFromHand(p.hand, drawn.id);
          const wallWithReturn = { ...round.wall, liveTiles: [...round.wall.liveTiles, drawn] };
          const { tile: redrawn, wall } = drawFromLive(wallWithReturn);
          const players = updatePlayer(round, owner, (pl) => ({ ...pl, hand: addTileToHand(handWithoutDrawn, redrawn) }));
          return { ...round, players, wall, lastDrawnTile: redrawn };
        },
      },
    },
  },
  raiko: {
    id: "raiko",
    name: "一閃の雷神・ライコ",
    // 「一閃」は読み上げで詰まったり誤読されたりしやすいため、読み上げ専用の
    // 読みを指定する。
    voiceName: "イッセンの雷神・ライコ",
    description: "必殺技「一閃」: リーチ後の一発中、ゲージが満タンなら自動で発動し、待ち牌を引き寄せて一発ツモを狙う。",
    winQuote: "迷いは捨てろ。考えた瞬間、負けは始まる。オレの一撃は、雷鳴とともにすべてを終わらせる。",
    avatar: "/avatars/characters/raiko.webp",
    cutin: "/avatars/characters/raiko-cutin.webp",
    gaugeMax: RAIKO_GAUGE_MAX,
    gaugePerTurn: 12,
    gaugePerDealIn: 20,
    skill: {
      id: "raiko-issen",
      name: "一閃",
      voiceName: "イッセン",
      description: "リーチ後の一発中にのみ発動できる。ゲージが満タンなら、自分がツモった瞬間に自動で発動し、山に残っている自分の待ち牌を1枚引き寄せる（山に残っていなければ不発）。",
      // 一発＝リーチ後にしか発動しない技のため、gameEngine.tsのcanUseSkill/
      // canBorrowSkillにある「リーチ中は必殺技を使えない」という一律ブロックの
      // 例外にする（付けないと一発中という条件そのものに阻まれて永久に
      // 発動できなくなっていた。指摘の原因）。カリンの「借り物」経由の手動
      // 発動（下のonActivate）にも必要。
      usableDuringRiichi: true,
      hooks: {
        // 「リーチと同時（一発中の自摸）に自動発動してほしい、ボタン操作を
        // 挟みたくない」との指摘を受け、本人の分はonBeforeDraw（実際に
        // ツモを引く直前に全プレイヤーのキャラクターへ呼ばれるフック）で
        // 自動化した。ツモる前なので、サキの「特技ドラ引き」と同じ要領で
        // 「これから引く牌」そのものを山の中ですり替えるだけでよく、以前の
        // onActivate（一旦引いた自摸牌を山へ戻し、待ち牌を引き直す）より
        // シンプルになっている。
        onBeforeDraw: (ctx, drawer) => {
          const { round, owner } = ctx;
          if (drawer !== owner) return round; // 自分の自摸にのみ効果がある
          const p = round.players[owner]!;
          if (!p.ippatsuActive) return round;
          if (p.skillGauge < RAIKO_GAUGE_MAX) return round;
          // 成功/不発を問わずこの時点でゲージは消費される（サキと同じ）。
          const players = updatePlayer(round, owner, (pl) => ({ ...pl, skillGauge: 0 }));
          const waits = new Set(getWaitingTiles(p.hand));
          const wallIndex = round.wall.liveTiles.findIndex((t) => waits.has(t.code));
          if (wallIndex === -1) return { ...round, players }; // 不発
          const liveTiles = [...round.wall.liveTiles];
          const target = liveTiles[wallIndex]!;
          liveTiles[wallIndex] = liveTiles[0]!;
          liveTiles[0] = target;
          return { ...round, players, wall: { ...round.wall, liveTiles } };
        },
        // 以降はカリンの「借り物競争」専用の手動発動経路として残す（借りた本人
        // ＝カリン自身のctx.ownerに対して働くため、上のonBeforeDraw（本人限定、
        // drawer!==ownerで弾く）では代替できない）。ライコ自身の分は常に
        // onBeforeDrawが先に自動発動しゲージを消費するため、この手動経路が
        // ライコ自身のuseSkillボタンとして表に出ることはない。
        // hasOwnPendingDrawは本来リーチ中の鳴き不可ルールにより常に満たされるはずだが、
        // nagiと同じ地雷（自摸牌すり替え系）を踏まないよう念のため二重にチェックする。
        canActivate: (ctx) => ctx.round.players[ctx.owner]!.ippatsuActive && hasOwnPendingDraw(ctx.round, ctx.owner),
        onActivate: (ctx) => {
          const { round, owner } = ctx;
          const drawn = round.lastDrawnTile;
          if (!drawn) return round;
          const p = round.players[owner]!;
          const { hand: handWithoutDrawn } = removeTileFromHand(p.hand, drawn.id);
          const waits = new Set(getWaitingTiles(handWithoutDrawn));
          const wallIndex = round.wall.liveTiles.findIndex((t) => waits.has(t.code));
          if (wallIndex === -1) return round;
          const target = round.wall.liveTiles[wallIndex]!;
          const liveTiles = [
            ...round.wall.liveTiles.slice(0, wallIndex),
            ...round.wall.liveTiles.slice(wallIndex + 1),
            drawn,
          ];
          const wall = { ...round.wall, liveTiles };
          const players = updatePlayer(round, owner, (pl) => ({ ...pl, hand: addTileToHand(handWithoutDrawn, target) }));
          return { ...round, players, wall, lastDrawnTile: target };
        },
      },
    },
  },
  toki: {
    id: "toki",
    name: "嶺上の予言者・トキ",
    // 「嶺上」は読み上げ(speechSynthesis)だと「みねじょう」等に誤読されやすいため、
    // 表示名はそのままに読み上げ専用の読みを別途指定する。
    voiceName: "リンシャンの予言者・トキ",
    description: "必殺技「嶺上顕現」: 発動後、次にテンパイ中にカンをすると、嶺上ツモが待ち牌にすり替わり嶺上開花で和了できる。",
    winQuote: "未来は決まっている。ただ、まだ見えないだけだ。",
    avatar: "/avatars/characters/toki.webp",
    cutin: "/avatars/characters/toki-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 14,
    gaugePerDealIn: 22,
    skill: {
      id: "toki-reijou-kengen",
      name: "嶺上顕現",
      voiceName: "リンシャンケンゲン",
      description: "発動後、次にテンパイ中にカンをした瞬間、そのカンで引く嶺上牌が自分の待ち牌にすり替わり、嶺上開花で必ず和了できる（待ち牌が山に残っていなければ不発）。テンパイでない時にカンをしても、権利はそのまま持ち越される。",
      hooks: {
        // 実際の効果はカンの解決処理側(gameEngine.tsのresolveGuaranteedRinshan)に
        // あり、ここではその権利フラグを立てるだけ。
        onActivate: (ctx) => ({
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, guaranteedRinshan: true })),
        }),
      },
    },
  },
  kagerou: {
    id: "kagerou",
    name: "千里眼の忍・カゲロウ",
    // 「千里眼」は読み上げ(speechSynthesis)だと「せんりめ」等に誤読されやすいため、
    // 表示名はそのままに読み上げ専用の読みを別途指定する。
    voiceName: "センリガンの忍・カゲロウ",
    description: "必殺技「透視の術」: 発動すると1巡の間、他の3人の手牌が見えるようになる。",
    winQuote: "勝負は、派手に勝つより、静かに勝つもの。誰も気づいた時には、もう終わってる。",
    avatar: "/avatars/characters/kagerou.webp",
    cutin: "/avatars/characters/kagerou-cutin.webp",
    // 他家3人の手牌が丸見えになる情報アドバンテージは大きいため、標準(10)より遅くする。
    gaugeMax: 100,
    gaugePerTurn: 8,
    gaugePerDealIn: 20,
    skill: {
      id: "kagerou-toushi",
      name: "透視の術",
      description: "発動すると、次に自分がツモるまでの1巡の間、他の3人の手牌がすべて見えるようになる。",
      hooks: {
        // 実際の可視化はUI側(OpponentArea.tsx)がround.handsRevealedToを見て行う。
        // 効果が切れるタイミング（発動者が1巡して自分のツモを迎えた瞬間）は
        // gameEngine.tsのapplyDrawActionで処理している。
        onActivate: (ctx) => ({ ...ctx.round, handsRevealedTo: ctx.owner }),
      },
    },
  },
  runa: {
    id: "runa",
    name: "運命の配師・ルナ",
    // 「配師」は実在の職業名ではない造語のため読み上げが不自然になりやすい。
    voiceName: "運命のハイシ・ルナ",
    description: "必殺技「運命の采配」: 発動した次の局で、手牌の好きな3枚を山の新しい牌と交換できる。",
    winQuote: "配られた運命は変えられなくても、並び替えることはできる。それが、わたしのやり方。",
    avatar: "/avatars/characters/runa.webp",
    cutin: "/avatars/characters/runa-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    skill: {
      id: "runa-unmei-no-saihai",
      name: "運命の采配",
      voiceName: "ウンメイのサイハイ",
      description: "発動すると、次の局の配牌直後から、自分が最初の1枚を切ったり鳴いたりするまでの間だけ、手牌の好きな3枚を山の新しい牌と交換できる。",
      hooks: {
        // 実際の交換権の消費・行使はgameEngine.tsのcanSwapStartingTile/
        // applySwapTileActionと、局をまたぐ橋渡しはgameStore.tsの
        // acknowledgeRoundEnd（→matchFormat.tsのdealNewRound）が担う。
        // ここでは「次局で権利が発生する」というフラグを立てるだけ。
        onActivate: (ctx) => ({
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, pendingTileSwapNextRound: true })),
        }),
      },
    },
  },
  subaru: {
    id: "subaru",
    name: "山読みの軍師・スバル",
    // 「山読み」は麻雀用語の造語で、漢字のまま読み上げると「さんどく」等に
    // 誤読されやすい。
    voiceName: "ヤマヨミの軍師・スバル",
    description: "必殺技「山読み」: 発動すると、その局が終わるまで待ち牌が山に何枚残っているか正確にわかるようになる。",
    winQuote: "運任せなんて言葉は、数えることを放棄した者の言い訳だ。俺はただ、見えている数を数えただけだよ。",
    avatar: "/avatars/characters/subaru.webp",
    cutin: "/avatars/characters/subaru-cutin.webp",
    // 手牌が見えるカゲロウと違い「残り枚数の精度が上がる」だけの地味な効果
    // のため、標準(10)より速くする。
    gaugeMax: 100,
    gaugePerTurn: 13,
    gaugePerDealIn: 20,
    skill: {
      id: "subaru-yamayomi",
      name: "山読み",
      voiceName: "ヤマヨミ",
      description: "発動すると、その局が終わるまで、待ち牌の残り枚数が推測ではなく、実際に山に残っている正確な枚数で表示されるようになる。",
      hooks: {
        // 実際の枚数計算はUI側(Hand.tsx)がround.wallReadRevealedToを見て行う。
        // 次局まで持ち越さず、その局の間だけ効果が続く（次局の配牌でリセットされる）。
        onActivate: (ctx) => ({ ...ctx.round, wallReadRevealedTo: ctx.owner }),
      },
    },
  },
  kaede: {
    id: "kaede",
    name: "百戦の学匠・カエデ",
    // 「学匠」は実在の一般的な単語ではない造語のため読み上げが不自然になりやすい。
    voiceName: "百戦のガクショウ・カエデ",
    description: "必殺技「手ほどき」: 発動すると、今引いた牌を手が必ず良くなる牌にすり替える（テンパイ中は発動不可）。",
    winQuote: "一歩ずつでいい。だが、その一歩を疎かにする者に、大成は無い。",
    avatar: "/avatars/characters/kaede.webp",
    cutin: "/avatars/characters/kaede-cutin.webp",
    voiceClips: {
      chi: "/voices/kaede/chi.wav",
      pon: "/voices/kaede/pon.wav",
      kan: "/voices/kaede/kan.wav",
      riichi: "/voices/kaede/riichi.wav",
      tsumo: "/voices/kaede/tsumo.wav",
      ron: "/voices/kaede/ron.wav",
      skillActivate: "/voices/kaede/skill-activate.wav",
      winQuote: "/voices/kaede/win-quote.wav",
      greeting: "/voices/kaede/greeting.wav",
      tenpai: "/voices/kaede/tenpai.wav",
      noten: "/voices/kaede/noten.wav",
    },
    // yaku/index.tsのyaku名・scoring.tsのlimitNameと完全一致するキーのみ
    // 再生される。ゲーム側に無い役（九蓮宝燈等）のファイルも将来の実装に
    // 備えてそのまま対応させてあるが、現状は発火しない。
    yakuVoiceClips: {
      "立直": "/voices/kaede/riichi.wav",
      "ダブル立直": "/voices/kaede/yaku/ダブルリーチ.wav",
      "一発": "/voices/kaede/yaku/一発.wav",
      "平和": "/voices/kaede/yaku/ピンフ.wav",
      "断幺九": "/voices/kaede/yaku/タンヤオ.wav",
      "海底摸月": "/voices/kaede/yaku/海底.wav",
      "河底撈魚": "/voices/kaede/yaku/河底.wav",
      "嶺上開花": "/voices/kaede/yaku/嶺上開花.wav",
      "槍槓": "/voices/kaede/yaku/槍槓.wav",
      "七対子": "/voices/kaede/yaku/チートイ.wav",
      "一盃口": "/voices/kaede/yaku/イーペーコー.wav",
      "二盃口": "/voices/kaede/yaku/リャンペーコー.wav",
      "三色同順": "/voices/kaede/yaku/三色同順.wav",
      "三色同刻": "/voices/kaede/yaku/三色同刻.wav",
      "一気通貫": "/voices/kaede/yaku/一気通貫.wav",
      "混老頭": "/voices/kaede/yaku/混老頭.wav",
      "純全帯幺九": "/voices/kaede/yaku/純ちゃん.wav",
      "対々和": "/voices/kaede/yaku/トイトイ.wav",
      "三暗刻": "/voices/kaede/yaku/サンアンコウ.wav",
      "三槓子": "/voices/kaede/yaku/三槓子.wav",
      "小三元": "/voices/kaede/yaku/しょうさんげん.wav",
      "混一色": "/voices/kaede/yaku/ホンイツ.wav",
      "清一色": "/voices/kaede/yaku/チンイツ.wav",
      "清老頭": "/voices/kaede/yaku/チンロウトウ.wav",
      "字一色": "/voices/kaede/yaku/字一色.wav",
      "緑一色": "/voices/kaede/yaku/緑一色.wav",
      "大三元": "/voices/kaede/yaku/大三元.wav",
      "小四喜": "/voices/kaede/yaku/小四喜.wav",
      "大四喜": "/voices/kaede/yaku/大四喜.wav",
      "四暗刻": "/voices/kaede/yaku/四暗刻.wav",
      "四暗刻単騎": "/voices/kaede/yaku/四暗刻.wav",
      "四槓子": "/voices/kaede/yaku/四槓子.wav",
      "国士無双": "/voices/kaede/yaku/国士無双.wav",
      "国士無双十三面": "/voices/kaede/yaku/国士無双.wav",
      "九蓮宝燈": "/voices/kaede/yaku/九蓮宝燈.wav",
      "天和": "/voices/kaede/yaku/天和.wav",
      "地和": "/voices/kaede/yaku/地和.wav",
      "満貫": "/voices/kaede/yaku/満貫.wav",
      "跳満": "/voices/kaede/yaku/跳満.wav",
      "倍満": "/voices/kaede/yaku/倍満.wav",
      "三倍満": "/voices/kaede/yaku/三倍満.wav",
      "役満": "/voices/kaede/yaku/役満.wav",
      "役牌:白": "/voices/kaede/yaku/白.wav",
      "役牌:發": "/voices/kaede/yaku/発.wav",
      "役牌:中": "/voices/kaede/yaku/中.wav",
    },
    // 自風牌・場風牌は役名だけでは実際の風が分からないため、風の値
    // （1=東 2=南 3=西 4=北）ごとに個別対応させる。
    windVoiceClips: {
      1: "/voices/kaede/yaku/東.wav",
      2: "/voices/kaede/yaku/南.wav",
      3: "/voices/kaede/yaku/西.wav",
      4: "/voices/kaede/yaku/北.wav",
    },
    // ドラ・裏ドラ・赤ドラは本数だけで読み上げを決める（1本なら「ドラ」、
    // 2本以上なら「ドラn」）。
    doraVoiceClips: {
      1: "/voices/kaede/yaku/ドラ.wav",
      2: "/voices/kaede/yaku/ドラ2.wav",
      3: "/voices/kaede/yaku/ドラ3.wav",
      4: "/voices/kaede/yaku/ドラ4.wav",
      5: "/voices/kaede/yaku/ドラ5.wav",
      6: "/voices/kaede/yaku/ドラ6.wav",
      7: "/voices/kaede/yaku/ドラ7.wav",
      8: "/voices/kaede/yaku/ドラ8.wav",
      9: "/voices/kaede/yaku/ドラ9.wav",
      10: "/voices/kaede/yaku/ドラ10.wav",
      11: "/voices/kaede/yaku/ドラ11.wav",
      12: "/voices/kaede/yaku/ドラ12.wav",
    },
    // ナギと違い引き直す牌が必ず有効牌になる（結果が保証されている）ため、
    // テンパイ中不可という制約を差し引いてもナギより遅くする。
    gaugeMax: 100,
    gaugePerTurn: 6,
    gaugePerDealIn: 20,
    skill: {
      id: "kaede-tehodoki",
      name: "手ほどき",
      description: "発動すると、今引いた牌を山に戻し、手が必ず良くなる牌を山から引き直す（該当する牌が山に残っていなければ不発）。テンパイ中（あと1枚で和了の状態）は発動できない。",
      hooks: {
        // 聴牌中は発動不可（有効牌＝和了牌そのものになってしまい、ライコの
        // 一発ツモ確定と役割が被って強すぎるため）。この判定は本人の現在の
        // 待ち（自摸牌を除いた13枚相当）のシャンテン数で行う。
        canActivate: (ctx) => {
          if (!hasOwnPendingDraw(ctx.round, ctx.owner)) return false;
          const drawn = ctx.round.lastDrawnTile!;
          const p = ctx.round.players[ctx.owner]!;
          const { hand: handWithoutDrawn } = removeTileFromHand(p.hand, drawn.id);
          return calcShanten(handWithoutDrawn) !== 0;
        },
        onActivate: (ctx) => {
          const { round, owner } = ctx;
          const drawn = round.lastDrawnTile;
          if (!drawn) return round;
          const p = round.players[owner]!;
          const { hand: handWithoutDrawn } = removeTileFromHand(p.hand, drawn.id);
          const currentShanten = calcShanten(handWithoutDrawn);
          const wallIndex = round.wall.liveTiles.findIndex((t) => {
            const candidate: Hand = { concealed: [...handWithoutDrawn.concealed, t], melds: handWithoutDrawn.melds };
            return bestShantenAfterDiscard(candidate) < currentShanten;
          });
          if (wallIndex === -1) return round;
          const target = round.wall.liveTiles[wallIndex]!;
          const liveTiles = [
            ...round.wall.liveTiles.slice(0, wallIndex),
            ...round.wall.liveTiles.slice(wallIndex + 1),
            drawn,
          ];
          const wall = { ...round.wall, liveTiles };
          const players = updatePlayer(round, owner, (pl) => ({ ...pl, hand: addTileToHand(handWithoutDrawn, target) }));
          return { ...round, players, wall, lastDrawnTile: target };
        },
      },
    },
  },
  jin: {
    id: "jin",
    name: "捨て身の伊達者・ジン",
    // 「伊達者」は「だてもの」と読む慣用読みだが、一般的なTTSの規則読みでは
    // 「いだてもの」等に誤読されやすいため、読み上げ専用の読みを指定する。
    voiceName: "捨て身のダテモノ・ジン",
    description: "必殺技「大明立直」: ゲージが満タンの状態でリーチすると、自動的にオープンリーチ（手牌を全員に公開）になる代わりに、和了時の翻数が3翻アップする。",
    winQuote: "見せてやるよ、俺の手は。逃げも隠れもしない、それが漢の勝負ってもんだ。",
    avatar: "/avatars/characters/jin.webp",
    cutin: "/avatars/characters/jin-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    skill: {
      id: "jin-daimei-riichi",
      name: "大明立直",
      // 造語の四字熟語風の技名で、一般的な音読み規則だと「だいめいりっちょく」
      // 等に誤読されやすいため、読み上げ専用の読みを指定する。
      voiceName: "ダイミンリーチ",
      description: "必殺技ゲージが満タンの状態でリーチを宣言すると、自動的にオープンリーチ（手牌が全員に公開されるリーチ）になる。その代わり、そのまま和了できれば「オープンリーチ」役として翻数が3翻アップする。",
      hooks: {
        // useSkillアクションを介さず、ゲージ満タンでのリーチ宣言そのものが
        // トリガーになる（gameEngine.tsのapplyRiichiAction参照）。ここでは
        // 「オープンリーチとして成立した」ことを表す状態変更だけを行う。
        onRiichi: (ctx) => ({
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, openRiichi: true })),
        }),
      },
    },
  },
  ren: {
    id: "ren",
    name: "強運の賭け師・レン",
    description: "必殺技「捲る運命」: ゲージが満タンの状態でリーチすると自動的に発動し、そのまま和了すれば裏ドラが必ず1つ以上乗る。",
    winQuote: "運は掴むものじゃない。捲るものだ。ほら、見えただろ？",
    avatar: "/avatars/characters/ren.webp",
    cutin: "/avatars/characters/ren-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    skill: {
      id: "ren-mekuru-unmei",
      name: "捲る運命",
      // 「捲る」は「めくる」と読ませたいが、一般的なTTSでは「まくる」等に
      // 誤読されやすいため、読み上げ専用の読みを指定する。
      voiceName: "メクルウンメイ",
      description: "必殺技ゲージが満タンの状態でリーチを宣言すると自動的に発動する。以後その局でリーチ中に和了できれば、手牌の中で一番多い牌が裏ドラとして必ず1枚以上乗る。",
      hooks: {
        // useSkillアクションを介さず、ゲージ満タンでのリーチ宣言そのものが
        // トリガーになる（gameEngine.tsのapplyRiichiAction参照）。実際の
        // 消費（裏ドラ表示牌の入れ替え）はgameEngine.tsの
        // applyGuaranteedUraDoraForWinnerが「立直中に和了した瞬間」に別途
        // 行うため、ここでは予約フラグを立てるだけでよい。
        onRiichi: (ctx) => ({
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, guaranteedUraDora: true })),
        }),
      },
    },
  },
  masato: {
    id: "masato",
    name: "卓上のてんこしゃんこ・マサト",
    description: "必殺技「三色の煌めき」: 発動すると、三色同順に近づく牌が5秒間光って見える演出。",
    winQuote: "てんこしゃんこ、っと。……あれ、三色乗ってる？ラッキー。",
    avatar: "/avatars/characters/masato.webp",
    cutin: "/avatars/characters/masato-cutin.webp",
    // 局面・点数に一切影響しない純粋な見た目だけの効果（このゲーム内で
    // 最も弱い必殺技）なので、全キャラ中最速で溜まるようにする。
    gaugeMax: 100,
    gaugePerTurn: 24,
    gaugePerDealIn: 20,
    skill: {
      id: "masato-sanshoku-kirameki",
      name: "三色の煌めき",
      description: "発動すると、三色同順（萬子・筒子・索子で同じ数字の順子を1組ずつ揃える役）に近づいている牌が5秒間光る。見た目だけの演出で、局面や点数には影響しない。",
      hooks: {
        // roundの状態を一切変えない純粋な見た目だけの効果。ハイライト対象
        // の計算・表示はUI側(Hand.tsxのcomputeSanshokuHintCodes)が
        // 「ゲージが満タン(>0)から0に戻った瞬間」を検知して行う。
        onActivate: (ctx) => ctx.round,
      },
    },
  },
  mirai: {
    id: "mirai",
    name: "先読みの巫女・ミライ",
    description: "必殺技「未来視」: 発動すると、これから自分がツモる牌を3回分先に見られる。誰かが鳴いて順番がズレると予知は外れる。",
    winQuote: "見えていたもの、そのまま。……たまには外れてくれても面白いのにね。",
    avatar: "/avatars/characters/mirai.webp",
    cutin: "/avatars/characters/mirai-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    skill: {
      id: "mirai-miraishi",
      name: "未来視",
      description: "発動すると、誰も鳴かない前提で、この先3回分の自分のツモ牌をあらかじめ見ることができる。途中で誰かが鳴いて順番がズレると、それ以降の予知は外れてしまう。",
      hooks: {
        onActivate: (ctx) => {
          const liveTiles = ctx.round.wall.liveTiles;
          const revealedFutureDraws: TileCode[] = [];
          for (let i = 0; i < 3; i++) {
            const t = liveTiles[3 + i * 4];
            if (t) revealedFutureDraws.push(t.code);
          }
          return {
            ...ctx.round,
            players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, revealedFutureDraws })),
          };
        },
      },
    },
  },
  saki: {
    id: "saki",
    name: "強気のヴィーナス・サキ",
    description: "必殺技「特技ドラ引き」: 必殺技ゲージが満タンになると、次に自分がツモる瞬間、自動的にその牌がドラ（赤ドラ含む）になる。",
    winQuote: "運も実力のうち？　いいえ、これは実力よ。持ってる女に、外れなんて無いの。",
    avatar: "/avatars/characters/saki.webp",
    cutin: "/avatars/characters/saki-cutin.webp",
    gaugeMax: SAKI_GAUGE_MAX,
    gaugePerTurn: 8,
    gaugePerDealIn: 20,
    skill: {
      id: "saki-dora-biki",
      name: "特技ドラ引き",
      description: "必殺技ゲージが満タンになると、次に自分がツモる瞬間に自動的に発動する。今数えられるドラ（表ドラと赤ドラ5m/5p/5sのいずれか）のうち山に残っている1枚を、実際にツモる前にすり替える。複数種類残っていてもどれが引けるかはランダムで、1枚も残っていなければ不発（ゲージは消費される）。",
      hooks: {
        // ナギ/ライコ/カエデ/コウキと違い、「今引いた牌を見てから選んで使う」
        // タイプの必殺技ではない（無条件でドラが手に入るだけなので、見てから
        // 判断する意味が無い）。そのためuseSkill/onActivateは持たず、
        // onBeforeDraw（gameEngine.tsのapplyDrawActionが実際のツモを引く
        // 直前に全プレイヤーのキャラクターへ呼ぶフック）でゲージ満タンかどうか
        // 自前で判定し、実際にツモる前の山の先頭牌をすり替える。これにより
        // 「関係ない牌を一旦引いてからドラに交換される」演出を挟まずに済む
        // （にゃん次郎の「アトミックリーチ」と同様、ゲージの消費判定・
        // リセットもここで自己完結させる）。
        onBeforeDraw: (ctx, drawer) => {
          const { round, owner } = ctx;
          if (drawer !== owner) return round; // 自分の自摸にのみ効果がある
          const p = round.players[owner]!;
          if (p.skillGauge < SAKI_GAUGE_MAX) return round;
          // 成功/不発を問わずこの時点でゲージは消費される。
          const players = updatePlayer(round, owner, (pl) => ({ ...pl, skillGauge: 0 }));
          const doraCodes = new Set(doraIndicators(round.wall).map(nextTileForDora));
          // 「赤も含めてランダムで引く」: 表ドラに該当する牌と赤ドラ(5m/5p/5s)の
          // どちらも対象に含める。山自体が対局開始時にシャッフル済みのため、
          // 「山の並び順で最初に見つかった対象牌」を引くだけで結果的にランダムな
          // 1枚を引くのと同じ（ナギ/ライコ/カエデと同じ考え方）。
          const wallIndex = round.wall.liveTiles.findIndex((t) => doraCodes.has(t.code) || t.isRed);
          if (wallIndex === -1) return { ...round, players }; // 不発
          const liveTiles = [...round.wall.liveTiles];
          const target = liveTiles[wallIndex]!;
          liveTiles[wallIndex] = liveTiles[0]!;
          liveTiles[0] = target;
          return { ...round, players, wall: { ...round.wall, liveTiles } };
        },
      },
    },
  },
  naoki: {
    id: "naoki",
    name: "卓上の暴君・ナオキ",
    description: "必殺技「クマクマタイム」: パッシブスキル。自分が和了して親のまま連荘すると自動的に発動し、次の局から配牌が良くなる。連荘が止まると元に戻る。",
    winQuote: "誰の卓だ？　俺の卓だ。親が続く限り、この場はずっと俺のものだ。",
    avatar: "/avatars/characters/naoki.webp",
    cutin: "/avatars/characters/naoki-cutin.webp",
    // パッシブ専用（onActivateが無い）ため、ゲージ関連の値は実質未使用
    // （SkillGauge.tsxがonActivateの無いキャラのバー自体を表示しない）。
    gaugeMax: 100,
    gaugePerTurn: 0,
    gaugePerDealIn: 0,
    skill: {
      id: "naoki-kuma-kuma-time",
      name: "クマクマタイム",
      description: "パッシブスキル。自分が和了して親のまま連荘し、次の局を迎えると自動的に発動し、その局の配牌がある程度強化される（できるだけ良い手からスタートできる）。和了以外の理由での連荘（流局によるものなど）では発動しない。親が変わると効果は元に戻る。",
      hooks: {
        // ゲージ・useSkillアクションを一切使わない完全パッシブ。実際の
        // 発動判定・効果はここ（配牌直後に呼ばれるonDealHand）で完結する。
        // 「自分の和了による連荘か」はround.honba単体では判別できない
        // （荒牌流局の親テンパイ継続や九種九牌流局でも本場は付く）ため、
        // 呼び出し側（gameStore.ts）が前局の結果種別まで見て計算した
        // round.dealerRenchanByWinを見る。onDealHandはmatchFormat.tsの
        // dealNewRoundから盤上の全プレイヤーのキャラクターに対して呼ばれる
        // ため、「自分が親かどうか」はここで明示的に判定する必要がある
        // （以前は「その局の親のキャラクターに対してのみ」呼ばれていたため
        // 不要だったが、他プレイヤーに対して呼ばれた時に誤発動しないよう
        // 追加した）。
        onDealHand: (ctx) => {
          const { round, owner } = ctx;
          if (owner !== round.dealerSeat) return round;
          if (!round.dealerRenchanByWin) return round;
          const p = round.players[owner]!;
          const { hand, wall } = draftExceptionalHand(p.hand, round.wall, NAOKI_DRAFT_ATTEMPTS);
          return {
            ...round,
            wall,
            players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })),
          };
        },
      },
    },
  },
  tomohiro: {
    id: "tomohiro",
    name: "ヤンチャな貴公子・トモヒロ",
    description: "必殺技「手牌が一枚しかない人」: パッシブスキル。手牌が4面子すべて鳴き終わって残り1枚（単騎待ち）の間、他の誰かがテンパイしていてもその当たり牌を引かせない。",
    winQuote: "たった1枚で待つ男に、隙なんて見せられるわけないだろ？",
    avatar: "/avatars/characters/tomohiro.webp",
    cutin: "/avatars/characters/tomohiro-cutin.webp",
    // パッシブ専用（onActivateが無い）ため、ゲージ関連の値は実質未使用
    // （SkillGauge.tsxがonActivateの無いキャラのバー自体を表示しない）。
    gaugeMax: 100,
    gaugePerTurn: 0,
    gaugePerDealIn: 0,
    skill: {
      id: "tomohiro-tefuda-ichimai",
      name: "手牌が一枚しかない人",
      description: "パッシブスキル。手牌が4面子すべて鳴き終わって残り1枚（単騎待ち）の間、常に効果を発揮する。他の誰かがテンパイしている時、その人が次に引くはずの牌が当たり牌であれば、山に残る別の安全な牌とすり替えて引かせない（山に安全な牌が残っていなければ不発）。自分自身のツモには影響しない。",
      hooks: {
        // 実際の入れ替えはgameEngine.tsのapplyDrawActionが実際のツモを
        // 引く直前、盤上の全キャラに対して呼ぶonBeforeDrawで行う。
        onBeforeDraw: (ctx, drawer) => {
          const { round, owner } = ctx;
          if (drawer === owner) return round; // 自分のツモには影響しない
          if (!isNakedTanki(round.players[owner]!.hand)) return round;
          const drawerHand = round.players[drawer]!.hand;
          if (calcShanten(drawerHand) !== 0) return round; // 他家が聴牌でなければ無関係
          const waits = new Set(getWaitingTiles(drawerHand));
          if (waits.size === 0) return round;
          const liveTiles = round.wall.liveTiles;
          const nextTile = liveTiles[0];
          if (!nextTile || !waits.has(nextTile.code)) return round; // 次のツモが当たり牌でなければ何もしない
          const safeIndex = liveTiles.findIndex((t, i) => i > 0 && !waits.has(t.code));
          if (safeIndex === -1) return round; // 山に当たり牌以外が残っていなければ不発
          const newLiveTiles = [...liveTiles];
          newLiveTiles[0] = liveTiles[safeIndex]!;
          newLiveTiles[safeIndex] = nextTile;
          // tomohiroGuardCountを増やし、SkillActivationOverlay.tsxが
          // その増分を検知して発動演出を出せるようにする（ゲージを使わない
          // パッシブのため、ゲージ低下検知の代わりにこのカウンタを使う）。
          return {
            ...round,
            wall: { ...round.wall, liveTiles: newLiveTiles },
            tomohiroGuardCount: round.tomohiroGuardCount + 1,
          };
        },
      },
    },
  },
  koki: {
    id: "koki",
    name: "気前の良い散財家・コウキ",
    description: "必殺技「太っ腹」: 発動した局の間、ドラ（赤ドラ含む）を切るたびに次のツモが必ず手の良くなる牌（テンパイ中なら和了牌）になる。局が終わるまで何度でも繰り返し使える。",
    winQuote: "ケチケチしても始まらない。パーッと捨てて、パーッと拾おうぜ。",
    avatar: "/avatars/characters/koki.webp",
    cutin: "/avatars/characters/koki-cutin.webp",
    // 発動後は局が終わるまで何度でも（ドラを切るたび）再発動する持続効果で
    // 単発の必殺技より価値が高いため、標準(10)より遅くする。
    gaugeMax: 100,
    gaugePerTurn: 7,
    gaugePerDealIn: 20,
    skill: {
      id: "koki-futoppara",
      name: "太っ腹",
      description: "発動すると、その局が終わるまで効果が続く。ドラ（表ドラ・赤ドラいずれも）を切るたびに、次の自分のツモが必ず手の良くなる牌（テンパイ中なら和了牌そのもの）になる（該当する牌が山に残っていなければ不発）。この効果は何度でも繰り返し使えるが、次の局には持ち越されない。",
      hooks: {
        canActivate: (ctx) => {
          const p = ctx.round.players[ctx.owner]!;
          return !p.futopparaPending;
        },
        onActivate: (ctx) => ({
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, futopparaPending: true })),
        }),
        // 「ドラを切ったら次のツモを保証する」の判定はここ（自分の打牌直後）で行う。
        // futopparaPendingは発動後その局中ずっとtrueのまま消費されない
        // （＝何度でもドラを切るたびguaranteedUsefulDrawが立つ）。
        // 実際の「次のツモを有効牌にすり替える」処理はonBeforeDraw側で行う。
        onAfterDiscard: (ctx, discarded) => {
          const { round, owner } = ctx;
          const p = round.players[owner]!;
          if (!p.futopparaPending) return round;
          const doraCodes = new Set(doraIndicators(round.wall).map(nextTileForDora));
          const isDora = doraCodes.has(discarded.code) || discarded.isRed === true;
          if (!isDora) return round; // ドラ以外を切っても効果に影響しない
          return {
            ...round,
            players: updatePlayer(round, owner, (pl) => ({ ...pl, guaranteedUsefulDraw: true })),
          };
        },
        onBeforeDraw: (ctx, drawer) => {
          const { round, owner } = ctx;
          if (drawer !== owner) return round; // 自分のツモにのみ効果がある
          const p = round.players[owner]!;
          if (!p.guaranteedUsefulDraw) return round;
          // 成功/不発を問わずこの権利はここで消費される。
          const players = updatePlayer(round, owner, (pl) => ({ ...pl, guaranteedUsefulDraw: false }));
          const currentShanten = calcShanten(p.hand);
          const liveTiles = round.wall.liveTiles;
          // テンパイ中はbestShantenAfterDiscardでは和了牌を検出できない
          // （13枚に戻す前提の関数のため、4面子+雀頭=14枚の完成形を
          // 「シャンテンが進んだ」とは判定できない）。そのためテンパイ中は
          // 待ち牌そのもの（getWaitingTiles）を有効牌として扱う。
          const isUseful = currentShanten === 0
            ? (() => { const waits = new Set(getWaitingTiles(p.hand)); return (t: Tile) => waits.has(t.code); })()
            : (t: Tile) => bestShantenAfterDiscard({ concealed: [...p.hand.concealed, t], melds: p.hand.melds }) < currentShanten;
          const usefulIndex = liveTiles.findIndex(isUseful);
          if (usefulIndex <= 0) return { ...round, players }; // 不発、または既に次が有効牌
          const newLiveTiles = [...liveTiles];
          newLiveTiles[0] = liveTiles[usefulIndex]!;
          newLiveTiles[usefulIndex] = liveTiles[0]!;
          return { ...round, players, wall: { ...round.wall, liveTiles: newLiveTiles } };
        },
      },
    },
  },
  takaharu: {
    id: "takaharu",
    name: "最速最強・タカハル",
    description: "必殺技「アトミックベタ降り」: 発動後、手牌の完成した面子（刻子や順子）を崩すたびに盾が立ち、盾がある間はロンされるはずの牌を切っても1度だけ無効化される。盾は局が終わるまで何度でも張り直せる。",
    winQuote: "最速も最強も、生き残ってこそだろ？降りる時はきっちり降りる、それだけの話だ。",
    avatar: "/avatars/characters/takaharu.webp",
    cutin: "/avatars/characters/takaharu-cutin.webp",
    // 局が終わるまで何度でも張り直せる持続的なロン無効化は単発の必殺技より
    // 価値が高いため、標準(10)より遅くする。
    gaugeMax: 100,
    gaugePerTurn: 8,
    gaugePerDealIn: 20,
    skill: {
      id: "takaharu-atomic-bettaori",
      name: "アトミックベタ降り",
      description: "発動すると、その局が終わるまで効果が続く。手牌の完成した面子（同じ牌3枚の刻子、または連続する3つの数牌の順子）を1枚切って崩すたびに盾が1つ立つ。盾がある間は、本来ロンされてしまう牌を切っても見逃してもらえる。盾はロンを実際に防いだ時だけ消費され、また別の面子を崩せば何度でも張り直せる。",
      hooks: {
        canActivate: (ctx) => !ctx.round.players[ctx.owner]!.bettaoriActive,
        onActivate: (ctx) => ({
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, bettaoriActive: true })),
        }),
        // 「メンツを崩したら盾が立つ」の判定はここ（自分の打牌直後）で行う。
        // 実際のロン無効化・盾の消費はgameEngine.tsのcanDeclareRon/
        // consumeBettaoriShieldIfItJustSavedで行う。
        onAfterDiscard: (ctx, discarded) => {
          const { round, owner } = ctx;
          const p = round.players[owner]!;
          if (!p.bettaoriActive) return round;
          // 打牌後の手牌に切った牌を1枚戻すと打牌前の状態になる。
          const preDiscardCodes = [...p.hand.concealed.map((t) => t.code), discarded.code];
          if (!breaksCompletedMeld(preDiscardCodes, discarded.code)) return round;
          return {
            ...round,
            players: updatePlayer(round, owner, (pl) => ({ ...pl, bettaoriShield: true })),
          };
        },
      },
    },
  },
  nyanjiro: {
    id: "nyanjiro",
    name: "怪鳥・にゃん次郎",
    description: "必殺技「アトミックリーチ」: ゲージが満タンの状態でリーチすると、自動的にアトミックリーチになる。発動した局は、他の3人がリーチできなくなる。",
    winQuote: "鳴くのはオレだけでいい。お前らの声は、もう聞こえなくなる。",
    avatar: "/avatars/characters/nyanjiro.webp",
    // 専用の縦長カットイン素材は未用意。cutin未指定時はavatarにフォールバックする
    // 仕様（MatchSetup.tsx/MatchVictoryOverlay.tsx/SkillActivationOverlay.tsxの
    // `character.cutin ?? character.avatar`参照）に委ねる。
    // 局が終わるまで他家3人全員のリーチを封じる強力な妨害効果のため、
    // 標準(10)より遅くする。
    gaugeMax: 100,
    gaugePerTurn: 7,
    gaugePerDealIn: 20,
    skill: {
      id: "nyanjiro-atomic-riichi",
      name: "アトミックリーチ",
      description: "必殺技ゲージが満タンの状態でリーチを宣言すると、自動的にアトミックリーチになる。成立した局は、以後その局が終わるまで他の3人が誰もリーチを宣言できなくなる。",
      hooks: {
        // useSkillアクションを介さず、ゲージ満タンでのリーチ宣言そのものが
        // トリガーになる（gameEngine.tsのapplyRiichiAction参照）。ここでは
        // 「アトミックリーチとして成立した」ことを表す状態変更だけを行う。
        onRiichi: (ctx) => ({
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, atomicRiichi: true })),
          riichiLockedBy: ctx.owner,
        }),
      },
    },
  },
  mebius: {
    id: "mebius",
    name: "表裏の配牌師・メビウス",
    // 「配牌師」は実在の職業名ではない造語で、「配牌」自体も一般的な
    // TTSの規則読みだと「はいはい」等に誤読されやすい（正しくは
    // 「はいぱい」）ため、読み上げ専用の読みを指定する。
    voiceName: "表裏のハイパイシ・メビウス",
    description: "必殺技「陰陽配牌」: パッシブスキル。親番でない局は配牌に面子（刻子や順子）が必ず1つ以上揃っている。その代わり、親番の局は逆に配牌が必ず面子0個のバラバラな形になる。",
    winQuote: "表があれば、裏がある。今のわたしは、ちゃんと表側。",
    avatar: "/avatars/characters/mebius.webp",
    // 専用の縦長カットイン素材は未用意。cutin未指定時はavatarにフォールバックする
    // 仕様（MatchSetup.tsx/MatchVictoryOverlay.tsx/SkillActivationOverlay.tsxの
    // `character.cutin ?? character.avatar`参照）に委ねる。
    // パッシブ専用（onActivateが無い）ため、ゲージ関連の値は実質未使用
    // （SkillGauge.tsxがonActivateの無いキャラのバー自体を表示しない）。
    gaugeMax: 100,
    gaugePerTurn: 0,
    gaugePerDealIn: 0,
    skill: {
      id: "mebius-inyou-haihai",
      name: "陰陽配牌",
      // 「陰陽」は「いんよう」「おんみょう」のどちらでも読まれうる上、
      // 「配牌」も一般的なTTSの規則読みだと「はいはい」等に誤読されやすい
      // （正しくは「はいぱい」）ため、読み上げ専用の読みを指定する。
      voiceName: "インヨウハイパイ",
      description: "パッシブスキル。配牌のたびに自動で発動する。親番でない局は、配牌に完成した面子（同じ牌3枚の刻子、または連続する3つの数牌の順子）が1つも無ければ、山の牌と入れ替えて必ず1つ以上揃える。逆に親番の局は、配牌に完成した面子があれば、無くなるまで山の牌と入れ替え、必ず面子0個のバラバラな配牌にする。",
      hooks: {
        // 「自分が親かどうか」で効果が正反対になる唯一のキャラ。onDealHandは
        // 盤上の全プレイヤーのキャラクターに対して呼ばれるため、ここで
        // ctx.owner===ctx.round.dealerSeatを見て分岐する（types.tsの
        // onDealHandの説明参照）。
        onDealHand: (ctx) => {
          const { round, owner } = ctx;
          const p = round.players[owner]!;
          const { hand, wall } =
            owner === round.dealerSeat
              ? ensureNoMelds(p.hand, round.wall, MEBIUS_BREAK_ATTEMPTS)
              : ensureAtLeastOneMeld(p.hand, round.wall);
          return { ...round, wall, players: updatePlayer(round, owner, (pl) => ({ ...pl, hand })) };
        },
      },
    },
  },
  zeno: {
    id: "zeno",
    name: "刻を止める者・ゼノ",
    // 「刻」をここでは「とき」と読ませたいが、一般的なTTSの規則読みだと
    // 「こく」（時刻・深刻等）に誤読されやすいため、読み上げ専用の読みを
    // 指定する。
    voiceName: "トキを止める者・ゼノ",
    description: "必殺技「時間停止」: 発動すると時間が止まり、自分だけが2巡連続で行動できる（他の3人は一切反応できない）。",
    winQuote: "止まった刻の中で足掻いたところで、何も変わりはしないさ。",
    avatar: "/avatars/characters/zeno.webp",
    // 専用の縦長カットイン素材は未用意。cutin未指定時はavatarにフォールバックする
    // 仕様（MatchSetup.tsx/MatchVictoryOverlay.tsx/SkillActivationOverlay.tsxの
    // `character.cutin ?? character.avatar`参照）に委ねる。
    gaugeMax: 100,
    gaugePerTurn: 8,
    gaugePerDealIn: 20,
    skill: {
      id: "zeno-jikan-teishi",
      name: "時間停止",
      description: "発動すると、自分が2回打牌するまで時間が止まる。この間、他の3人はロン・チー・ポン・カンなどで一切反応できない。1回目の打牌の後もそのまま自分の番が続き、2回連続でツモ・打牌ができる。",
      hooks: {
        // 既に発動中（timeStopTurnsRemaining>0）の間は再発動できないように
        // しておく（二重発動しても意味が無い）。
        canActivate: (ctx) => ctx.round.players[ctx.owner]!.timeStopTurnsRemaining === 0,
        // 実際の「応答ウィンドウを開かず自分の手番へ戻す」処理は
        // gameEngine.tsのresolveDiscardTurnTransitionが打牌解決のたびに
        // 行う。ここでは残り回数(2巡ぶん)をセットするだけ。
        onActivate: (ctx) => ({
          ...ctx.round,
          players: updatePlayer(ctx.round, ctx.owner, (pl) => ({ ...pl, timeStopTurnsRemaining: 2 })),
        }),
      },
    },
  },
  kagami: {
    id: "kagami",
    name: "百面の写し身・カガミ",
    // 「写し身」は「うつしみ」と読ませたいが、一般的なTTSの規則読みだと
    // 「うつしみ」自体は問題無いものの「百面」は「ひゃくめん」「ひゃくおもて」
    // のどちらでも読まれうるため、読み上げ専用の読みを指定する。
    voiceName: "ヒャクメンのウツシミ・カガミ",
    description: "必殺技「写し身」: 発動すると、直前に他の誰かが使った必殺技を自分に対してそのまま再現する（自分自身が直前に使った場合や、まだ誰も使っていない場合は不発）。",
    winQuote: "見せてもらった技は、もう私のもの。真似ることだって、立派な才能でしょう？",
    avatar: "/avatars/characters/kagami.webp",
    // 専用の縦長カットイン素材は未用意。cutin未指定時はavatarにフォールバックする
    // 仕様（MatchSetup.tsx/MatchVictoryOverlay.tsx/SkillActivationOverlay.tsxの
    // `character.cutin ?? character.avatar`参照）に委ねる。
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    skill: {
      id: "kagami-utsushimi",
      name: "写し身",
      voiceName: "ウツシミ",
      description: "発動すると、直前に他の誰かが使った必殺技を、自分に対してそのまま再現する。直前の発動が自分自身によるものだった場合や、まだ誰も必殺技を使っていない場合、コピー元の技に必要な条件（一発中のみ、など）を自分が満たしていない場合は発動できない。",
      hooks: {
        canActivate: (ctx) => canCopyLastSkill(ctx),
        onActivate: (ctx) => {
          const { round, owner } = ctx;
          const last = round.lastActivatedSkill;
          if (!last) return round;
          const copiedOnActivate = CHARACTERS[last.characterId]?.skill.hooks.onActivate;
          if (!copiedOnActivate) return round;
          const result = copiedOnActivate({ round, owner });
          // gameEngine.tsのapplyUseSkillActionは既定でlastActivatedSkillを
          // 「カガミ自身が発動した」として上書きしようとするため、ここで
          // 明示的にコピー元のキャラクターIDを保持した新しいオブジェクトを
          // セットしておく（同じ参照のままだと「未変更」とみなされ既定値で
          // 上書きされてしまう。gameEngine.tsのlastActivatedSkill算出参照）。
          // これにより「写し身」自体が連鎖してコピー先になることはなく、
          // 本来の効果が正しく次のコピーへ連鎖する。
          return { ...result, lastActivatedSkill: { owner, characterId: last.characterId } };
        },
      },
    },
  },
  karin: {
    id: "karin",
    name: "何でも屋・カリン",
    description: "必殺技「借り物競争」: 発動すると、他の3人のうち好きな1人を選び、その必殺技を代わりに発動できる。その代わりゲージの溜まりは他のキャラの半分とかなり遅い。",
    winQuote: "困った時はお互い様でしょ？ ちょっとその技、借りてくね！",
    avatar: "/avatars/characters/karin.webp",
    cutin: "/avatars/characters/karin-cutin.webp",
    // 通常キャラの半分（gaugePerTurn 10→5, gaugePerDealIn 20→10）。
    // 「同卓者の技を自由に選べる」という自由度の高さの代償として、
    // 発動できるようになるまでの回転率を大きく落としている。
    gaugeMax: 100,
    gaugePerTurn: 5,
    gaugePerDealIn: 10,
    borrowsSkill: true,
    skill: {
      id: "karin-karimono-kyousou",
      name: "借り物競争",
      description: "発動時、他の3人のうち1人を選び、その人の必殺技をそのまま自分に対して発動する。相手の技に必要な条件を満たしていない場合は選べない。パッシブ専用の技は借りられない。",
      // 実際の発動処理はborrowSkillアクション経由（gameEngine.tsの
      // canBorrowSkill/applyBorrowSkillAction）で行われ、karin自身は
      // onActivateを持たない（skills/types.tsのCharacter.borrowsSkill参照）。
      hooks: {},
    },
  },
  sena: {
    id: "sena",
    name: "石橋の番人・セナ",
    description: "必殺技「様子見」: 発動すると今引いた牌を山に戻し、打牌せずにそのまま次の人へ手番を渡す。安全に1巡やり過ごせる技で、弱い分ゲージの溜まりは早い。",
    winQuote: "危ない橋は渡らない。それだけで、案外生き残れるものでしょう？",
    avatar: "/avatars/characters/sena.webp",
    cutin: "/avatars/characters/sena-cutin.webp",
    // 効果が弱い（1巡やり過ごすだけで打点・進行には一切寄与しない）代わりに、
    // 打牌のたびのゲージ上昇を標準の倍にしている（gaugePerTurn 10→20）。
    // gaugePerDealInは標準の20のまま据え置き。
    gaugeMax: 100,
    gaugePerTurn: 20,
    gaugePerDealIn: 20,
    skill: {
      id: "sena-yousumi",
      name: "様子見",
      description: "発動すると、今引いた牌を山に戻し、打牌をせずにそのまま次の人へ手番を渡す。ロンされる心配も鳴かれる心配もない、安全に1巡やり過ごすための技。敵のリーチ等で安全牌が無い時に使うとよい。",
      hooks: {
        // チー/ポン/大明槓で手番だけ回ってきた直後（自分ではまだ何も自摸っていない）
        // は発動できない。hasOwnPendingDrawの説明コメント参照。
        canActivate: (ctx) => hasOwnPendingDraw(ctx.round, ctx.owner),
        onActivate: (ctx) => {
          const { round, owner } = ctx;
          const drawn = round.lastDrawnTile;
          if (!drawn) return round;
          const p = round.players[owner]!;
          const { hand: handWithoutDrawn } = removeTileFromHand(p.hand, drawn.id);
          const wall = { ...round.wall, liveTiles: [...round.wall.liveTiles, drawn] };
          const players = updatePlayer(round, owner, (pl) => ({ ...pl, hand: handWithoutDrawn }));
          // 打牌が一切発生しないため、lastDiscard/pendingCallWindowには触れず
          // （＝鳴き/ロンの対象になる捨て牌自体が存在しない）、直接次家の
          // 自摸フェーズへ手番を進める。
          return {
            ...round,
            players,
            wall,
            lastDrawnTile: null,
            phase: "awaiting-draw",
            currentTurn: nextSeat(owner),
          };
        },
      },
    },
  },
  mio: {
    id: "mio",
    name: "やり直し請負人・ミオ",
    description: "必殺技「取り返し」: 発動すると、自分の河（まだ誰にも鳴かれていない牌）から好きな1枚を選んで手牌に戻し、代わりに手牌の別の1枚をその場で切り直せる。過去に切って裏目った1枚を、今から切り直せる。",
    winQuote: "やり直しなんて、いくらでも利くのよ。過去の一手くらい、今から書き換えてあげる。",
    avatar: "/avatars/characters/mio.webp",
    cutin: "/avatars/characters/mio-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    retrievesDiscard: true,
    skill: {
      id: "mio-torikaeshi",
      name: "取り返し",
      description: "発動時、自分の河（まだ誰にも鳴かれていない牌）から1枚選んで手牌に戻し、代わりに手牌から選んだ別の1枚をその場で切り直せる。リーチ中は打牌を選べないため発動できない。",
      // 実際の発動処理はretrieveDiscardアクション経由（gameEngine.tsの
      // canRetrieveDiscard/applyRetrieveDiscardAction）で行われ、ミオ自身は
      // onActivateを持たない（skills/types.tsのCharacter.retrievesDiscard参照）。
      hooks: {},
    },
  },
};

export const CHARACTER_IDS: string[] = Object.keys(CHARACTERS);

export function randomCharacterIds(rng: () => number = Math.random): [string, string, string, string] {
  const pick = () => CHARACTER_IDS[Math.floor(rng() * CHARACTER_IDS.length)]!;
  return [pick(), pick(), pick(), pick()];
}
