import type { Tile, TileCode, Wind } from "./tiles.js";
import type { Hand } from "./hand.js";
import type { WallState } from "./wall.js";
import type { PlayerIndex } from "./actions.js";

export type MatchFormat = "tonpuusen" | "hanchan";

export interface DiscardedTile {
  tile: Tile;
  /** 他家に鳴かれて手牌上から消えた場合 true（河には残すが見た目を薄くする等に使用） */
  calledAway: boolean;
  /** この牌がリーチ宣言牌かどうか（横向き表示用） */
  isRiichiDeclaration: boolean;
  /** ツモってきた牌をそのまま切った（ツモ切り）場合 true。手出しなら false */
  isTsumogiri: boolean;
}

export interface PlayerRoundState {
  hand: Hand;
  discards: DiscardedTile[];
  riichi: boolean;
  doubleRiichi: boolean;
  /** リーチ直後で一発可能な状態か（他家の鳴き/自分の次巡到達で false になる） */
  ippatsuActive: boolean;
  isTenpai: boolean; // 流局時のテンパイ判定用に都度更新
  /** キャラクターの必殺技ゲージ（0〜キャラごとのgaugeMax）。半荘/東風戦を通して持ち越す。 */
  skillGauge: number;
  /** トキの必殺技で予約された「次に聴牌中でカンしたら嶺上開花になる」権利。
      聴牌中にカンを行った瞬間に（成功/不発を問わず）消費される。 */
  guaranteedRinshan: boolean;
  /** ルナの必殺技で獲得した、配牌直後に使える牌の入れ替え権の残り回数(0〜3)。
      自分がまだ1枚も打牌・副露していない間だけ使え、局をまたいで持ち越さない
      （次局の配牌時にpendingTileSwapNextRoundを見て3にセットされる）。 */
  tileSwapsRemaining: number;
  /** 必殺技「運命の采配」の発動フラグ。RoundStateは局ごとに作り直されるため、
      次局の配牌（matchFormat.tsのdealNewRound）にこの値を明示的に橋渡しする
      （gameStore.tsのacknowledgeRoundEnd参照）。 */
  pendingTileSwapNextRound: boolean;
  /** オープンリーチとして立直を宣言したかどうか。必殺技「大明立直」がゲージ
      満タンの状態でのリーチ宣言時に自動的にtrueにする（useSkillを介さない。
      gameEngine.tsのapplyRiichiAction参照）。立直中は手牌が全員に公開され
      （UI側はOpponentArea.tsxがこのフラグを見て判定）、和了時に「オープン
      リーチ」役として+3翻される（yaku/index.ts参照）。 */
  openRiichi: boolean;
  /** 必殺技「捲る運命」の発動フラグ。立直中にこのプレイヤーが和了した瞬間、
      裏ドラ表示牌を手牌の中で最も多い牌に強制的に入れ替えて消費される
      （gameEngine.tsのapplyGuaranteedUraDoraForWinner参照）。 */
  guaranteedUraDora: boolean;
  /** 必殺技「未来視」で発動時に予知した、このプレイヤーが今後自摸ってくる
      であろう牌（山の並び順そのまま、通常のローテーション＝鳴きが一切
      発生しない前提で計算したスナップショット）。空配列なら予知なし。
      誰かが鳴いて手番の巡りがズレると以降の予知は外れるが、それは仕様
      （gameEngine.tsのapplyGuaranteedUraDoraForWinner同様のスナップショット式で、
      鳴きが起きても遡って再計算はしない）。 */
  revealedFutureDraws: TileCode[];
  /** 必殺技「太っ腹」の発動フラグ。発動後は局が終わるまでずっとtrueのまま
      （アトミックベタ降りのbettaoriActiveと同様、自然には切れず消費もされない）。
      この間、ドラ（赤含め）を切るたびguaranteedUsefulDrawが立つ
      （gameEngine.tsのapplyDiscardAction参照）。 */
  futopparaPending: boolean;
  /** 必殺技「太っ腹」でドラを切った直後に立つ、「次のツモが必ず有効牌になる」権利。
      次の自分のツモの瞬間に（成功/不発を問わず）消費されるが、futopparaPendingは
      消費されないため、また次にドラを切れば再び立つ
      （gameEngine.tsのapplyDrawAction経由で呼ばれるonBeforeDraw参照）。 */
  guaranteedUsefulDraw: boolean;
  /** 必殺技「アトミックベタ降り」の発動フラグ。発動後は局が終わるまでずっと
      trueのまま（自然には切れない）。この間、手牌の刻子（3枚組）を1枚切って
      崩すたびにbettaoriShieldが立つ（gameEngine.tsのapplyDiscardAction/
      applyRiichiActionから呼ばれるonAfterDiscard参照）。 */
  bettaoriActive: boolean;
  /** 「アトミックベタ降り」で刻子を崩した直後に立つ、「次に誰かにロンされる
      はずだった捨て牌を1度だけ無効化する」盾。安全な牌を切っている間は
      消費されず温存され、実際にロンを防いだ瞬間にのみ消費される
      （gameEngine.tsのconsumeBettaoriShieldIfItJustSaved参照）。 */
  bettaoriShield: boolean;
  /** アトミックリーチとして立直を宣言したかどうか。必殺技ゲージが満タンの
      状態で立直を宣言した瞬間、useSkillを介さず自動的にtrueになる
      （gameEngine.tsのapplyRiichiAction参照）。この立直が成立した局は
      RoundState.riichiLockedByがこのプレイヤーになり、他家は以後その局が
      終わるまでリーチを宣言できなくなる（gameEngine.tsのcanRiichi参照）。 */
  atomicRiichi: boolean;
  /** 必殺技「時を止める」で発動時に2にセットされる、残り「保護された打牌」の
      回数。0より大きい間、このプレイヤーの打牌に対しては他家が一切反応
      できない（ロン・チー・ポン・カン・槍槓のいずれも不可）。打牌が解決
      されるたびに1減り、減らした後もまだ0より大きければ手番はこのプレイヤー
      自身に戻る（＝2巡連続で行動できる）。0になった時点で通常通り次家へ
      手番が進む（gameEngine.tsのresolveDiscardTurnTransition参照）。 */
  timeStopTurnsRemaining: number;
}

