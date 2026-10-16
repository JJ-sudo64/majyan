/**
 * チュートリアル。決まった配牌・決まった山の並びで2局を打たせ、手順を1つずつ案内する。
 * ここは中身（局面の作り方・案内の台本・操作の許可・CPUの動き）だけで、画面への出し方と
 * 進行はweb側（store/gameStore.ts・components/TutorialOverlay.tsx）が受け持つ。
 *
 * 山の並びを決めておくことで、誰が何を引き、何を捨てるかが毎回同じになる。CPUは引いた牌を
 * そのまま捨て（ツモ切り）、鳴きも和了もしない。人間の操作は台本が許した1手だけを通す。
 */
import type { GameAction, PlayerIndex } from "./actions.js";
import type { MatchState, RoundState } from "./gameState.js";
import { dealNewRound } from "./matchFormat.js";
import { pendingDecision } from "./matchController.js";
import { sortTiles, type Tile, type TileCode } from "./tiles.js";

const HUMAN = 0 as const;

/** 台本が人間に許す操作。 */
export type TutorialAllow =
  | { kind: "discard"; code: TileCode }
  | { kind: "riichi"; code: TileCode }
  | { kind: "pon" }
  | { kind: "ron" }
  | { kind: "tsumo" };

export interface TutorialStep {
  id: string;
  /** 画面に出す案内。 */
  text: string;
  /**
   * next: 「次へ」を押すまで対局を止める。
   * action: allowの操作をするまで待つ（それ以外の操作は通さない）。
   * result: 案内だけ出す（結果画面のボタンで次へ進む）。
   */
  advance: "next" | "action" | "result";
  /** この局面になったら案内を出す。 */
  when: (round: RoundState) => boolean;
  allow?: TutorialAllow;
  /** 光らせる手牌・ボタン。 */
  hintTile?: TileCode;
  hintButton?: "riichi" | "pon" | "ron" | "tsumo";
}

export interface TutorialScenario {
  id: string;
  build: () => MatchState;
  steps: TutorialStep[];
}

interface Layout {
  /** 4人の配牌13枚（座席0が人間）。 */
  hands: [TileCode[], TileCode[], TileCode[], TileCode[]];
  /** 山の先頭から引かれていく牌。誰が引くかは、鳴きがなければ座席0,1,2,3,0,…の順。 */
  draws: TileCode[];
  doraIndicator: TileCode;
  uraIndicator: TileCode;
}

/** 決めた配牌・山の並びのとおりの対局（東1局・人間が親）を作る。 */
function buildMatch(layout: Layout): MatchState {
  // 牌そのもの（ID）は、いったん普通に配った局から借りる。必要な牌を、コードごとに赤でないものから順に使う。
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const dealt = dealNewRound(1, 1, 0, 0, HUMAN, rng, ["", "", "", ""]);
  const all: Tile[] = [...dealt.players.flatMap((p) => p.hand.concealed), ...dealt.wall.liveTiles, ...dealt.wall.deadWall];
  const pool = new Map<TileCode, Tile[]>();
  for (const t of all) {
    const list = pool.get(t.code) ?? [];
    list.push(t);
    pool.set(t.code, list);
  }
  for (const list of pool.values()) list.sort((a, b) => Number(!!a.isRed) - Number(!!b.isRed));
  const take = (code: TileCode): Tile => {
    const tile = pool.get(code)?.shift();
    if (!tile) throw new Error(`チュートリアルの牌が足りません: ${code}`);
    return tile;
  };

  const hands = layout.hands.map((codes) => sortTiles(codes.map(take)));
  const draws = layout.draws.map(take);
  const dora = take(layout.doraIndicator);
  const ura = take(layout.uraIndicator);
  // 残りの牌は、王牌の残り12枚と、山の続き（使われない）に回す。
  const rest = [...pool.values()].flat();
  const deadFiller = rest.splice(0, 12);
  const deadWall: Tile[] = [...deadFiller.slice(0, 4), dora, ura, ...deadFiller.slice(4)];
  const players = dealt.players.map((p, i) => ({ ...p, hand: { concealed: hands[i]!, melds: [] } })) as unknown as RoundState["players"];
  const round: RoundState = {
    ...dealt,
    players,
    wall: { liveTiles: [...draws, ...rest], deadWall, revealedDoraCount: 1, rinshanDrawn: 0 },
    points: [25000, 25000, 25000, 25000],
  };
  return {
    format: "tonpuusen",
    scores: [25000, 25000, 25000, 25000],
    round,
    finished: false,
    finalRanking: null,
    startingDealer: HUMAN,
    continueBelowZero: false,
  };
}

