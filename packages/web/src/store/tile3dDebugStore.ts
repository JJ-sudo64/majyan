import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Tile3D（上家・下家の手牌に使っている立体牌）の角度・拡大率・厚み・
 * 並べ方を、実際にゲーム画面を見ながら自分で調整できるようにするための
 * 一時的なデバッグ用ストア。プロトタイプ(Artifact)のスライダー（角度・
 * 拡大率・厚みに加え、2枚重ね配置の実験＝縦横位置・手前奥・プリセット）
 * と同じ役割を、実機の画面上で果たす。値はOpponentArea.tsx側でTile3Dへ
 * そのまま渡す。
 *
 * 下家(shimocha, player1)用と上家(kamicha, player3)用は、ユーザーの
 * 要望により完全に独立したパラメータセットとして持つ（片方だけ調整
 * したい時に他方へ影響しないように）。フィールド名は接頭辞なし=下家、
 * kamicha接頭辞=上家。オブジェクトのネスト構造ではなくフラットな
 * フィールドにしているのは、既存の下家用データ構造・保存済みlocalStorage
 * を一切変更せずに上家用を追加できるようにするため（後述のルール参照）。
 *
 * localStorageに永続化している（persistミドルウェア）。このファイル自体を
 * 編集するとViteのHMRでストアのモジュールが再実行されるが、永続化前は
 * それによってパネルでのライブ調整値が問答無用でコード上の初期値へ巻き
 * 戻ってしまう事故が2度起きたため追加した。永続化後は、HMRでの再実行時も
 * localStorageから値を読み直すので、このファイルの初期値を書き換えても
 * 既にブラウザに保存された値までは上書きされない。
 *
 * ★このファイルを今後編集する時の絶対ルール★
 * ・新しいフィールドを「追加」するだけなら version は上げなくてよい
 *   （zustand/persistの既定mergeは {...初期値, ...保存済みの値} なので、
 *   保存済みデータに無い新フィールドは自動的にコード上の初期値になり、
 *   既存フィールドの保存済み値は一切変更されない）。
 * ・既存フィールドの「初期値そのもの」を変える必要がある場合（今回の
 *   whiteWidthのように、以前の初期値が誤りだったと分かった時など）は、
 *   必ず version を1つ上げ、migrate関数でそのフィールドだけを明示的に
 *   補正すること。他のフィールドはmigrate内で絶対に触らない
 *   （`{ ...persisted, 対象フィールドだけ: 新値 }` の形にする）。
 * ・上記を徹底すれば、ユーザーが実機パネルで調整した値が私の編集で
 *   勝手にリセットされることはない——過去に一度、devサーバーのポート
 *   衝突でlocalStorageごと切り替わってしまい「初期値に戻った」ように
 *   見える事故が起きた（project-tile3d-prototypeメモ参照）。ユーザーは
 *   これを非常に嫌うため、原則としてこのファイルへの変更は「新規追加」
 *   のみに留め、既存フィールドの値・意味は変えない。
 * ・唯一の例外がv4→v6(2026-09-22、経緯はv6のmigrateコメント参照)：localStorageはブラウザごとに別々な
 *   ため、実機調整をほぼEdgeでしか行っていなかったことで、Chrome等
 *   他ブラウザには「調整途中で放置された古い値」が残っていた
 *   （＝配置がブラウザごとに違って見える不具合）。ユーザーから明示的に
 *   「全ブラウザで統一した見た目にしてほしい」と要望されたため、この
 *   1回に限りEdgeの確定値を全フィールド・全ブラウザへ強制的に再適用
 *   した。以後は通常どおり、個別フィールドの穴埋め以外で保存値を
 *   上書きしない。
 *
 * 開発中の調整用なので、値が決まったら packages/web/src/components/
 * OpponentArea.tsx 側の既定値を直接書き換え、このストア・パネルごと
 * 削除してよい。
 */
/** 副露1つぶんの個別配置。副露が伸びる自然な並び位置(flexレイアウト)を
    基準(0,0,0)として、そこからのズレをユーザーが直接指定する。 */
export interface MeldSlotConfig {
  offsetX: number;
  offsetY: number;
  rotate: number;
}

/** 副露は最大4つ（4組の刻子/順子+雀頭1組が上限のルール上、鳴きは最大4つ）。 */
export const MELD_SLOT_COUNT = 4;

/** 手牌の列全体（Tile3D）の位置・角度。「鳴いた副露の数」ごとに完全に
    独立した値を持つ——手牌は副露のたびに短くなり、その都度自動計算
    (sync())で位置が変わるが、「鳴いていない/1副露/2副露/3副露/4副露」の
    各状態でユーザーが直接ドラッグして決めた位置に絶対固定したいという
    要望のため。 */
export type HandGroupSlotConfig = MeldSlotConfig;
const DEFAULT_HAND_GROUP_SLOT: HandGroupSlotConfig = { offsetX: 0, offsetY: 0, rotate: 0 };
/** 副露0個(鳴いていない)〜4個の5状態。 */
export const HAND_GROUP_SLOT_COUNT = 5;

/** 河・ネームプレート・リーチ棒の座席ごとの位置調整（RiverEditToolbar/
    NameplateEditToolbar/RiichiStickEditToolbar.tsx参照）。副露/手牌と違い
    4人全員(自分含む)が対象で、鳴き数などの状態分岐も無いため座席ごとに
    1つの値のみ持つ。形は同じなのでMeldSlotConfigをそのまま流用する。 */
export type SeatSlotConfig = MeldSlotConfig;
/** 座席は自分(0)・下家(1)・対面(2)・上家(3)の4人固定。 */
export const SEAT_SLOT_COUNT = 4;

/** 河の座席ごとの位置・角度に加え、河の牌自体の拡大率を持つ
    （RiverEditToolbar.tsx参照）。offsetX/offsetY/rotateはSeatSlotConfigと
    全く同じ意味・既定値のため継承し、scaleだけ追加する。 */
