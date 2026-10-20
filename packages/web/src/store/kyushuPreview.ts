import { create } from "zustand";

/** 九種九牌の流局演出（相手の手牌が開く動き）を、実際に流局しなくても見るための確認用。 */
const PREVIEW_MS = 2800;

interface KyushuPreviewState {
  active: boolean;
  start: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useKyushuPreview = create<KyushuPreviewState>((set) => ({
  active: false,
  start: () => {
    // 一度閉じてから開き直して、押すたびに動きが最初から再生されるようにする。
    clearTimeout(timer);
    set({ active: false });
    setTimeout(() => {
      set({ active: true });
      timer = setTimeout(() => set({ active: false }), PREVIEW_MS);
    }, 50);
  },
}));
