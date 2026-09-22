import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";

const SEAT_LABELS = ["自分", "下家", "対面", "上家"] as const;

/**
 * 河（捨て牌置き場）の座席ごとの位置・角度を、実際の卓の上で直接ドラッグして
 * 調整するためのツールバー。副露配置編集(MeldEditToolbar.tsx)と同じ考え方
 * だが、対象が下家/上家だけでなく自分・対面も含む4人全員で、鳴き数などの
 * 状態分岐も無いため座席ごとに1つの値だけを持つ、よりシンプルな形にした。
 * 卓を暗転させない小さなツールバーとしてdocument.body直下へPortalする
 * （Table.tsx参照）。
 */
export function RiverEditToolbar() {
  const activeSeat = useTile3DDebugStore((s) => s.riverEditActiveSeat);
  const setActiveSeat = useTile3DDebugStore((s) => s.setRiverEditActiveSeat);
  const setOpen = useTile3DDebugStore((s) => s.setRiverEditOpen);
  const slots = useTile3DDebugStore((s) => s.riverSlots);
  const setRiverSlot = useTile3DDebugStore((s) => s.setRiverSlot);
  const resetRiverSlot = useTile3DDebugStore((s) => s.resetRiverSlot);
  const active = slots[activeSeat];
  // scaleは後から追加したフィールドのため、開発中のHMR経由での再読み込み
  // (このファイルの絶対ルールコメント参照)等でstore側のmigrateが走らずに
  // 古い形のriverSlotsが残っていると、この値だけundefinedのままになり
  // 得る。ここで防御的に既定値(等倍)へフォールバックし、その場合でも
  // 編集パネルを開いただけでクラッシュしないようにする。
  const activeScale = active.scale ?? 1;

  return (
    <div className="meld-edit-toolbar river-edit-toolbar">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">河の配置編集</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="編集モードを終了" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">卓上のオレンジ枠の河をドラッグして配置してください</div>
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
          onChange={(e) => setRiverSlot(activeSeat, { rotate: Number(e.target.value) })}
        />
        <output>{active.rotate}°</output>
      </label>
      <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
        <span>{SEAT_LABELS[activeSeat]}・牌の大きさ</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={activeScale}
          onChange={(e) => setRiverSlot(activeSeat, { scale: Number(e.target.value) })}
        />
        <output>{activeScale.toFixed(2)}倍</output>
      </label>
      <div className="meld-edit-toolbar__row">
        <span className="meld-edit-toolbar__hint">
          横{Math.round(active.offsetX)}px・縦{Math.round(active.offsetY)}px
        </span>
        <button type="button" className="tile3d-debug-panel__btn" onClick={() => resetRiverSlot(activeSeat)}>
          {SEAT_LABELS[activeSeat]}をリセット
        </button>
      </div>
    </div>
  );
}