export interface RiverSlotConfig extends SeatSlotConfig {
  /** 河の牌1枚あたりの拡大率(倍率、1で等倍)。 */
  scale: number;
}

/** 対面(player2)の手牌・副露の位置・大きさ調整（ToimenEditToolbar.tsx参照）。
    下家/上家と違いTile3D非表示（常に通常の2D牌）で、鳴き数ごとの状態分岐や
    副露スロット単位の個別配置も無いため、手牌全体・副露全体それぞれに
    1つの値（横/縦オフセット+拡大率）だけを持つ、より単純な形にする。 */
export interface ToimenSlotConfig {
  offsetX: number;
  offsetY: number;
  scale: number;
}

/**
 * ===== 実機で詰めた「確定レイアウト」の既定値 =====
 *
 * ここから下のINITIAL_*は、ユーザーが実機(Edge)の調整パネルで詰めて
 * localStorageに入っていた値を、そのままソース側の初期値として固定した
 * もの（2026-09-22時点のスナップショット）。これまでは初期値が全部0/等倍で、
 * 実際の見た目はブラウザのlocalStorageにしか存在しない＝別のブラウザや
 * データを消した環境では「素の崩れたレイアウト」になっていた。それを
 * 解消するのが目的。
 *
 * リセットボタンの戻し先も「中立の0」ではなく「この確定レイアウト」が
 * 期待値なので、reset系はINITIAL_*を参照する。唯一残したDEFAULT_HAND_GROUP_SLOT
 * (全部0の中立値)はmigrateのv2→v3変換専用で、過去データの解釈を変えない
 * ために意味を変えずそのまま残すこと。
 *
 * ★persistのversionは上げていない★
 * 既存フィールドの初期値は変わるが、狙いは「まだ保存データが無い環境に
 * 正しい見た目を出すこと」であって、既に調整済みのlocalStorageを書き換える
 * ことではない。versionを上げてmigrateで上書きすると、ユーザーがこの
 * スナップショット後に動かした調整まで巻き戻してしまう（過去に非常に
 * 嫌われた事故）。保存済み環境は今まで通り自分の値を使い続ける。
 */
/** 下家の副露4スロット（配列index=副露の順番）。 */
const INITIAL_MELD_SLOTS: MeldSlotConfig[] = [
  { offsetX: 703, offsetY: -101, rotate: -12 },
  { offsetX: 557, offsetY: -77, rotate: -12 },
  { offsetX: 416, offsetY: -53, rotate: -11 },
  { offsetX: 274, offsetY: -31, rotate: -12 },
];
/** 下家の手牌列、副露0〜4個の各状態。 */
const INITIAL_HAND_GROUP_SLOTS: HandGroupSlotConfig[] = [
  { offsetX: 30, offsetY: 39, rotate: -3 },
  { offsetX: 37, offsetY: 64, rotate: -3 },
  { offsetX: 43, offsetY: 91, rotate: -3 },
  { offsetX: 52, offsetY: 116, rotate: -3 },
  { offsetX: 61, offsetY: 146, rotate: -3 },
];
/** 上家の副露4スロット。 */
const INITIAL_KAMICHA_MELD_SLOTS: MeldSlotConfig[] = [
  { offsetX: -70, offsetY: 59, rotate: 15 },
  { offsetX: -152, offsetY: 30, rotate: 14 },
  { offsetX: -231, offsetY: 2, rotate: 15 },
  { offsetX: -303, offsetY: -25, rotate: 15 },
];
/** 上家の手牌列、副露0〜4個の各状態。 */
const INITIAL_KAMICHA_HAND_GROUP_SLOTS: HandGroupSlotConfig[] = [
  { offsetX: -18, offsetY: -91, rotate: 19 },
  { offsetX: -9, offsetY: -79, rotate: 19 },
  { offsetX: -3, offsetY: -71, rotate: 19 },
  { offsetX: 7, offsetY: -64, rotate: 19 },
  { offsetX: 24, offsetY: -63, rotate: 19 },
];
/** 河、座席順(自分/下家/対面/上家)。対面だけ牌を少し小さくしている。 */
const INITIAL_RIVER_SLOTS: RiverSlotConfig[] = [
  { offsetX: 4, offsetY: -2, rotate: 0, scale: 1 },
  { offsetX: -16, offsetY: -13, rotate: -2, scale: 1 },
  { offsetX: -4, offsetY: -1, rotate: 0, scale: 0.9 },
  { offsetX: 21, offsetY: 12, rotate: 1, scale: 1 },
];
/** リーチ棒、座席順。 */
const INITIAL_RIICHI_STICK_SLOTS: SeatSlotConfig[] = [
  { offsetX: -1, offsetY: 4, rotate: 0 },
  { offsetX: 12, offsetY: -3, rotate: 0 },
  { offsetX: 0, offsetY: -9, rotate: 0 },
  { offsetX: -10, offsetY: -5, rotate: 0 },
];
/** ネームプレート、座席順。対面だけ左に寄せている。 */
const INITIAL_NAMEPLATE_SLOTS: SeatSlotConfig[] = [
  { offsetX: 0, offsetY: 0, rotate: 0 },
  { offsetX: 0, offsetY: 0, rotate: 0 },
  { offsetX: -81, offsetY: 5, rotate: 0 },
  { offsetX: 0, offsetY: 0, rotate: 0 },
];
/** 対面の手牌全体。 */
const INITIAL_TOIMEN_HAND_SLOT: ToimenSlotConfig = { offsetX: -62, offsetY: 3, scale: 0.9 };
/** 対面の副露全体。 */
const INITIAL_TOIMEN_MELD_SLOT: ToimenSlotConfig = { offsetX: -7, offsetY: -16, scale: 0.85 };
/** 下家の牌形状・並べ方パラメータ(配列以外のスカラー値)。初期状態と
    v4→v6 migrate(下の「全ブラウザ統一」処理参照)の両方から参照する
    ので、値をここに集約して二重管理を避ける。 */
