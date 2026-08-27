import { create } from "zustand";
import type { TileCode } from "@majyan/core";

/**
 * じゃんたま風の「同じ牌をハイライト」用の状態。ゲーム進行とは無関係な
 * 純粋なUI状態なので、対局状態を持つgameStoreとは分けて管理する
 * （対局の巻き戻し等に巻き込まれないようにするため）。
 */
interface HoverState {
  hoveredCode: TileCode | null;
  setHoveredCode: (code: TileCode | null) => void;
}

export const useHoverStore = create<HoverState>((set) => ({
  hoveredCode: null,
  setHoveredCode: (code) => set({ hoveredCode: code }),
}));