export type TurnPhase =
  | "awaiting-draw"
  | "awaiting-discard"
  | "awaiting-calls"
  | "round-over";

export type DeclaredCallAction =
  | { type: "ron"; player: PlayerIndex }
  | { type: "pon"; player: PlayerIndex; usedHandTileIds: [string, string] }
  | { type: "minkan"; player: PlayerIndex; usedHandTileIds: [string, string, string] }
  | { type: "chi"; player: PlayerIndex; tileCodes: [import("./tiles.js").TileCode, import("./tiles.js").TileCode, import("./tiles.js").TileCode]; usedHandTileIds: [string, string] };

export interface PendingCallWindow {
  discarderIndex: PlayerIndex;
  discardTile: Tile;
  /** 加槓に対する槍槓チェックの場合 true（ロンのみ受け付ける） */
  isChankan: boolean;
  /** 応答が必要なプレイヤー一覧（捨て主/加槓者以外の3人） */
  awaitingPlayers: PlayerIndex[];
  /** 既に意思表示（鳴き宣言 or スキップ）したプレイヤー */
  respondedBy: PlayerIndex[];
  /** 鳴き/ロンを宣言した内容（スキップは含まない） */
  declaredCalls: DeclaredCallAction[];
}

export interface RoundEndResult {
  type: "tsumo" | "ron" | "exhaustive-draw" | "abortive-draw";
  winners: PlayerIndex[];
  loser?: PlayerIndex; // ロン時の放銃者
  tenpaiPlayers?: PlayerIndex[]; // 荒牌流局時のテンパイ者
  dealerContinues: boolean;
}