const INITIAL_SCALARS = {
  rx: 134,
  ry: 83,
  scale: 1.5,
  thickness: 13,
  whiteWidth: 10.6,
  aspectX: 1.2,
  aspectY: 0.95,
  spacing: -45,
  fanOffsetX: 4,
  frontIsLast: true,
  drawnOffsetX: -24,
  drawnOffsetY: 24,
} as const;
/** 上家の牌形状・並べ方パラメータ(配列以外のスカラー値)。同上の理由で集約。 */
const INITIAL_KAMICHA_SCALARS = {
  kamichaRx: 51,
  kamichaRy: -102,
  kamichaScale: 1.2,
  kamichaThickness: 16,
  kamichaWhiteWidth: 11.6,
  kamichaAspectX: 1.15,
  kamichaAspectY: 1,
  kamichaSpacing: -30,
  kamichaFanOffsetX: 0,
  kamichaFrontIsLast: true,
  kamichaDrawnOffsetX: -4,
  kamichaDrawnOffsetY: 1,
  kamichaShrinkReversed: false,
} as const;

export interface Tile3DDebugState {
  // ===== 下家(shimocha, player1)用 =====
  rx: number;
  ry: number;
  scale: number;
  thickness: number;
  /** 側面の白いハイライト部分の幅(px、固定値)。厚み(thickness)に対する
      割合ではなく固定pxにしているので、厚みを絞っても白い部分は変わらず、
      グリーンの取り分だけが優先的に減っていく——「緑の部分だけ薄くしたい」
      という要望に対応するためのもの。 */
  whiteWidth: number;
  /** 牌本体の横幅の倍率(基準32pxに掛ける)。1で等倍。 */
  aspectX: number;
  /** 牌本体の縦幅の倍率(基準43pxに掛ける)。1で等倍。 */
  aspectY: number;
  /** 縦に並ぶ牌同士の間隔(px)。負の値で重なる。プロトタイプの2枚重ね
      配置実験の「縦位置」を、縦一列の全牌に一律適用したもの。 */
  spacing: number;
  /** 1枚進むごとに横にずらす量(px)。プロトタイプの「横位置」に相当し、
      斜めに扇状へ広げる演出に使う。0なら真っ直ぐ縦一列。 */
  fanOffsetX: number;
  /** 重なった時にどちらを手前にするか。falseなら列の先頭（ツモ順で
      最初の牌）が手前、trueなら末尾（ツモ牌に近い側）が手前
      ——プロトタイプの「Aが手前/Bが手前」に相当。 */
  frontIsLast: boolean;
  /** 手牌の列全体（Tile3D）を卓上でどこに置くか。鳴いた副露の数(0〜4)
      ごとに完全に独立した位置・角度を持つ配列（index 0=鳴いていない、
      index N=副露N個）。以前は「鳴いた数に関わらず一律の横/縦/傾き」
      だったが、手牌が短くなるたびに位置が変わってしまい、副露の数ごとに
      個別に固定したいとの要望のため、この配列方式に置き換えた
      （HandEditToolbar.tsx＋卓上での直接ドラッグで調整）。 */
  handGroupByMeldCount: HandGroupSlotConfig[];
  /** ツモ牌だけの横位置(px)。他の牌の並び方の計算式（扇状のfanOffsetX等）
      には一切頼らず、この値をそのままmarginLeftとして使う——「計算で
      それらしい位置に自動で置く」のをやめ、見ながら直接指定できるように
      するためのもの。 */
  drawnOffsetX: number;
  /** ツモ牌だけの縦位置(px)。同上、marginTopとしてそのまま使う。 */
  drawnOffsetY: number;
  /** 下家の副露を1つ鳴くごとに(1番目〜4番目)、それぞれ完全に独立して
      位置・角度を指定する（配列、index 0=1番目の副露）。副露編集モード
      (MeldEditToolbar.tsx)で実際の卓の上を直接ドラッグして設定する。
      以前は副露全体を一括で動かすグループ単位のオフセットもあったが、
      「1個動かすと全部動くように見えて分かりにくい」との指摘のため廃止し、
      この完全に独立したper-slotの値だけになった。 */
  meldSlots: MeldSlotConfig[];

  // ===== 上家(kamicha, player3)用（下家と全く同じ意味、値は独立） =====
  kamichaRx: number;
  kamichaRy: number;
  kamichaScale: number;
  kamichaThickness: number;
  kamichaWhiteWidth: number;
  kamichaAspectX: number;
  kamichaAspectY: number;
  kamichaSpacing: number;
  kamichaFanOffsetX: number;
  kamichaFrontIsLast: boolean;
  kamichaHandGroupByMeldCount: HandGroupSlotConfig[];
  kamichaDrawnOffsetX: number;
  kamichaDrawnOffsetY: number;
  kamichaMeldSlots: MeldSlotConfig[];
  /** ONの間、上家の手牌が副露で短くなっていく際、縮む側の端を下家と
      反対にする。手牌そのものの構造（アンカーサイズ・sync方式・ツモ牌の
      index）には一切触れず、描画するindexの並び順だけを反転させる
      （project-tile3d-prototypeメモの「1回目の試みは副作用が大きすぎ」
      の反省を踏まえ、ツモ牌位置には影響しない箇所だけを変える）。 */
  kamichaShrinkReversed: boolean;

  // ===== 調整パネルの開閉状態（永続化しない、下のpartialize参照） =====
  /** どちらの調整パネルを開いているか。設定(歯車)メニューの
      「下家の調整」「上家の調整」から開き、パネル自身の閉じるボタンで
      nullに戻す。 */
  activePanel: "shimocha" | "kamicha" | null;
  setActivePanel: (v: "shimocha" | "kamicha" | null) => void;

