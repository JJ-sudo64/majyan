import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 卓面背景画像(.table-surface、packages/web/public/table/table-surface-bg.png)
 * のサイズ・位置・中央パネル(.center-board)の位置を、実際の対局画面を見ながら
 * その場で調整するための一時的なデバッグ用ストア。
 *
 * 最初、画像内の中央パネルの位置をピクセル解析で理論計算し固定値として
 * 適用したが、ユーザー環境で「全然ダメ、デカすぎる」との指摘を受けた
 * ——理論値だけで正しい配置を当てるのは信頼できないと判明したため、
 * Tile3DDebugPanel/tile3dDebugStoreと同じ考え方で、実機で見ながら
 * 自由に調整できるスライダー式に切り替えた。
 *
 * localStorageに永続化している（persistミドルウェア）。tile3dDebugStore.ts
 * と同じ絶対ルールに従うこと:
 * ・新しいフィールドを「追加」するだけならversionは上げなくてよい。
 * ・既存フィールドの「初期値そのもの」を変える必要がある場合は、必ず
 *   versionを1つ上げ、migrate関数でそのフィールドだけを明示的に補正する
 *   こと（他のフィールドはmigrate内で絶対に触らない）。
 *
 * 開発中の調整用なので、値が決まったらstyles.css側に固定値として
 * 書き換え、このストア・パネルごと削除してよい。
 */
export interface BackgroundDebugState {
  /** 背景画像の拡大率(%)。100で画像の元サイズ相当、CSSのbackground-sizeに
      そのまま使う。 */
  bgScale: number;
  /** 背景画像の横位置、中心からのオフセット(px)。CSSは
      `background-position: calc(50% + Xpx) ...`という形で使う。
      以前は%指定(background-position: X% Y%)だったが、background-sizeが
      ちょうど100%の時は画像がコンテナぴったりに収まり動かす余地が無く
      なるため、「縦が全然下に下がらない」不具合として発覚した。scaleの
      値に関係なく常に一定量だけ動かせるよう、pxオフセット方式に変更した
      （version 1、migrate参照）。 */
  bgPosX: number;
  /** 背景画像の縦位置、中心からのオフセット(px)。同上。 */
  bgPosY: number;
  /** 中央パネル(.center-board)の横方向オフセット(px)。背景画像の中央
      パネル絵に、実際のスコア表示UIを重ねるための微調整用。 */
  centerBoardOffsetX: number;
  /** 中央パネル(.center-board)の縦方向オフセット(px)。 */
  centerBoardOffsetY: number;
  /** 中央パネル(.center-board)自体の拡大率(倍率、1で等倍)。背景画像内の
      パネル絵のサイズに、UIのサイズを合わせるための調整用。 */
  centerBoardScale: number;
  /** 調整パネルの開閉状態。一時的なUI状態なのでpersistしない
      （下のpartialize参照）。 */
  isPanelOpen: boolean;
  setBgScale: (v: number) => void;
  setBgPosX: (v: number) => void;
  setBgPosY: (v: number) => void;
  setCenterBoardOffsetX: (v: number) => void;
  setCenterBoardOffsetY: (v: number) => void;
  setCenterBoardScale: (v: number) => void;
  setIsPanelOpen: (v: boolean) => void;
}

export const useBackgroundDebugStore = create<BackgroundDebugState>()(
  persist(
    (set) => ({
      bgScale: 100,
      bgPosX: 0,
      bgPosY: 0,
      centerBoardOffsetX: 0,
      centerBoardOffsetY: -40,
      centerBoardScale: 1,
      isPanelOpen: false,
      setBgScale: (bgScale) => set({ bgScale }),
      setBgPosX: (bgPosX) => set({ bgPosX }),
      setBgPosY: (bgPosY) => set({ bgPosY }),
      setCenterBoardOffsetX: (centerBoardOffsetX) => set({ centerBoardOffsetX }),
      setCenterBoardOffsetY: (centerBoardOffsetY) => set({ centerBoardOffsetY }),
      setCenterBoardScale: (centerBoardScale) => set({ centerBoardScale }),
      setIsPanelOpen: (isPanelOpen) => set({ isPanelOpen }),
    }),
    {
      name: "background-debug-store",
      version: 1,
      partialize: (state) => {
        const { isPanelOpen, setIsPanelOpen, ...rest } = state;
        return rest;
      },
      // version 0→1: bgPosX/bgPosYの単位を「%指定」から「pxオフセット」に
      // 変更した。旧データの%値(0〜100前後)をそのままpxとして引き継ぐと
      // 意味が変わってしまう（例: 旧50%=中央のつもりが新50pxでは中心から
      // 50px右にズレる）ため、この2フィールドだけ新しい既定値(0px=中央)へ
      // 明示的にリセットする。bgScale/centerBoard*は意味が変わっていない
      // ので絶対ルール通り一切触らない。
      migrate: (persisted) => {
        const state = persisted as BackgroundDebugState;
        return { ...state, bgPosX: 0, bgPosY: 0 } as BackgroundDebugState;
      },
    },
  ),
);
