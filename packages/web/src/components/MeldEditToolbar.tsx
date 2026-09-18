import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";

/**
 * 副露配置編集モードの操作パネル。以前は別画面の縮小プレビュー(ミニ
 * キャンバス)にドラッグ機能を実装したが、「実際の卓の配置と一致しない
 * ものをいじっても意味がない、卓上で直接ピンポイントに置きたい」との
 * 指摘を受けて全面的にやり直した。このツールバー自体は座席切替・表示数
 * 切替・選択中の副露の角度調整だけを担い、実際の位置決め（横/縦の移動）は
 * OpponentArea.tsx側で卓上の本物の副露要素(.meld)を直接ドラッグする
 * ことで行う——ここにはドラッグ用のキャンバスは存在しない。
 *
 * Tile3DDebugPanel/BackgroundDebugPanelと違い、卓全体を暗転させる
 * `.tile3d-debug-overlay`は使わない（卓を見ながら操作できることが
 * この機能の前提のため）。`.tile3d-hand-layer`(document.body直下、
 * z-index:20)より確実に手前に表示するため、Table.tsx側で他のモーダルと
 * 同じくdocument.body直下へPortalして使う。
 */
export function MeldEditToolbar() {
  const meldEditSeat = useTile3DDebugStore((s) => s.meldEditSeat);
  const setMeldEditSeat = useTile3DDebugStore((s) => s.setMeldEditSeat);
  const previewCount = useTile3DDebugStore((s) => s.meldEditPreviewCount);
  const setPreviewCount = useTile3DDebugStore((s) => s.setMeldEditPreviewCount);
  const activeSlot = useTile3DDebugStore((s) => s.meldEditActiveSlot);
  const setActiveSlot = useTile3DDebugStore((s) => s.setMeldEditActiveSlot);
  const setMeldSlot = useTile3DDebugStore((s) => s.setMeldSlot);
  const resetMeldSlot = useTile3DDebugStore((s) => s.resetMeldSlot);
  const shimochaSlots = useTile3DDebugStore((s) => s.meldSlots);
  const kamichaSlots = useTile3DDebugStore((s) => s.kamichaMeldSlots);

  if (!meldEditSeat) return null;
  const isKamicha = meldEditSeat === "kamicha";
  const slots = isKamicha ? kamichaSlots : shimochaSlots;
  const active = slots[activeSlot]!;

  return (
    <div className="meld-edit-toolbar">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">副露配置編集: {isKamicha ? "上家" : "下家"}</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="編集モードを終了" onClick={() => setMeldEditSeat(null)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">
        卓上のオレンジ枠の副露をドラッグして配置（緑枠が選択中）。「仮」のバッジが付いた半透明の副露は、実際の副露がまだ無いので位置決め用に仮表示しているものです
      </div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="編集する座席">
        <button
          type="button"
          className={`tile3d-debug-panel__btn${!isKamicha ? " tile3d-debug-panel__btn--active" : ""}`}
          onClick={() => setMeldEditSeat("shimocha")}
        >
          下家
        </button>
        <button
          type="button"
          className={`tile3d-debug-panel__btn${isKamicha ? " tile3d-debug-panel__btn--active" : ""}`}
          onClick={() => setMeldEditSeat("kamicha")}
        >
          上家
        </button>
      </div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="卓上に表示する副露の数">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            className={`tile3d-debug-panel__btn${previewCount === n ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => {
              setPreviewCount(n);
              setActiveSlot(n - 1);
            }}
          >
            {n}個
          </button>
        ))}
      </div>
      <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
        <span>副露{activeSlot + 1}・傾き</span>
        <input
          type="range"
          min={-45}
          max={45}
          step={1}
          value={active.rotate}
          onChange={(e) => setMeldSlot(isKamicha, activeSlot, { rotate: Number(e.target.value) })}
        />
        <output>{active.rotate}°</output>
      </label>
      <div className="meld-edit-toolbar__row">
        <span className="meld-edit-toolbar__hint">
          横{Math.round(active.offsetX)}px・縦{Math.round(active.offsetY)}px
        </span>
        <button type="button" className="tile3d-debug-panel__btn" onClick={() => resetMeldSlot(isKamicha, activeSlot)}>
          副露{activeSlot + 1}をリセット
        </button>
      </div>
    </div>
  );
}