  /** 副露配置編集モード。nullなら編集モードOFF（副露は通常表示・
      ドラッグ不可）。"shimocha"/"kamicha"の間は、実際の卓の上で
      その座席の副露(.opponent-melds内の.meld)を直接ドラッグして
      配置できる——別画面の縮小プレビューではなく、本物の卓の空間と
      完全に同じ場所・同じ縦横比で操作できることが必須という指摘を
      受け、モーダルではない小さなツールバー(MeldEditToolbar.tsx)＋
      OpponentArea.tsx側のドラッグ機能として実装している。 */
  meldEditSeat: "shimocha" | "kamicha" | null;
  setMeldEditSeat: (v: "shimocha" | "kamicha" | null) => void;
  /** 編集モード中、実際の副露がまだ無い/少ない場合でも仮の副露を
      この数まで卓上に表示し、ドラッグで位置を決められるようにする
      （実際の副露がこれより多い場合は実際の数がそのまま優先される）。 */
  meldEditPreviewCount: number;
  setMeldEditPreviewCount: (v: number) => void;
  /** ツールバーの角度スライダーがどの副露(0〜3)を操作対象にしているか。
      卓上で直接ドラッグを始めた副露にも自動的に同期する。 */
  meldEditActiveSlot: number;
  setMeldEditActiveSlot: (v: number) => void;

  /** 手牌配置編集モード。nullなら編集モードOFF。副露配置編集モードと
      全く同じ考え方で、実際の卓の上でその座席の手牌の塊を直接ドラッグ
      して、選択中の副露数状態(handEditMeldCount)の位置を決める。 */
  handEditSeat: "shimocha" | "kamicha" | null;
  setHandEditSeat: (v: "shimocha" | "kamicha" | null) => void;
  /** 編集中、鳴いた副露が0〜4個のうちどの状態を編集/プレビューしているか。 */
  handEditMeldCount: number;
  setHandEditMeldCount: (v: number) => void;

  /** 暗槓表示確認モード。座席ごとにON/OFFでき、ONの座席には実際の
      副露に加えて仮の暗槓(4枚、両端伏せ)を1つ卓上に表示する——CPUが
      暗槓を宣言するのを待たなくても見た目を確認できるようにするため
      （指摘: 自分の暗槓は正しいのに他家の暗槓だけ厚みの位置がおかしく、
      CPU任せだと確認しづらい）。位置調整の値ではなくその場限りの
      確認用フラグなので、meldEditSeat等と同じく永続化しない。 */
  ankanPreview: { shimocha: boolean; toimen: boolean; kamicha: boolean };
  setAnkanPreview: (seat: "shimocha" | "toimen" | "kamicha", v: boolean) => void;
  ankanPreviewPanelOpen: boolean;
  setAnkanPreviewPanelOpen: (v: boolean) => void;

  /** 河の座席ごとの位置・角度・拡大率(自分=0/下家=1/対面=2/上家=3)。 */
  riverSlots: [RiverSlotConfig, RiverSlotConfig, RiverSlotConfig, RiverSlotConfig];
  setRiverSlot: (player: 0 | 1 | 2 | 3, patch: Partial<RiverSlotConfig>) => void;
  resetRiverSlot: (player: 0 | 1 | 2 | 3) => void;
  /** 河配置編集モード。nullなら編集モードOFF。RiverEditToolbar.tsx参照。 */
  riverEditOpen: boolean;
  setRiverEditOpen: (v: boolean) => void;
  riverEditActiveSeat: 0 | 1 | 2 | 3;
  setRiverEditActiveSeat: (v: 0 | 1 | 2 | 3) => void;

  /** リーチ棒(1000点棒)の座席ごとの位置・角度(自分=0/下家=1/対面=2/上家=3)。
      河・ネームプレートと同じ形（RiichiStickEditToolbar.tsx参照）。 */
  riichiStickSlots: [SeatSlotConfig, SeatSlotConfig, SeatSlotConfig, SeatSlotConfig];
  setRiichiStickSlot: (player: 0 | 1 | 2 | 3, patch: Partial<SeatSlotConfig>) => void;
  resetRiichiStickSlot: (player: 0 | 1 | 2 | 3) => void;
  /** リーチ棒配置編集モード。nullなら編集モードOFF。RiichiStickEditToolbar.tsx参照。 */
  riichiStickEditOpen: boolean;
  setRiichiStickEditOpen: (v: boolean) => void;
  riichiStickEditActiveSeat: 0 | 1 | 2 | 3;
  setRiichiStickEditActiveSeat: (v: 0 | 1 | 2 | 3) => void;

  /** ネームプレート(CharacterPanel)の座席ごとの位置・角度。河と同じ形。 */
  nameplateSlots: [SeatSlotConfig, SeatSlotConfig, SeatSlotConfig, SeatSlotConfig];
  setNameplateSlot: (player: 0 | 1 | 2 | 3, patch: Partial<SeatSlotConfig>) => void;
  resetNameplateSlot: (player: 0 | 1 | 2 | 3) => void;
  nameplateEditOpen: boolean;
  setNameplateEditOpen: (v: boolean) => void;
  nameplateEditActiveSeat: 0 | 1 | 2 | 3;
  setNameplateEditActiveSeat: (v: 0 | 1 | 2 | 3) => void;

  /** 対面の手牌全体・副露全体それぞれの位置・拡大率。ToimenEditToolbar.tsx参照。 */
  toimenHandSlot: ToimenSlotConfig;
  setToimenHandSlot: (patch: Partial<ToimenSlotConfig>) => void;
  resetToimenHandSlot: () => void;
  toimenMeldSlot: ToimenSlotConfig;
  setToimenMeldSlot: (patch: Partial<ToimenSlotConfig>) => void;
  resetToimenMeldSlot: () => void;
  /** 対面配置編集モード。nullなら編集モードOFF。"hand"/"meld"のどちらを
      ドラッグ対象にしているか。 */
  toimenEditTarget: "hand" | "meld" | null;
  setToimenEditTarget: (v: "hand" | "meld" | null) => void;

