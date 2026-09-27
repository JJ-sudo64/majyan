import { create } from "zustand";

/**
 * ツモ・ロンの宣言カットイン(DeclarationCutinOverlay.tsx)を再生している間、
 * 点数画面(ScoreResult)を出すのを待たせるためのフラグ。カットインの上に
 * いきなり点数画面が被さると、せっかくの1枚絵が見えなくなるため。
 */
interface DeclarationCutinState {
  winCutinPlaying: boolean;
  setWinCutinPlaying: (v: boolean) => void;
}

export const useDeclarationCutinStore = create<DeclarationCutinState>((set) => ({
  winCutinPlaying: false,
  setWinCutinPlaying: (winCutinPlaying) => set({ winCutinPlaying }),
}));
