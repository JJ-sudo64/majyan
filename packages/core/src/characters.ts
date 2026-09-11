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
    description: "必殺技「開花」: ドラ表示牌をもう1枚めくる。",
    winQuote: "花は散っても、想いは散りません。だから、また咲かせましょう…！",
    avatar: "/avatars/characters/hiiragi.webp",
    cutin: "/avatars/characters/hiiragi-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    skill: {
      id: "hiiragi-kaika",
      name: "開花",
      description: "ドラ表示牌をもう1枚めくる（カンドラと同じ仕組み）。",
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
    description: "必殺技「積み込み」: 今引いた牌を山に戻し、新しい牌を引き直す。",
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
      description: "今の自摸牌を山の下に戻し、新しい牌を引き直す。",
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
    description: "必殺技「一閃」: 一発中に、山に残る自分の待ち牌を強制的に引き寄せて一発ツモを狙う。",
    winQuote: "迷いは捨てろ。考えた瞬間、負けは始まる。オレの一撃は、雷鳴とともにすべてを終わらせる。",
    avatar: "/avatars/characters/raiko.webp",
    cutin: "/avatars/characters/raiko-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 12,
    gaugePerDealIn: 20,
    skill: {
      id: "raiko-issen",
      name: "一閃",
      voiceName: "イッセン",
      description: "一発中のみ発動可能。今の自摸牌を山の下に戻し、自分の待ち牌のうち山に残っている1枚を強制的に引き直す（山に残っていなければ不発）。",
      hooks: {
        // 一発（リーチ後、鳴きが入らず自分の番が一巡してくる前）の間しか使えない、
        // という制約自体をこのキャラの強さと引き換えの縛りにしている。
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
    description: "必殺技「嶺上顕現」: 次に聴牌中でカンをした瞬間、その嶺上ツモを待ち牌にすり替えて嶺上開花を確定させる。",
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
      description: "発動後、次に自分が聴牌中にカン（暗槓・加槓・大明槓のいずれか）をした瞬間、その嶺上ツモが山に残る自分の待ち牌にすり替わり嶺上開花が確定する（山に残っていなければ不発。聴牌でないカンでは権利は持ち越される）。",
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
    description: "必殺技「透視の術」: 発動すると1巡の間、他家3人の手牌が見えるようになる。",
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
      description: "発動した瞬間から、次に自分の番でツモするまでの1巡の間、他家3人の手牌がすべて見えるようになる。",
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
    description: "必殺技「運命の采配」: 発動した次の局の配牌直後、手牌のうち3枚を自由に山の新しい牌と交換できる。",
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
      description: "発動すると、次の局の配牌直後から自分が最初の1枚を打牌・副露するまでの間に限り、手牌のうち好きな3枚を（1枚ずつ）山の新しい牌と交換できる。",
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
    description: "必殺技「山読み」: 発動すると、その局が終わるまで待ち牌が実際に山へ何枚残っているかを正確に見抜けるようになる。",
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
      description: "発動すると、その局が終わるまで、待ち牌表示の残り枚数が「見えている牌からの推測」ではなく「実際に山（liveTiles）に残っている正確な枚数」になる。",
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
    description: "必殺技「手ほどき」: 発動すると、今の自摸牌を必ずシャンテンを進める有効牌にすり替える（聴牌中は発動不可）。",
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
      description: "発動すると、今の自摸牌を山の下に戻し、手牌のシャンテン数を必ず1つ以上進める牌を山から強制的に引き直す（該当する牌が山に残っていなければ不発）。聴牌中（あと1枚で和了の状態）は発動できない。",
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
    description: "必殺技「大明立直」: 必殺技ゲージが満タンの状態で立直を宣言すると、その立直が自動的にオープンリーチ（手牌を全員に公開）になる代わりに、和了時の翻数が3翻アップする。",
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
      description: "必殺技ゲージが満タンの状態で立直を宣言すると、useSkillボタンを介さずその立直が自動的にオープンリーチになる（手牌が全員に公開される。ゲージはその場で消費される）。その代わり、そのまま和了できれば「オープンリーチ」役として翻数が3翻アップする。",
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
    description: "必殺技「捲る運命」: 必殺技ゲージが満タンの状態で立直を宣言すると自動的に発動し、そのまま和了すれば裏ドラが必ず1つ以上乗る。",
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
      description: "必殺技ゲージが満タンの状態で立直を宣言すると、useSkillボタンを介さず自動的に発動する（ゲージはその場で消費される）。以後この局でこのプレイヤーが立直中に和了した瞬間、手牌（+和了牌）の中で最も多い牌が裏ドラとして必ず1枚以上乗るよう、山の裏ドラ表示牌を入れ替える（対象の牌が山に残っていない場合は不発）。",
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
    description: "必殺技「三色の煌めき」: 発動すると、三色同順に絡みそうな牌が5秒間光って見える。",
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
      description: "発動すると、現在の手牌の中で三色同順（同じ数字の順子を萬子・筒子・索子で1組ずつ揃える役）に最も絡んでいる牌が5秒間光って見える。局面や点数には一切影響しない、見た目だけの演出。",
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
    description: "必殺技「未来視」: 発動すると、自分がこれから自摸ってくる牌が3回ぶん見える。誰かが鳴いて手番の巡りがズレると、以降の予知は外れる。",
    winQuote: "見えていたもの、そのまま。……たまには外れてくれても面白いのにね。",
    avatar: "/avatars/characters/mirai.webp",
    cutin: "/avatars/characters/mirai-cutin.webp",
    gaugeMax: 100,
    gaugePerTurn: 10,
    gaugePerDealIn: 20,
    skill: {
      id: "mirai-miraishi",
      name: "未来視",
      description: "発動すると、通常のローテーション（誰も鳴かない前提）でこの後自分の番に自摸ってくるはずの牌を3回ぶん、あらかじめ見ることができる。発動はcanUseSkillの制約上必ず自分の手番（自摸直後）のため、次の自分の自摸は山の4番目・8番目・12番目の牌になる。誰かが鳴いて手番の巡りがズレた場合、その時点で予知は外れる（それ自体が仕様）。",
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
    description: "必殺技「特技ドラ引き」: 必殺技ゲージが満タンになると、次に自分がツモる瞬間、useSkillボタンを介さず自動的にその自摸がドラ（赤ドラ含む）になる。",
    winQuote: "運も実力のうち？　いいえ、これは実力よ。持ってる女に、外れなんて無いの。",
    avatar: "/avatars/characters/saki.webp",
    cutin: "/avatars/characters/saki-cutin.webp",
    gaugeMax: SAKI_GAUGE_MAX,
    gaugePerTurn: 8,
    gaugePerDealIn: 20,
    skill: {
      id: "saki-dora-biki",
      name: "特技ドラ引き",
      description: "必殺技ゲージが満タンになると、次に自分がツモる瞬間に自動的に発動する（無条件でドラが手に入る効果のため、狙って外れ牌を引く意味が無い＝ボタンで選んで使う必要が無い）。現在ドラとして数えられる牌（表示牌から求まるドラ、および赤ドラの5m/5p/5s）のいずれかを、実際にツモる前に山の先頭とすり替える。山に複数種類残っていてもどれが引けるかはランダム（山の並び順依存）で、該当する牌が1枚も残っていなければ不発（ゲージは消費される）。",
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
    description: "必殺技「クマクマタイム」: パッシブスキル。自分の親番で（自分の和了によって）連荘すると自動的に発動し、次の局から配牌が良くなる。連荘が止まると通常に戻る。",
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
      description: "パッシブスキル。自分がツモ/ロン和了して親のまま連荘し、次局を迎えると自動的に発動し、その局の配牌が山からの入れ替えである程度強化される（できる限りシャンテンを進めた状態からスタートする）。荒牌流局の親テンパイ継続や九種九牌流局による連荘（本場は付くが和了ではない）では発動しない。連荘が途切れて親が変わった時点で自動的に効果が切れ、通常の配牌に戻る。",
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
    description: "必殺技「手牌が一枚しかない人」: パッシブスキル。自分の手牌が4面子を副露し尽くした裸単騎になっている間、他家が聴牌していてもその当たり牌を引かせない。",
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
      description: "パッシブスキル。自分の手牌が4面子すべて副露済み・濃厚1枚（裸単騎）になっている間、常に効果を発揮する。他家の誰かが聴牌している状態でツモ番を迎えても、次に引くはずの牌がその他家の当たり牌（和了牌）であれば、山に残る当たり牌でない別の1枚と入れ替えて引かせない（当たり牌以外が山に残っていない場合は入れ替えられず不発）。自分自身のツモには影響しない。",
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
    description: "必殺技「太っ腹」: 発動した局の間、ドラ（赤ドラ含む）を切るたびその瞬間から次のツモが必ず有効牌（シャンテンを進める、またはテンパイなら和了牌）になる。この効果は消費されず、局が終わるまで何度でもドラを切るたび発動する。",
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
      description: "発動すると、その局が終わるまで「ドラ（表ドラ・赤ドラいずれも）を切った瞬間、次の自分のツモが必ず有効牌になる」効果がずっと有効になる。ドラを切るたびに、次に自分がツモった瞬間、山から手牌のシャンテン数を必ず1つ以上進める牌（テンパイ中なら和了牌そのもの）を強制的に引き寄せる（該当する牌が山に残っていなければ不発）。この効果自体は消費されず、局が終わるまで何度でもドラを切るたび繰り返し発動する（発動済みの間は再発動できない）。局をまたいでは持ち越さない。",
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
    description: "必殺技「アトミックベタ降り」: 発動後、手牌のメンツ（刻子または順子の3枚組）を1枚切って崩すたびに盾が立ち、その盾が立っている間にロンされるはずだった牌を切っても1度だけロンを無効化する。盾は局が終わるまで何度でも張り直せる。",
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
      description: "発動すると、その局が終わるまで「アトミックベタ降り」が有効になる（発動済みで未消費の間は再発動できない）。有効な間、手牌で既に完成しているメンツ（同じ牌3枚の刻子、または連続する3つの数牌の順子）から1枚切って崩すたびに盾が立つ。盾が立っている間は、本来なら他家にロンされてしまう牌を切ってもロンされない（フリテンとは別枠の無効化）。ただし盾は「実際にロンを防いだ瞬間」にのみ消費される（安全な牌を切っている間は温存される）。盾が消費された後も、また別のメンツを崩せば何度でも盾を張り直せる。",
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
    description: "必殺技「アトミックリーチ」: 必殺技ゲージが溜まった状態でリーチすると、そのリーチがアトミックリーチになる。アトミックリーチが発動した局は、他のプレイヤーはリーチができなくなる。",
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
      description: "必殺技ゲージが満タンの状態で立直を宣言すると、useSkillボタンを介さずその立直が自動的にアトミックリーチになる（ゲージはその場で消費される）。アトミックリーチが成立した局は、以後その局が終わるまで他家3人が誰もリーチを宣言できなくなる。",
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
    description: "必殺技「陰陽配牌」: パッシブスキル。親番でない局は配牌に必ず面子（刻子または順子）が1つ以上最初から揃っている。その代わり、自分が親番の局は逆に配牌が必ず面子0個の完全にバラバラな形になる。",
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
      description: "パッシブスキル。配牌のたびに自動的に効果を発揮する。自分が親番でない局は、配牌に完成した面子（同じ牌3枚の刻子、または連続する3つの数牌の順子）が1つも無ければ、山から調達できる面子を1つ手牌の適当な3枚と入れ替えて必ず1つ以上揃える（山にも該当する3枚が無ければ不発）。逆に自分が親番の局は、配牌に完成した面子が1つでもあれば、それが無くなるまで山の牌と入れ替え続け、必ず面子0個の完全にバラバラな配牌にする（安全な入れ替え先が見つからなければそこで諦める。極めて稀な不発）。",
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
    description: "必殺技「時間停止」: 発動すると時間が止まり、自分だけが2巡連続で行動できる（他家は打牌に一切反応できない）。",
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
      description: "発動すると、以後自分の打牌が2回解決されるまで時間が止まる。この間、他家はロン・チー・ポン・カン・槍槓を含め一切反応できない。1回目の打牌が解決された直後は次家に手番が渡らずそのまま自分がもう一度ツモり（＝2巡連続で行動できる）、2回目の打牌が解決された時点で通常通り次家へ手番が進む。",
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
    description: "必殺技「写し身」: 発動すると、同卓者が直近に発動した必殺技をそのまま自分に対して再現する（発動者が自分自身だった場合や、まだ誰も発動していない場合は不発）。",
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
      description: "発動すると、同卓者（自分以外）がuseSkillで直近に発動した必殺技（round.lastActivatedSkill）を、自分に対してそのまま再現する。直近の発動が自分自身によるものだった場合、まだ誰も必殺技を発動していない場合、またはコピー元の追加発動条件（一発中のみ等）を自分が満たしていない場合は発動自体ができない（ボタンが出ない）。",
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
    description: "必殺技「借り物競争」: 発動すると、同卓者3人のうち好きな1人を選び、その必殺技を代わりに発動できる（選んだ相手の追加発動条件も自分が満たしている必要がある）。その代わりゲージの溜まりは他のキャラの半分とかなり遅い。",
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
      description: "発動時、同卓者3人（自分以外）のうち必殺技を借りられる相手を選び、その必殺技をそのまま自分に対して発動する（選んだ相手の追加発動条件を満たしていない場合は選択肢に出ない。onActivateを持たないパッシブ専用キャラの技は借りられない）。",
      // 実際の発動処理はborrowSkillアクション経由（gameEngine.tsの
      // canBorrowSkill/applyBorrowSkillAction）で行われ、karin自身は
      // onActivateを持たない（skills/types.tsのCharacter.borrowsSkill参照）。
      hooks: {},
    },
  },
  sena: {
    id: "sena",
    name: "石橋の番人・セナ",
    description: "必殺技「様子見」: 発動すると今の自摸を山に戻し、打牌を一切行わずにそのまま次家に手番を渡す（自摸も打牌もしないため、その巡は安全に過ごせる）。弱い技のためゲージの溜まりは早い。",
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
      description: "発動すると、今の自摸牌を山の下に戻し、打牌を一切行わずにそのまま次家へ手番を渡す（自摸も打牌もしないため、ロン・鳴きのどちらのリスクも一切負わない）。敵のリーチ等で安全牌が無い時に、その1巡だけ安全に見送るための技。",
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
    description: "必殺技「取り返し」: 発動すると、自分の河（鳴かれていないもの限定）から好きな1枚を選んで手牌に戻し、代わりに手牌の別の1枚をその場で切り直す（実質的な打牌交換）。過去に切って裏目った1枚を、今から切り直せる。",
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
      description: "発動時、自分の河（他家に鳴かれていない牌限定）から1枚選んで手牌に戻し、代わりに手牌の中から選んだ別の1枚をその場で切り直す（打牌の交換。鳴き・ロンの応答ウィンドウは通常の打牌と同じく開く）。リーチ中は打牌を選べない（ツモ切り強制）ため発動できない。",
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
