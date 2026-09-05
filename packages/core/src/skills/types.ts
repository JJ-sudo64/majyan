/**
 * キャラクター必殺技システムのフック型定義。
 * 必殺技ゲージ（PlayerRoundState.skillGauge）が各キャラのgaugeMaxに達すると
 * 発動可能になり、プレイヤーの明示的な操作（useSkillアクション）でonActivateが
 * 呼ばれる。onBeforeDraw/onAfterDiscardはパッシブ効果用のフックで、
 * gameEngine.ts（applyDrawAction/applyDiscardAction）から呼び出される。
 * onScoreCalculationは将来の拡張口として残してあるが、まだ呼び出していない。
 */
import type { RoundState } from "../gameState.js";
import type { PlayerIndex } from "../actions.js";
import type { Tile } from "../tiles.js";

export interface SkillContext {
  round: RoundState;
  owner: PlayerIndex;
}

export interface SkillHooks {
  /** 誰かがツモする直前。gameEngine.applyDrawActionが実際にツモを引く直前、
      盤上の全プレイヤーのキャラクターに対して順に呼び出す（ctx.ownerがこの
      フックを持つキャラの持ち主、drawerが実際にツモするプレイヤー。
      owner !== drawerもありうる）。ツモ牌をすり替える等の効果に使う。
      効果が無ければctx.roundをそのまま返せばよい。
      （例: トモヒロの「手牌が一枚しかいない人」は自分が裸単騎の間、
      他家が聴牌中に引くはずの当たり牌を山の別の牌とすり替える。） */
  onBeforeDraw?: (ctx: SkillContext, drawer: PlayerIndex) => RoundState;
  /** 自分が打牌した直後。gameEngine.applyDiscardActionが打牌を手牌から
      取り除いた直後、打牌者自身のキャラクターに対してのみ呼び出す
      （他家の打牌には反応しない。ronの成否等は別処理）。discardedが
      実際に切られた牌そのもの（赤ドラ判定にisRedを使う）。
      効果が無ければctx.roundをそのまま返せばよい。
      （例: コウキの「太っ腹」は発動後にドラを切った瞬間、次のツモを
      保証する権利を立てる。） */
  onAfterDiscard?: (ctx: SkillContext, discarded: Tile) => RoundState;
  /** 点数計算の直前（未使用） */
  onScoreCalculation?: (ctx: SkillContext) => void;
  /** ゲージ満タンに加えて満たすべき追加の発動条件（例: 一発中のみ）。
      未指定なら追加条件なし（ゲージ満タンかつ自分の打牌前なら発動可能）。 */
  canActivate?: (ctx: SkillContext) => boolean;
  /** ゲージ満タン時にプレイヤーが必殺技を発動した瞬間。新しいRoundStateを返す。
      呼び出し側（gameEngine）がこの戻り値のplayers[owner].skillGaugeを0に
      リセットするため、ここでゲージを操作する必要はない。 */
  onActivate?: (ctx: SkillContext) => RoundState;
  /** 配牌直後（matchFormat.tsのdealNewRoundの終わり）。ゲージとは無関係に
      条件を満たせば自動的に効果を及ぼすパッシブ系キャラ専用のフック
      （例: ナオキの「クマクマタイム」、メビウスの「陰陽配牌」）。
      呼び出し側は盤上の全プレイヤーのキャラクターに対して順に呼び出す
      （ctx.ownerがこのフックを持つキャラの持ち主。「自分が親の時だけ」等の
      条件はフック側でctx.owner===ctx.round.dealerSeatを見て各自判定する。
      以前は「その局の親のキャラクターに対してのみ」呼んでいたが、メビウスの
      「親番かどうかで効果が反転する」ようなキャラを表現できないため、
      onBeforeDrawと同様に全員分呼ぶ形に一般化した）。条件を満たさない場合は
      ctx.roundをそのまま返せばよい。onActivateもonRiichiも無いキャラは
      UI側（SkillGauge.tsx）がゲージバー自体を表示しないため、ゲージ関連
      フィールド(gaugeMax等)は事実上使われない。 */
  onDealHand?: (ctx: SkillContext) => RoundState;
  /** useSkillアクションを介さず、必殺技ゲージが満タンの状態でリーチを宣言した
      瞬間に自動発動するフック（例: にゃん次郎の「アトミックリーチ」）。
      onActivateと違い予約フラグを経由せず、gameEngine.tsのapplyRiichiActionが
      「リーチ宣言時点でゲージが満タンだったか」を見て自動的に呼び出す
      （呼び出し側がplayers[owner].skillGaugeを0にリセットするため、ここで
      ゲージを操作する必要はない）。onActivateと共存しない前提。 */
  onRiichi?: (ctx: SkillContext) => RoundState;
}

export interface CharacterSkill {
  id: string;
  name: string;
  description: string;
  /** 音声読み上げ用の読み（ひらがな/カタカナ）。ブラウザの読み上げが誤読しやすい
      熟語（「嶺上」等）を含む技名の場合のみ指定する。未指定ならnameをそのまま読む。 */
  voiceName?: string;
  hooks: SkillHooks;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  /** 音声読み上げ用の読み（ひらがな/カタカナ）。ブラウザの読み上げが誤読しやすい
      熟語を含む名前の場合のみ指定する。未指定ならnameをそのまま読む。 */
  voiceName?: string;
  /** アバター画像のパス（public/配下）。ナメプレート等、小さい円形表示用。 */
  avatar: string;
  /** 必殺技発動演出（カットイン）用の縦長立ち絵。未指定ならavatarを代わりに使う。 */
  cutin?: string;
  /** 対局で1位（最終順位トップ）になった時に表示する勝利台詞。 */
  winQuote: string;
  /** ゲージの上限。これに達するとonActivateが発動可能になる。 */
  gaugeMax: number;
  /** 自分が打牌するたびに増えるゲージ量。 */
  gaugePerTurn: number;
  /** 自分が放銃した時に追加で増えるゲージ量（逆転要素）。 */
  gaugePerDealIn: number;
  /** カリン専用: 自身のonActivateを持たず、ゲージ満タン時に同卓者3人の
      うち好きな1人の必殺技を選んで代わりに発動する（borrowSkillアクション。
      gameEngine.tsのcanBorrowSkill/applyBorrowSkillAction参照）。このフラグを
      持つキャラはskill.hooks.onActivateが無くてもUI側（Hand.tsx）が
      通常の必殺技ボタンの代わりに相手選択UIを出す。 */
  borrowsSkill?: boolean;
  /** ミオ専用: 自身のonActivateを持たず、ゲージ満タン時に自分の河（鳴かれて
      いないもの限定）から1枚選んで手牌に戻し、代わりに手牌の別の1枚をその場で
      切り直す（retrieveDiscardアクション。gameEngine.tsのcanRetrieveDiscard/
      applyRetrieveDiscardAction参照）。このフラグを持つキャラはskill.hooks.
      onActivateが無くてもUI側（Hand.tsx/Table.tsx）が「取り返す河の1枚→
      代わりに切る手牌の1枚」の2段階選択UIを出す。 */
  retrievesDiscard?: boolean;
  skill: CharacterSkill;
}