const lastDrawnCode = (round: RoundState): TileCode | undefined => round.lastDrawnTile?.code;
const humanTurnToDiscard = (round: RoundState) => round.phase === "awaiting-discard" && round.currentTurn === HUMAN;
const humanToRespond = (round: RoundState) => {
  const d = pendingDecision(round);
  return d.kind === "call" && d.seat === HUMAN;
};
const calledTileCode = (round: RoundState): TileCode | undefined => round.pendingCallWindow?.discardTile.code;

/** 1局目: 打牌・立直・ツモ和了。 */
const RIICHI_SCENARIO: TutorialScenario = {
  id: "riichi",
  build: () =>
    buildMatch({
      hands: [
        // 234萬・456筒・678索の3組と、33筒・9萬・北。9萬を引けばテンパイ（3筒・9萬待ち）。
        ["2m", "3m", "4m", "4p", "5p", "6p", "6s", "7s", "8s", "3p", "3p", "9m", "4z"],
        ["1m", "4m", "7m", "1p", "8p", "2s", "5s", "9s", "1z", "2z", "3z", "6z", "7z"],
        ["2m", "5m", "8m", "2p", "7p", "1s", "4s", "9s", "1z", "2z", "3z", "6z", "7z"],
        ["3m", "6m", "9m", "1p", "9p", "3s", "5s", "8s", "1z", "2z", "3z", "6z", "7z"],
      ],
      // 0:自分=白 1,2,3:CPU 4:自分=9萬 5,6,7:CPU 8:自分=3筒（ツモ和了）
      draws: ["5z", "4s", "7s", "6m", "9m", "8m", "3s", "1m", "3p"],
      doraIndicator: "9s",
      uraIndicator: "9p",
    }),
  steps: [
    {
      id: "riichi-welcome",
      advance: "next",
      text: "麻雀のチュートリアルです。実際の画面で、牌を捨てて、あがるまでを体験します。画面の下が、あなたの手牌（13枚）です。",
      when: (round) => round.phase === "awaiting-draw" && round.players[HUMAN].discards.length === 0,
    },
    {
      id: "riichi-goal",
      advance: "next",
      text: "麻雀は、牌を1枚引いて（ツモ）、1枚捨てる（打牌）をくり返し、手牌を「あがりの形」にそろえるゲームです。あなたの手牌は、あと少しで完成です。",
      when: (round) => round.phase === "awaiting-draw" && round.players[HUMAN].discards.length === 0,
    },
    {
      id: "riichi-discard",
      advance: "action",
      allow: { kind: "discard", code: "5z" },
      hintTile: "5z",
      text: "牌を1枚引きました（右端の牌）。使えそうにない「白」をクリックして捨てましょう。",
      when: (round) => humanTurnToDiscard(round) && lastDrawnCode(round) === "5z",
    },
    {
      id: "riichi-declare",
      advance: "action",
      allow: { kind: "riichi", code: "4z" },
      hintTile: "4z",
      hintButton: "riichi",
      text: "9萬を引いて、あと1枚で完成する形（テンパイ）になりました。待ちは3筒と9萬です。「リーチ」を押してから、「北」を捨てましょう。",
      when: (round) => humanTurnToDiscard(round) && lastDrawnCode(round) === "9m" && !round.players[HUMAN].riichi,
    },
    {
      id: "riichi-explain",
      advance: "next",
      text: "リーチをすると、点数が上がる代わりに手牌を変えられなくなります。あとは、待ちの牌が来るのを待つだけです。引いた牌が当たりでなければ、自動で捨てられます。",
      when: (round) => round.players[HUMAN].riichi,
    },
    {
      id: "riichi-tsumo",
      advance: "action",
      allow: { kind: "tsumo" },
      hintButton: "tsumo",
      text: "3筒を引きました。待っていた牌です！ 「ツモ」を押して、あがりましょう。",
      when: (round) => humanTurnToDiscard(round) && round.players[HUMAN].riichi && lastDrawnCode(round) === "3p",
    },
    {
      id: "riichi-result",
      advance: "result",
      text: "あがりました！ 役は「立直」「一発」「門前清自摸和」など。役の一覧と点数の早見表は、タイトルの「ルール」や、オンラインの「その他」→「遊び方・役一覧」から見られます。",
      when: (round) => round.phase === "round-over",
    },
  ],
};

