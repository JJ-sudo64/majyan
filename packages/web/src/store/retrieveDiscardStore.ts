import { create } from "zustand";

/**
 * ミオの必殺技「取り返し」用のUI状態（河の1枚→手牌の1枚、の2段階選択）。
 * 河（DiscardPile.tsx、Table.tsx）と手牌（Hand.tsx）が別コンポーネントで、
 * かつ選択中は自分の河のクリック挙動そのものを変える必要があるため、
 * useHoverStoreと同様に対局状態を持つgameStoreとは分けて管理する。
 */
interface RetrieveDiscardState {
  /** 「取り返し」モード中かどうか。 */
  active: boolean;
  /** モード中に選んだ、河から取り返す牌のid。まだ選んでいなければnull。 */
  reclaimTileId: string | null;
  start: () => void;
  cancel: () => void;
  selectReclaimTile: (tileId: string) => void;
}

export const useRetrieveDiscardStore = create<RetrieveDiscardState>((set) => ({
  active: false,
  reclaimTileId: null,
  start: () => set({ active: true, reclaimTileId: null }),
  cancel: () => set({ active: false, reclaimTileId: null }),
  selectReclaimTile: (tileId) => set({ reclaimTileId: tileId }),
}));
