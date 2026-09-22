import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";

const SEAT_LABELS = ["自分", "下家", "対面", "上家"] as const;

/**
 * リーチ棒(1000点棒)の座席ごとの位置・角度を、実際の卓の上で直接ドラッグして
 * 調整するためのツールバー。RiverEditToolbar/NameplateEditToolbar.tsxと
 * 全く同じ構造。
 */
export function RiichiStickEditToolbar() {
  const activeSeat = useTile3DDebugStore((s) => s.riichiStickEditActiveSeat);
  const setActiveSeat = useTile3DDebugStore((s) => s.setRiichiStickEditActiveSeat);
  const setOpen = useTile3DDebugStore((s) => s.setRiichiStickEditOpen);
  const slots = useTile3DDebugStore((s) => s.riichiStickSlots);
  const setRiichiStickSlot = useTile3DDebugStore((s) => s.setRiichiStickSlot);
  const resetRiichiStickSlot = useTile3DDebugStore((s) => s.resetRiichiStickSlot);
  const active = slots[activeSeat];

  return (
    <div className="meld-edit-toolbar riichi-stick-edit-toolbar">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">リーチ棒の配置編集</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="編集モードを終了" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">
        卓上のオレンジ枠のリーチ棒をドラッグして配置してください。「仮」のバッジが付いた半透明のリーチ棒は、その座席が実際にはまだリーチしていないので位置決め用に仮表示しているものです
      </div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="編集する座席">
        {SEAT_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`tile3d-debug-panel__btn${activeSeat === i ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => setActiveSeat(i as 0 | 1 | 2 | 3)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
        <span>{SEAT_LABELS[activeSeat]}・傾き</span>
        <input
          type="range"
          min={-45}
          max={45}
          step={1}
          value={active.rotate}
          onChange={(e) => setRiichiStickSlot(activeSeat, { rotate: Number(e.target.value) })}
        />
        <output>{active.rotate}°</output>
      </label>
      <div className="meld-edit-toolbar__row">
        <span className="meld-edit-toolbar__hint">
          横{Math.round(active.offsetX)}px・縦{Math.round(active.offsetY)}px
        </span>
        <button type="button" className="tile3d-debug-panel__btn" onClick={() => resetRiichiStickSlot(activeSeat)}>
          {SEAT_LABELS[activeSeat]}をリセット
        </button>
      </div>
    </div>
  );
}
