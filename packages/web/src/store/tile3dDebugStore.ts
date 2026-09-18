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

const DEFAULT_MELD_SLOT: MeldSlotConfig = { offsetX: 0, offsetY: 0, rotate: 0 };
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
      rx: -55,
      ry: -20,
      scale: 1.4,
      thickness: 8,
      whiteWidth: 4.4,
      aspectX: 1,
      aspectY: 1,
      spacing: -20,
      fanOffsetX: 0,
      frontIsLast: false,
      drawnOffsetX: 0,
      drawnOffsetY: 10,
      meldSlots: [DEFAULT_MELD_SLOT, DEFAULT_MELD_SLOT, DEFAULT_MELD_SLOT, DEFAULT_MELD_SLOT],
      handGroupByMeldCount: Array.from({ length: HAND_GROUP_SLOT_COUNT }, () => ({ ...DEFAULT_HAND_GROUP_SLOT })),

      // 上家用の既定値は下家の確定値をそのまま流用する（画面の反対側に
      // あるだけで牌自体の形状パラメータは同じはずという想定）。位置系
      // (handGroupByMeldCount等)は座席が違うので0からユーザーに調整してもらう。
      kamichaRx: -55,
      kamichaRy: -20,
      kamichaScale: 1.4,
      kamichaThickness: 8,
      kamichaWhiteWidth: 4.4,
      kamichaAspectX: 1,
      kamichaAspectY: 1,
      kamichaSpacing: -20,
      kamichaFanOffsetX: 0,
      kamichaFrontIsLast: false,
      kamichaHandGroupByMeldCount: Array.from({ length: HAND_GROUP_SLOT_COUNT }, () => ({ ...DEFAULT_HAND_GROUP_SLOT })),
      kamichaDrawnOffsetX: 0,
      kamichaDrawnOffsetY: 10,
      kamichaMeldSlots: [DEFAULT_MELD_SLOT, DEFAULT_MELD_SLOT, DEFAULT_MELD_SLOT, DEFAULT_MELD_SLOT],
      kamichaShrinkReversed: false,

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
          slots[index] = { ...DEFAULT_MELD_SLOT };
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
          slots[meldCount] = { ...DEFAULT_HAND_GROUP_SLOT };
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
      version: 3,
      // パネルの開閉状態(activePanel)は「今このセッションで開いているか」
      // だけの一時的なUI状態なので、リロードのたびに閉じた状態(null)から
      // 始まってよい——むしろpersistすると、開いたままリロードした時に
      // 変な状態で固定表示されてしまう。setActivePanelもpersist不要
      // (関数はそもそも保存できない)。手牌配置編集モードの開閉
      // (handEditSeat)・どの副露数状態を見ているか(handEditMeldCount)も
      // 同じ理由で除外する。
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
