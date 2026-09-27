import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { sharedTuningStorage } from "./sharedTuningStorage.js";

/**
 * 卓面背景画像(.table-surface)の「どの画像を使うか」を管理するストア。
 * サイズ・位置の微調整はbackgroundDebugStore.tsが担当し、こちらは
 * 複数の背景画像から選択する・以前使っていた画像に戻す、という切り替え
 * 機能専用。今後も背景素材を追加していく想定のため、素材自体は
 * TABLE_BACKGROUND_OPTIONSに追加するだけで選択肢に増やせるようにしている。
 *
 * localStorageに永続化する（persistミドルウェア）。tile3dDebugStore.ts /
 * backgroundDebugStore.tsと同じ絶対ルールに従うこと:
 * ・新しいフィールドを「追加」するだけならversionは上げなくてよい。
 * ・既存フィールドの「初期値そのもの」を変える必要がある場合は、必ず
 *   versionを1つ上げ、migrate関数でそのフィールドだけを明示的に補正する
 *   こと（他のフィールドはmigrate内で絶対に触らない）。
 */
export interface TableBackgroundOption {
  id: string;
  /** 設定メニューに出す短いラベル。 */
  label: string;
  /** public/table/以下の画像パス。 */
  path: string;
}

// 未知のidのフォールバック先は先頭。既定の背景はDEFAULT_BACKGROUND_ID。旧「初期背景」
// (id:"default"、table-surface-bg.png)は2026-09-24に削除した。
export const TABLE_BACKGROUND_OPTIONS: TableBackgroundOption[] = [
  { id: "sakura-2026-09-24", label: "桜(紫)", path: "/table/table-surface-bg-sakura.png" },
  { id: "seigaiha-2026-09-24", label: "青海波(紺)", path: "/table/table-surface-bg-seigaiha.png" },
  { id: "neon-2026-09-24", label: "ネオン", path: "/table/table-surface-bg-neon.png" },
  { id: "wood-2026-09-24", label: "木目", path: "/table/table-surface-bg-wood.png" },
  { id: "marble-2026-09-24", label: "大理石", path: "/table/table-surface-bg-marble.png" },
  { id: "nami-2026-09-24", label: "荒波(紺)", path: "/table/table-surface-bg-nami.png" },
  { id: "benizakura-2026-09-24", label: "紅桜(赤)", path: "/table/table-surface-bg-benizakura.png" },
  { id: "blue-2026-09-18", label: "新背景(青)", path: "/table/table-surface-bg-2.png" },
];

const DEFAULT_BACKGROUND_ID = "neon-2026-09-24";
/** 「元に戻す」の戻し先の既定値。2026-09-27のAvastの状態に合わせた。 */
const DEFAULT_PREVIOUS_BACKGROUND_ID = "seigaiha-2026-09-24";

const FALLBACK_PATH = TABLE_BACKGROUND_OPTIONS[0]!.path;

function pathForId(id: string): string {
  return TABLE_BACKGROUND_OPTIONS.find((o) => o.id === id)?.path ?? FALLBACK_PATH;
}

export interface TableBackgroundState {
  /** 現在表示中の背景のid(TABLE_BACKGROUND_OPTIONS参照)。 */
  backgroundId: string;
  /** 直前に表示していた背景のid。「元に戻す」ボタンの戻し先。
      初期値はnull（戻し先なし）。 */
  previousBackgroundId: string | null;
  setBackgroundId: (id: string) => void;
  /** backgroundIdとpreviousBackgroundIdを入れ替える（=1つ前の背景に戻す。
      もう一度押せば今の背景にも戻れるトグル動作）。 */
  revertToPrevious: () => void;
}

export const useTableBackgroundStore = create<TableBackgroundState>()(
  persist(
    (set, get) => ({
      backgroundId: DEFAULT_BACKGROUND_ID,
      previousBackgroundId: DEFAULT_PREVIOUS_BACKGROUND_ID,
      setBackgroundId: (id) => {
        const current = get().backgroundId;
        if (current === id) return;
        set({ backgroundId: id, previousBackgroundId: current });
      },
      revertToPrevious: () => {
        const { previousBackgroundId, backgroundId } = get();
        if (!previousBackgroundId || previousBackgroundId === backgroundId) return;
        set({ backgroundId: previousBackgroundId, previousBackgroundId: backgroundId });
      },
    }),
    {
      name: "table-background-store",
      // どのブラウザでも同じ値になるようファイルに保存する（sharedTuningStorage.ts参照）
      storage: createJSONStorage(() => sharedTuningStorage),
      // version 1(2026-09-24): 既定の背景を桜(紫)に変更し、旧「初期背景」
      // (id:"default")を削除した。version 2(2026-09-27): 既定をネオンに変更。
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<TableBackgroundState>;
        // v1→v2: 2026-09-27、Avastの選択(ネオン、戻し先は青海波)を全ブラウザの
        // 既定にするため、他ブラウザの保存値を一度だけ上書きする（ユーザーの
        // 明示的な指示による。tile3dDebugStore.tsのv6→v7と同じ）。v0(旧
        // "default"を含む)もこの上書きでまとめて解消されるので、v0→v1の
        // 個別処理は不要になった。
        if (version < 2) {
          return { ...state, backgroundId: DEFAULT_BACKGROUND_ID, previousBackgroundId: DEFAULT_PREVIOUS_BACKGROUND_ID };
        }
        return state;
      },
    },
  ),
);

export function tableBackgroundPath(id: string): string {
  return pathForId(id);
}
