import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";

const SEAT_LABELS = ["自分", "下家", "対面", "上家"] as const;

/**
 * ネームプレート（CharacterPanel、顔写真+名前+点数+必殺技ゲージ）の
 * 座席ごとの位置・角度を、実際の卓の上で直接ドラッグして調整するための
 * ツールバー。RiverEditToolbar.tsxと全く同じ構造。
 */
export function NameplateEditToolbar() {
  const activeSeat = useTile3DDebugStore((s) => s.nameplateEditActiveSeat);
  const setActiveSeat = useTile3DDebugStore((s) => s.setNameplateEditActiveSeat);
  const setOpen = useTile3DDebugStore((s) => s.setNameplateEditOpen);
  const slots = useTile3DDebugStore((s) => s.nameplateSlots);
  const setNameplateSlot = useTile3DDebugStore((s) => s.setNameplateSlot);
  const resetNameplateSlot = useTile3DDebugStore((s) => s.resetNameplateSlot);
  const active = slots[activeSeat];

  return (
    <div className="meld-edit-toolbar nameplate-edit-toolbar">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">ネームプレートの配置編集</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="編集モードを終了" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">卓上のオレンジ枠のネームプレートをドラッグして配置してください</div>
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
          onChange={(e) => setNameplateSlot(activeSeat, { rotate: Number(e.target.value) })}
        />
        <output>{active.rotate}°</output>
      </label>
      <div className="meld-edit-toolbar__row">
        <span className="meld-edit-toolbar__hint">
          横{Math.round(active.offsetX)}px・縦{Math.round(active.offsetY)}px
        </span>
        <button type="button" className="tile3d-debug-panel__btn" onClick={() => resetNameplateSlot(activeSeat)}>
          {SEAT_LABELS[activeSeat]}をリセット
        </button>
      </div>
    </div>
  );
}
