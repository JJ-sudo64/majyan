import { create } from "zustand";
import { persist } from "zustand/middleware";

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

export const TABLE_BACKGROUND_OPTIONS: TableBackgroundOption[] = [
  { id: "default", label: "初期背景", path: "/table/table-surface-bg.png" },
  { id: "blue-2026-09-18", label: "新背景(青)", path: "/table/table-surface-bg-2.png" },
];

const DEFAULT_BACKGROUND_ID = "blue-2026-09-18";

const FALLBACK_PATH = TABLE_BACKGROUND_OPTIONS[0]!.path;

function pathForId(id: string): string {
  return TABLE_BACKGROUND_OPTIONS.find((o) => o.id === id)?.path ?? FALLBACK_PATH;
}

export interface TableBackgroundState {
  /** 現在表示中の背景のid(TABLE_BACKGROUND_OPTIONS参照)。 */
  backgroundId: string;
  /** 直前に表示していた背景のid。「元に戻す」ボタンの戻し先。
      初期値は"default"にしてあるので、この更新直後でも1回だけ
      旧デフォルト画像に戻せる。 */
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
      previousBackgroundId: "default",
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
      version: 0,
    },
  ),
);

export function tableBackgroundPath(id: string): string {
  return pathForId(id);
}