/** 2局目: ポン・ロン和了。 */
const PON_SCENARIO: TutorialScenario = {
  id: "pon",
  build: () =>
    buildMatch({
      hands: [
        // 234萬・456筒・67索・55萬・中中・北。中をポンして北を捨てると、5索・8索待ちのテンパイ。
        ["2m", "3m", "4m", "4p", "5p", "6p", "6s", "7s", "5m", "5m", "7z", "7z", "4z"],
        ["1m", "4m", "7m", "1p", "8p", "2s", "9s", "2z", "3z", "5z", "6z", "9m", "9p"],
        ["8m", "3p", "2p", "7p", "1s", "4s", "9s", "2z", "3z", "5z", "6z", "9m", "9p"],
        ["3m", "6m", "1p", "9p", "3s", "4s", "9s", "2z", "3z", "5z", "6z", "7m", "8p"],
      ],
      // 0:自分=東 1,2:CPU 3:上家=中（これをポン） 4:CPU 5:CPU=8索（これでロン）
      draws: ["1z", "9p", "1s", "7z", "6m", "8s"],
      doraIndicator: "2s",
      uraIndicator: "6z",
    }),
  steps: [
    {
      id: "pon-welcome",
      advance: "next",
      text: "2局目です。今度は「鳴き」を体験します。他の人が捨てた牌をもらって、組を作ることができます。",
      when: (round) => round.phase === "awaiting-draw" && round.players[HUMAN].discards.length === 0,
    },
    {
      id: "pon-discard",
      advance: "action",
      allow: { kind: "discard", code: "1z" },
      hintTile: "1z",
      text: "引いた「東」は使えません。捨てましょう。",
      when: (round) => humanTurnToDiscard(round) && lastDrawnCode(round) === "1z",
    },
    {
      id: "pon-call",
      advance: "action",
      allow: { kind: "pon" },
      hintButton: "pon",
      text: "他の人が「中」を捨てました。あなたは中を2枚持っているので、「ポン」でもらって、3枚の組にできます。押してみましょう。",
      when: (round) => humanToRespond(round) && calledTileCode(round) === "7z",
    },
    {
      id: "pon-discard2",
      advance: "action",
      allow: { kind: "discard", code: "4z" },
      hintTile: "4z",
      text: "鳴いたあとは、1枚捨てます。「北」を捨てると、5索か8索で完成するテンパイになります。鳴いた組は手牌の右に見せて置かれます。",
      when: (round) => humanTurnToDiscard(round) && round.players[HUMAN].hand.melds.length === 1,
    },
    {
      id: "pon-ron",
      advance: "action",
      allow: { kind: "ron" },
      hintButton: "ron",
      text: "「8索」が捨てられました。あなたの待ちです！ 他の人が捨てた牌であがることを「ロン」と言います。押しましょう。",
      when: (round) => humanToRespond(round) && calledTileCode(round) === "8s",
    },
    {
      id: "pon-result",
      advance: "result",
      text: "ロンであがりました！ 鳴いても、役（ここでは「役牌：中」）があればあがれます。以上でチュートリアルは終わりです。",
      when: (round) => round.phase === "round-over",
    },
  ],
};

export const TUTORIAL_SCENARIOS: TutorialScenario[] = [RIICHI_SCENARIO, PON_SCENARIO];

/** 人間の操作が、台本の許した操作か。 */
export function tutorialAllows(allow: TutorialAllow | undefined, action: GameAction, round: RoundState): boolean {
  if (!allow) return false;
  const codeOf = (tileId: string): TileCode | undefined =>
    round.players[HUMAN].hand.concealed.find((t) => t.id === tileId)?.code ?? (round.lastDrawnTile?.id === tileId ? round.lastDrawnTile.code : undefined);
  switch (allow.kind) {
    case "discard":
      return action.type === "discard" && codeOf(action.tileId) === allow.code;
    case "riichi":
      return action.type === "riichi" && codeOf(action.tileId) === allow.code;
    case "pon":
      return action.type === "pon";
    case "ron":
      return action.type === "ron";
    case "tsumo":
      return action.type === "tsumo";
  }
}

/** チュートリアル中のCPUの動き: 引いた牌をそのまま捨て、鳴きもロンもしない。 */
export function tutorialCpuAction(round: RoundState, seat: PlayerIndex): GameAction {
  const d = pendingDecision(round);
  if (d.kind === "turn") {
    const drawn = round.lastDrawnTile;
    if (!drawn) throw new Error("チュートリアルのCPUが捨てる牌がありません");
    return { type: "discard", player: seat, tileId: drawn.id, tsumogiri: true };
  }
  return { type: "skip", player: seat };
}