export interface RoundState {
  /** 対局形式（東風戦/半荘戦）。カード「最後の粘り」がオーラス（この対局形式の
      最終局）かどうかを判定するために持つ（matchFormat.tsのglobalRoundIndex/
      maxGlobalRoundIndex参照）。それ以外の用途では基本的に参照しない。 */
  format: MatchFormat;
  roundWind: Wind; // 1=東 2=南
  roundNumber: number; // 1-4
  honba: number;
  kyotaku: number;
  dealerSeat: PlayerIndex;
  players: [PlayerRoundState, PlayerRoundState, PlayerRoundState, PlayerRoundState];
  wall: WallState;
  currentTurn: PlayerIndex;
  phase: TurnPhase;
  lastDiscard: { player: PlayerIndex; tile: Tile } | null;
  lastDrawnTile: Tile | null;
  isRinshanTurn: boolean;
  pendingCallWindow: PendingCallWindow | null;
  kanCount: number;
  result: RoundEndResult | null;
  /** 各プレイヤーに割り当てられたキャラクターID（CHARACTERSのキー）。対局を通して固定。 */
  characterIds: [string, string, string, string];
  /** 九種九牌の判定用: これまでに鳴き/リーチが一度でも発生したか */
  anyCallOrRiichiMade: boolean;
  /** カゲロウの必殺技「透視の術」で、他家3人の手牌がこのプレイヤーから見えている間だけ
      そのプレイヤー番号が入る。発動した本人が次に自分の番でツモするタイミング
      （＝1巡した瞬間）にnullへ戻る（gameEngine.tsのapplyDrawAction参照）。 */
  handsRevealedTo: PlayerIndex | null;
  /** スバルの必殺技「山読み」で、待ち牌が実際に山（liveTiles）に何枚残っているかを
      正確に見られるようになっているプレイヤー番号。発動後はその局が終わるまで
      効果が持続する（次局の配牌でリセットされる）。 */
  wallReadRevealedTo: PlayerIndex | null;
  /** この局の親(dealerSeat)が、直前の局を「自分の和了（ツモ/ロン）によって」
      連荘して迎えたかどうか。本場が付く連荘には荒牌流局での親テンパイ継続や
      九種九牌流局（常に親継続）も含まれるが、それらとは区別するため専用の
      フラグにしている（matchFormat.tsのdealNewRound、gameStore.tsの
      acknowledgeRoundEnd参照）。ナオキの必殺技「クマクマタイム」のように
      「自分の親番で（和了による）連荘をした時」に限定して発動したいパッシブ
      系キャラの判定に使う。半荘/局をまたぐ持ち越しは不要で、配牌のたびに
      その場で再計算される。 */
  dealerRenchanByWin: boolean;
  /** 必殺技「アトミックリーチ」が発動した（アトミックリーチとして立直が
      成立した）プレイヤー番号。null以外の間、そのプレイヤー以外は
      canRiichiが常にfalseになり、この局が終わるまでリーチを宣言できない
      （gameEngine.tsのcanRiichi参照）。局をまたいでは持ち越さない
      （次局の配牌でnullにリセットされる）。 */
  riichiLockedBy: PlayerIndex | null;
  /** トモヒロの「手牌が一枚しかいない人」が、実際に他家の当たり牌をすり替えて
      防いだ回数（対局を通して単調増加、局をまたいでも0に戻さない）。ゲージを
      使わないパッシブ効果のため、他の必殺技のような「ゲージが満タン(>0)から
      0に戻った瞬間」検知が使えない。SkillActivationOverlay.tsx側がこの値の
      増分（前回描画時からの差分）を検知して発動演出を出すためだけに使う
      単発トリガーで、値そのものに意味は無い（gameEngine.tsのapplyDrawActionが
      呼ぶcharacters.tsのonBeforeDraw参照）。 */
  tomohiroGuardCount: number;
  /** 各座席が持っているカード（cards.tsのCARDSのキー）。null=カード無し。人間(0)は
      MatchSetupでの選択、CPU(1-3)は対局開始時にランダム抽選される。対局を通して固定
      （キャラクターと同様、半荘/東風戦をまたいでも変わらない。matchFormat.tsの
      dealNewRound参照）。 */
  cardIds: [string | null, string | null, string | null, string | null];
  /** 各座席の消費型カードの残り使用可能回数。対局開始時にCards.tsのCard.maxUses
      （未指定なら1）で初期化され、useCardアクションのたびに1減る。対局を
      通して持ち越す（次局でリセットしない。gameStore.tsのacknowledgeRoundEnd
      参照）。0になるとcanUseCardが常にfalseを返す（gameEngine.ts参照）。 */
  cardUsesRemaining: [number, number, number, number];
  /** カード「無効化」使用後に立つ、次にその座席以外が必殺技を使った瞬間に
      その効果を打ち消すフラグ（座席ごとに独立）。実際に無効化した瞬間にfalseへ
      戻る（gameEngine.tsのapplyUseSkillAction/applyRiichiAction参照）。
      cardUsesRemainingとは独立に、局をまたいで持ち越す。 */
  cardNegateArmed: [boolean, boolean, boolean, boolean];
  /** カード「小手先の一翻」「会心の二翻」使用後に立つ、この局でその座席が
      次に和了した時に加算される翻数（yaku/index.tsのWinContext.bonusHan参照）。
      局をまたいでは持ち越さない（次局の配牌で0にリセット。この局中に和了
      できなければ不発のまま消える）。 */
  cardBonusHan: [number, number, number, number];
  /** カード「裏ドラ倍加」使用後に立つ、この局でその座席が立直中に和了した時、
      裏ドラ表示牌をもう1枚（通常のuraDoraIndicatorsに追加で）めくるフラグ
      （gameEngine.tsのbuildWinContext参照）。局をまたいでは持ち越さない
      （次局の配牌で全座席falseにリセット。この局中に和了できなければ不発）。 */
  cardExtraUraDora: [boolean, boolean, boolean, boolean];
  /** カード「大逆転の目」使用後に立つ、この局でその座席が和了した時の最終得点
      （本場・供託を除く純粋な打点部分）を2倍にするフラグ（役満は対象外。
      gameEngine.tsのcomputeRoundScoreOutcome参照）。局をまたいでは持ち越さない
      （次局の配牌で全座席falseにリセット。この局中に和了できなければ不発）。 */
  cardScoreDoubled: [boolean, boolean, boolean, boolean];
  /** カード「点棒吸収」等、即座に点数を増減させたい効果が発生した時だけ
      セットされる一時的な差分（[p0,p1,p2,p3]、単位は点）。RoundStateは
      match.scoresを持たないため、gameStore.tsのapplyRoundUpdateがこれを
      検知してmatch.scoresへ反映し、適用後はnullに戻す。 */
  pendingScoreAdjustment: [number, number, number, number] | null;
  /** useSkillアクションで実際に効果を伴って発動した直近の必殺技（onRiichi経由の
      自動発動は含まない。gameEngine.tsのapplyUseSkillAction参照）。カガミの
      必殺技「写し身」が「同卓者が直近に発動した必殺技」を再現するために使う
      （characters.tsのkagami参照）。ownerは実際にその効果を受けた
      プレイヤー、characterIdは効果の出所となったキャラクター（カガミが
      コピーで発動した場合はカガミ自身のidではなく、コピー元のidを保持する
      ことで「コピーのコピー」でも本来の効果が正しく連鎖する）。局をまたいでは
      持ち越さない（次局の配牌でnullにリセット）。 */
  lastActivatedSkill: { owner: PlayerIndex; characterId: string } | null;
}

export interface MatchState {
  format: MatchFormat;
  scores: [number, number, number, number];
  round: RoundState;
  finished: boolean;
  finalRanking: PlayerIndex[] | null;
  /** 箱下続行ルール。falseの場合、誰かの持ち点が0点未満（箱割れ）になった時点で
      通常の局数を消化しきっていなくても即座に対局終了とする（デフォルト）。
      trueにすると箱割れを無視してそのまま最終局まで続行する。 */
  continueBelowZero: boolean;
}

export function seatWindOf(dealerSeat: PlayerIndex, player: PlayerIndex): Wind {
  return (((player - dealerSeat + 4) % 4) + 1) as Wind;
}