  setRx: (v: number) => void;
  setRy: (v: number) => void;
  setScale: (v: number) => void;
  setThickness: (v: number) => void;
  setWhiteWidth: (v: number) => void;
  setAspectX: (v: number) => void;
  setAspectY: (v: number) => void;
  setSpacing: (v: number) => void;
  setFanOffsetX: (v: number) => void;
  setFrontIsLast: (v: boolean) => void;
  setDrawnOffsetX: (v: number) => void;
  setDrawnOffsetY: (v: number) => void;
  /** isKamicha=falseなら下家、trueなら上家のmeldSlots[index]をpatchで
      部分更新する。ドラッグ中はoffsetX/Yだけ、角度ボタンはrotateだけを
      渡す想定。 */
  setMeldSlot: (isKamicha: boolean, index: number, patch: Partial<MeldSlotConfig>) => void;
  resetMeldSlot: (isKamicha: boolean, index: number) => void;
  /** isKamicha=falseなら下家、trueなら上家のhandGroupByMeldCount[meldCount]
      をpatchで部分更新する。 */
  setHandGroupSlot: (isKamicha: boolean, meldCount: number, patch: Partial<HandGroupSlotConfig>) => void;
  resetHandGroupSlot: (isKamicha: boolean, meldCount: number) => void;
  setKamichaShrinkReversed: (v: boolean) => void;

  setKamichaRx: (v: number) => void;
  setKamichaRy: (v: number) => void;
  setKamichaScale: (v: number) => void;
  setKamichaThickness: (v: number) => void;
  setKamichaWhiteWidth: (v: number) => void;
  setKamichaAspectX: (v: number) => void;
  setKamichaAspectY: (v: number) => void;
  setKamichaSpacing: (v: number) => void;
  setKamichaFanOffsetX: (v: number) => void;
  setKamichaFrontIsLast: (v: boolean) => void;
  setKamichaDrawnOffsetX: (v: number) => void;
  setKamichaDrawnOffsetY: (v: number) => void;
}

export const useTile3DDebugStore = create<Tile3DDebugState>()(
  persist(
    (set) => ({
      ...INITIAL_SCALARS,
      meldSlots: INITIAL_MELD_SLOTS.map((slot) => ({ ...slot })),
      handGroupByMeldCount: INITIAL_HAND_GROUP_SLOTS.map((slot) => ({ ...slot })),

      // 上家は下家の値の流用ではなく、実機で座席ごとに個別に詰めた確定値。
      // 画面の反対側から見る分、牌の形状パラメータ(厚み・白幅・角度)まで
      // 下家とは別の値になっている。
      ...INITIAL_KAMICHA_SCALARS,
      kamichaHandGroupByMeldCount: INITIAL_KAMICHA_HAND_GROUP_SLOTS.map((slot) => ({ ...slot })),
      kamichaMeldSlots: INITIAL_KAMICHA_MELD_SLOTS.map((slot) => ({ ...slot })),

      activePanel: null,
      setActivePanel: (activePanel) => set({ activePanel }),

      meldEditSeat: null,
      setMeldEditSeat: (meldEditSeat) => set({ meldEditSeat }),
      meldEditPreviewCount: 1,
      setMeldEditPreviewCount: (meldEditPreviewCount) => set({ meldEditPreviewCount }),
      meldEditActiveSlot: 0,
      setMeldEditActiveSlot: (meldEditActiveSlot) => set({ meldEditActiveSlot }),

      handEditSeat: null,
      setHandEditSeat: (handEditSeat) => set({ handEditSeat }),
      handEditMeldCount: 0,
      setHandEditMeldCount: (handEditMeldCount) => set({ handEditMeldCount }),

      ankanPreview: { shimocha: false, toimen: false, kamicha: false },
      setAnkanPreview: (seat, v) => set((state) => ({ ankanPreview: { ...state.ankanPreview, [seat]: v } })),
      ankanPreviewPanelOpen: false,
      setAnkanPreviewPanelOpen: (ankanPreviewPanelOpen) => set({ ankanPreviewPanelOpen }),

      riverSlots: INITIAL_RIVER_SLOTS.map((slot) => ({ ...slot })) as Tile3DDebugState["riverSlots"],
      setRiverSlot: (player, patch) =>
        set((state) => {
          const slots = [...state.riverSlots] as Tile3DDebugState["riverSlots"];
          slots[player] = { ...slots[player], ...patch };
          return { riverSlots: slots };
        }),
      resetRiverSlot: (player) =>
        set((state) => {
          const slots = [...state.riverSlots] as Tile3DDebugState["riverSlots"];
          slots[player] = { ...INITIAL_RIVER_SLOTS[player]! };
          return { riverSlots: slots };
        }),
      riverEditOpen: false,
      setRiverEditOpen: (riverEditOpen) => set({ riverEditOpen }),
      riverEditActiveSeat: 0,
      setRiverEditActiveSeat: (riverEditActiveSeat) => set({ riverEditActiveSeat }),

      riichiStickSlots: INITIAL_RIICHI_STICK_SLOTS.map((slot) => ({ ...slot })) as Tile3DDebugState["riichiStickSlots"],
      setRiichiStickSlot: (player, patch) =>
        set((state) => {
          const slots = [...state.riichiStickSlots] as Tile3DDebugState["riichiStickSlots"];
          slots[player] = { ...slots[player], ...patch };
          return { riichiStickSlots: slots };
        }),
      resetRiichiStickSlot: (player) =>
        set((state) => {
          const slots = [...state.riichiStickSlots] as Tile3DDebugState["riichiStickSlots"];
          slots[player] = { ...INITIAL_RIICHI_STICK_SLOTS[player]! };
          return { riichiStickSlots: slots };
        }),
      riichiStickEditOpen: false,
      setRiichiStickEditOpen: (riichiStickEditOpen) => set({ riichiStickEditOpen }),
      riichiStickEditActiveSeat: 0,
      setRiichiStickEditActiveSeat: (riichiStickEditActiveSeat) => set({ riichiStickEditActiveSeat }),

      nameplateSlots: INITIAL_NAMEPLATE_SLOTS.map((slot) => ({ ...slot })) as Tile3DDebugState["nameplateSlots"],
      setNameplateSlot: (player, patch) =>
        set((state) => {
          const slots = [...state.nameplateSlots] as Tile3DDebugState["nameplateSlots"];
          slots[player] = { ...slots[player], ...patch };
          return { nameplateSlots: slots };
        }),
      resetNameplateSlot: (player) =>
        set((state) => {
          const slots = [...state.nameplateSlots] as Tile3DDebugState["nameplateSlots"];
          slots[player] = { ...INITIAL_NAMEPLATE_SLOTS[player]! };
          return { nameplateSlots: slots };
        }),
      nameplateEditOpen: false,
      setNameplateEditOpen: (nameplateEditOpen) => set({ nameplateEditOpen }),
      nameplateEditActiveSeat: 0,
      setNameplateEditActiveSeat: (nameplateEditActiveSeat) => set({ nameplateEditActiveSeat }),

      toimenHandSlot: { ...INITIAL_TOIMEN_HAND_SLOT },
      setToimenHandSlot: (patch) => set((state) => ({ toimenHandSlot: { ...state.toimenHandSlot, ...patch } })),
      resetToimenHandSlot: () => set({ toimenHandSlot: { ...INITIAL_TOIMEN_HAND_SLOT } }),
      toimenMeldSlot: { ...INITIAL_TOIMEN_MELD_SLOT },
      setToimenMeldSlot: (patch) => set((state) => ({ toimenMeldSlot: { ...state.toimenMeldSlot, ...patch } })),
      resetToimenMeldSlot: () => set({ toimenMeldSlot: { ...INITIAL_TOIMEN_MELD_SLOT } }),
      toimenEditTarget: null,
      setToimenEditTarget: (toimenEditTarget) => set({ toimenEditTarget }),

      setRx: (rx) => set({ rx }),
      setRy: (ry) => set({ ry }),
      setScale: (scale) => set({ scale }),
      setThickness: (thickness) => set({ thickness }),
      setWhiteWidth: (whiteWidth) => set({ whiteWidth }),
      setAspectX: (aspectX) => set({ aspectX }),
      setAspectY: (aspectY) => set({ aspectY }),
      setSpacing: (spacing) => set({ spacing }),
      setFanOffsetX: (fanOffsetX) => set({ fanOffsetX }),
      setFrontIsLast: (frontIsLast) => set({ frontIsLast }),
      setDrawnOffsetX: (drawnOffsetX) => set({ drawnOffsetX }),
      setDrawnOffsetY: (drawnOffsetY) => set({ drawnOffsetY }),
      setMeldSlot: (isKamicha, index, patch) =>
        set((state) => {
          const key = isKamicha ? "kamichaMeldSlots" : "meldSlots";
          const slots = state[key].slice();
          slots[index] = { ...slots[index]!, ...patch };
          return { [key]: slots } as Partial<Tile3DDebugState>;
        }),
      resetMeldSlot: (isKamicha, index) =>
        set((state) => {
          const key = isKamicha ? "kamichaMeldSlots" : "meldSlots";
          const slots = state[key].slice();
          slots[index] = { ...(isKamicha ? INITIAL_KAMICHA_MELD_SLOTS : INITIAL_MELD_SLOTS)[index]! };
          return { [key]: slots } as Partial<Tile3DDebugState>;
        }),
      setHandGroupSlot: (isKamicha, meldCount, patch) =>
        set((state) => {
          const key = isKamicha ? "kamichaHandGroupByMeldCount" : "handGroupByMeldCount";
          const slots = state[key].slice();
          slots[meldCount] = { ...slots[meldCount]!, ...patch };
          return { [key]: slots } as Partial<Tile3DDebugState>;
        }),
      resetHandGroupSlot: (isKamicha, meldCount) =>
        set((state) => {
          const key = isKamicha ? "kamichaHandGroupByMeldCount" : "handGroupByMeldCount";
          const slots = state[key].slice();
          slots[meldCount] = { ...(isKamicha ? INITIAL_KAMICHA_HAND_GROUP_SLOTS : INITIAL_HAND_GROUP_SLOTS)[meldCount]! };
          return { [key]: slots } as Partial<Tile3DDebugState>;
        }),
      setKamichaShrinkReversed: (kamichaShrinkReversed) => set({ kamichaShrinkReversed }),

      setKamichaRx: (kamichaRx) => set({ kamichaRx }),
      setKamichaRy: (kamichaRy) => set({ kamichaRy }),
      setKamichaScale: (kamichaScale) => set({ kamichaScale }),
      setKamichaThickness: (kamichaThickness) => set({ kamichaThickness }),
      setKamichaWhiteWidth: (kamichaWhiteWidth) => set({ kamichaWhiteWidth }),
      setKamichaAspectX: (kamichaAspectX) => set({ kamichaAspectX }),
      setKamichaAspectY: (kamichaAspectY) => set({ kamichaAspectY }),
      setKamichaSpacing: (kamichaSpacing) => set({ kamichaSpacing }),
      setKamichaFanOffsetX: (kamichaFanOffsetX) => set({ kamichaFanOffsetX }),
      setKamichaFrontIsLast: (kamichaFrontIsLast) => set({ kamichaFrontIsLast }),
      setKamichaDrawnOffsetX: (kamichaDrawnOffsetX) => set({ kamichaDrawnOffsetX }),
      setKamichaDrawnOffsetY: (kamichaDrawnOffsetY) => set({ kamichaDrawnOffsetY }),
    }),
    {
      name: "tile3d-debug-store",
      version: 6,
      // パネルの開閉状態(activePanel)は「今このセッションで開いているか」
      // だけの一時的なUI状態なので、リロードのたびに閉じた状態(null)から
      // 始まってよい——むしろpersistすると、開いたままリロードした時に
      // 変な状態で固定表示されてしまう。setActivePanelもpersist不要
      // (関数はそもそも保存できない)。手牌配置編集モードの開閉
      // (handEditSeat)・どの副露数状態を見ているか(handEditMeldCount)、
      // 暗槓表示確認モード(ankanPreview)、河・ネームプレート配置編集モードの
      // 開閉(riverEditOpen/nameplateEditOpen)・選択中の座席
      // (riverEditActiveSeat/nameplateEditActiveSeat)、対面配置編集モードの
      // 開閉・対象(toimenEditTarget)、リーチ棒配置編集モードの開閉・選択中の
      // 座席(riichiStickEditOpen/riichiStickEditActiveSeat)も同じ理由で
      // 除外する（riverSlots/nameplateSlots/toimenHandSlot/toimenMeldSlot/
      // riichiStickSlots自体＝実際に調整した位置の値は、通常のフィールド
      // としてここでは除外せずpersistする）。
      partialize: (state) => {
        const {
          activePanel,
          setActivePanel,
          meldEditSeat,
          setMeldEditSeat,
          meldEditActiveSlot,
          setMeldEditActiveSlot,
          handEditSeat,
          setHandEditSeat,
          handEditMeldCount,
          setHandEditMeldCount,
          ankanPreview,
          setAnkanPreview,
          ankanPreviewPanelOpen,
          setAnkanPreviewPanelOpen,
          riverEditOpen,
          setRiverEditOpen,
          riverEditActiveSeat,
          setRiverEditActiveSeat,
          nameplateEditOpen,
          setNameplateEditOpen,
          nameplateEditActiveSeat,
          setNameplateEditActiveSeat,
          toimenEditTarget,
          setToimenEditTarget,
          riichiStickEditOpen,
          setRiichiStickEditOpen,
          riichiStickEditActiveSeat,
          setRiichiStickEditActiveSeat,
          ...rest
        } = state;
        return rest;
      },
      // v0→v1: 側面の白/緑の境界を「割合(55%)」から「白だけ固定px」に
      // 変えた際、既定のwhiteWidthを1.5pxという小さすぎる値にしてしまい、
      // 白と緑の比率が元の見た目(理想として確定していた白55%/緑45%)から
      // 逆転してしまっていた（緑が支配的になった）。localStorageに
      // 保存済みの値はファイルの新しい既定値では上書きされないため、
      // ここで明示的にthickness/whiteWidthだけを元の確定状態(8px/4.4px
      // ＝ちょうど55%/45%と同じ比率)へ戻す。他のフィールド(角度・並び等、
      // 実機のパネルで調整済みの値)には一切触れない。
      migrate: (persisted, version) => {
        let s = persisted as Partial<Tile3DDebugState>;
        if (version < 1) {
          // partialize導入でPersistedStateの型が厳しくなり、Partial型を
          // そのまま返すと型エラーになるためキャスト（永続化される
          // フィールドの一部だけを更新する意図はランタイムの挙動としては
          // 変わらない——zustand/persistのmergeが欠けたフィールドを
          // ストアの初期値で補うため）。
          s = { ...s, thickness: 8, whiteWidth: 4.4 };
        }
        // v1→v2で行った副露位置決め方式の変更（meldsOffsetX/Y/Rotateの
        // リセット）は、そのグループ単位のオフセット自体を後にper-slotの
        // meldSlots/kamichaMeldSlotsへ完全に置き換えて廃止したため、
        // このmigrateステップは不要になった（該当フィールドがもう
        // 型に存在しない）。
        if (version < 3) {
          // v2→v3: 手牌の列全体の位置(groupOffsetX/Y/Rotate、
          // kamichaGroupOffsetX/Y/Rotate)を、「鳴いた副露の数(0〜4)ごとに
          // 個別固定できる配列」(handGroupByMeldCount/kamichaHandGroupBy
          // MeldCount)に置き換えた——手牌が短くなるたびに位置が変わって
          // しまう、副露の数ごとに個別に固定したいとの要望のため。
          // 既存の調整済み値を失わないよう、旧フィールド(groupOffsetX等、
          // もう型には存在しないがpersisted生データにはまだ残っている)を
          // 「鳴いていない(index 0)」状態の初期値としてそのまま引き継ぐ
          // （他のindex 1〜4は0からユーザーに調整してもらう）。
          const old = s as unknown as Record<string, number | undefined>;
          const shimochaSeed: HandGroupSlotConfig = {
            offsetX: old.groupOffsetX ?? 0,
            offsetY: old.groupOffsetY ?? 0,
            rotate: old.groupRotate ?? 0,
          };
          const kamichaSeed: HandGroupSlotConfig = {
            offsetX: old.kamichaGroupOffsetX ?? 0,
            offsetY: old.kamichaGroupOffsetY ?? 0,
            rotate: old.kamichaGroupRotate ?? 0,
          };
          s = {
            ...s,
            handGroupByMeldCount: [
              shimochaSeed,
              { ...DEFAULT_HAND_GROUP_SLOT },
              { ...DEFAULT_HAND_GROUP_SLOT },
              { ...DEFAULT_HAND_GROUP_SLOT },
              { ...DEFAULT_HAND_GROUP_SLOT },
            ],
            kamichaHandGroupByMeldCount: [
              kamichaSeed,
              { ...DEFAULT_HAND_GROUP_SLOT },
              { ...DEFAULT_HAND_GROUP_SLOT },
              { ...DEFAULT_HAND_GROUP_SLOT },
              { ...DEFAULT_HAND_GROUP_SLOT },
            ],
          };
        }
        if (version < 4) {
          // v3→v4: 河の座席ごとの位置(riverSlots)に、河の牌自体の拡大率
          // (scale)を追加した。既存の保存済みriverSlotsはoffsetX/offsetY/
          // rotateしか持たないため、そのままだと各要素のscaleがundefined
          // になる（DiscardPile側でactive.scale.toFixed()等を呼ぶと壊れる）。
          // 既存の位置調整値(offsetX/offsetY/rotate)は一切変えず、scaleだけ
          // 既定値1(等倍、これまでの見た目と同じ)を明示的に補う。
          const old = s as unknown as { riverSlots?: Array<Partial<RiverSlotConfig>> };
          const base: Array<Partial<RiverSlotConfig>> = old.riverSlots ?? [{}, {}, {}, {}];
          const riverSlots = base.map((slot) => ({
            offsetX: slot.offsetX ?? 0,
            offsetY: slot.offsetY ?? 0,
            rotate: slot.rotate ?? 0,
            scale: slot.scale ?? 1,
          })) as [RiverSlotConfig, RiverSlotConfig, RiverSlotConfig, RiverSlotConfig];
          s = { ...s, riverSlots };
        }
        // v4→v6: ★このステップだけは「新規追加フィールドの穴埋め」ではなく、
        // 「ブラウザ間の見た目統一」を目的にした例外的な強制上書き★
        // （ファイル冒頭の絶対ルール＝既存フィールドの保存済み値には触れない
        // 、に反するように見えるが、ユーザーから明示的に要望されたための
        // 意図的な例外）。
        //
        // これまでこのストアはブラウザ(Chrome/Edge等)ごとに別々の
        // localStorageへ保存されており、実機調整はほぼEdge上でだけ行って
        // いたため、Chromeなど他ブラウザには「調整途中で放置された古い値」
        // (例: 副露を持った後の手牌位置・河の位置が全部0のまま)が残って
        // いた。新規追加フィールドの穴埋めでは既存キーの値は上書きされない
        // ため、他ブラウザだけ配置が大きく崩れて見える不具合として発覚した。
        //
        // 対策として、Edgeで最終確定した値(=上のINITIAL_*定数、ソース側の
        // 既定値と完全に同じ)を全ブラウザへ強制的に再適用する。
        //
        // ★v5→v6にした理由(2026-09-22 追記)★
        // 最初はv5として実装したが、このファイル自体を編集している最中に
        // Vite開発サーバーへHMR接続されたChromeタブが開いていたため、
        // 「version:5に上げた直後・強制上書きコードをまだ足す前」という
        // 中途半端な保存タイミングでHMRが発火してしまった。その瞬間の
        // コードが実行され、「version:5を名乗るが実際は矯正されていない
        // 古い値のまま」というデータがChromeのlocalStorageに書き込まれて
        // しまい、`version < 5`のガードにより以後は再矯正されなくなって
        // いた（Chromeだけ配置がおかしいまま直らない不具合として発覚）。
        // v6に上げることで、この「version:5を騙る壊れたデータ」も含めて
        // 再度強制上書きの対象にする。
        //
        // 以後(v6以降)は通常どおり、ユーザーが実機で動かした値を尊重し
        // 二度と勝手に上書きしない。
        if (version < 6) {
          s = {
            ...s,
            ...INITIAL_SCALARS,
            meldSlots: INITIAL_MELD_SLOTS.map((slot) => ({ ...slot })),
            handGroupByMeldCount: INITIAL_HAND_GROUP_SLOTS.map((slot) => ({ ...slot })),
            ...INITIAL_KAMICHA_SCALARS,
            kamichaHandGroupByMeldCount: INITIAL_KAMICHA_HAND_GROUP_SLOTS.map((slot) => ({ ...slot })),
            kamichaMeldSlots: INITIAL_KAMICHA_MELD_SLOTS.map((slot) => ({ ...slot })),
            riverSlots: INITIAL_RIVER_SLOTS.map((slot) => ({ ...slot })) as Tile3DDebugState["riverSlots"],
            riichiStickSlots: INITIAL_RIICHI_STICK_SLOTS.map((slot) => ({ ...slot })) as Tile3DDebugState["riichiStickSlots"],
            nameplateSlots: INITIAL_NAMEPLATE_SLOTS.map((slot) => ({ ...slot })) as Tile3DDebugState["nameplateSlots"],
            toimenHandSlot: { ...INITIAL_TOIMEN_HAND_SLOT },
            toimenMeldSlot: { ...INITIAL_TOIMEN_MELD_SLOT },
          };
        }
        return s as Tile3DDebugState;
      },
    },
  ),
);

/**
 * OpponentArea.tsx用のヘルパー。下家用フィールドと上家用フィールド
 * （接頭辞kamicha）は完全に独立した値だが、呼び出し側では「今描画して
 * いるplayerがどちらか」で切り替えたいだけなので、2つのセレクタを渡して
 * isKamichaで選ぶだけの薄いラッパーにしてある。Reactのフックのルール上
 * 問題なく使えるよう（条件分岐なしで常に両方呼ぶ）実装している。
 */
export function usePlayerTile3DParam<T>(
  shimochaSelector: (s: Tile3DDebugState) => T,
  kamichaSelector: (s: Tile3DDebugState) => T,
  isKamicha: boolean,
): T {
  const shimochaValue = useTile3DDebugStore(shimochaSelector);
  const kamichaValue = useTile3DDebugStore(kamichaSelector);
  return isKamicha ? kamichaValue : shimochaValue;
}
