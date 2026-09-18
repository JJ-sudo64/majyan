import { HAND_GROUP_SLOT_COUNT, useTile3DDebugStore } from "../store/tile3dDebugStore.js";

/**
 * 手牌配置編集モードの操作パネル。副露配置編集(MeldEditToolbar.tsx)と
 * 全く同じ考え方——手牌が短くなるたびに位置が変わって見える(sync()が
 * 実際の枚数を元に再計算するため)という指摘を受け、「鳴いていない/
 * 1副露/2副露/3副露/4副露」の5状態それぞれについて、実際の卓の上で
 * 手牌の塊を直接ドラッグして位置を固定できるようにした。
 *
 * 選択した状態を編集中は、OpponentArea.tsx側で実際の手牌データの代わりに
 * 「その副露数だった場合の仮の手牌（枚数だけ正しい、絵柄はダミー）」を
 * 表示する——別画面のプレビューではなく、本物の卓の空間・本物のCSSで
 * 見ながら配置したいという副露配置編集と同じ理由。副露の仮表示も同時に
 * 出るため、副露と手牌の位置関係も含めて確認しながら配置できる。
 */
export function HandEditToolbar() {
  const handEditSeat = useTile3DDebugStore((s) => s.handEditSeat);
  const setHandEditSeat = useTile3DDebugStore((s) => s.setHandEditSeat);
  const handEditMeldCount = useTile3DDebugStore((s) => s.handEditMeldCount);
  const setHandEditMeldCount = useTile3DDebugStore((s) => s.setHandEditMeldCount);
  const setHandGroupSlot = useTile3DDebugStore((s) => s.setHandGroupSlot);
  const resetHandGroupSlot = useTile3DDebugStore((s) => s.resetHandGroupSlot);
  const shimochaGroups = useTile3DDebugStore((s) => s.handGroupByMeldCount);
  const kamichaGroups = useTile3DDebugStore((s) => s.kamichaHandGroupByMeldCount);

  if (!handEditSeat) return null;
  const isKamicha = handEditSeat === "kamicha";
  const groups = isKamicha ? kamichaGroups : shimochaGroups;
  const active = groups[handEditMeldCount]!;

  return (
    <div className="meld-edit-toolbar hand-edit-toolbar">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">手牌配置編集: {isKamicha ? "上家" : "下家"}</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="編集モードを終了" onClick={() => setHandEditSeat(null)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">卓上の手牌の塊（オレンジ枠）をドラッグして配置してください</div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="編集する座席">
        <button
          type="button"
          className={`tile3d-debug-panel__btn${!isKamicha ? " tile3d-debug-panel__btn--active" : ""}`}
          onClick={() => setHandEditSeat("shimocha")}
        >
          下家
        </button>
        <button
          type="button"
          className={`tile3d-debug-panel__btn${isKamicha ? " tile3d-debug-panel__btn--active" : ""}`}
          onClick={() => setHandEditSeat("kamicha")}
        >
          上家
        </button>
      </div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="鳴いた副露の数">
        {Array.from({ length: HAND_GROUP_SLOT_COUNT }, (_, n) => n).map((n) => (
          <button
            key={n}
            type="button"
            className={`tile3d-debug-panel__btn${handEditMeldCount === n ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => setHandEditMeldCount(n)}
          >
            {n === 0 ? "鳴かず" : `${n}副露`}
          </button>
        ))}
      </div>
      <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
        <span>傾き</span>
        <input
          type="range"
          min={-45}
          max={45}
          step={1}
          value={active.rotate}
          onChange={(e) => setHandGroupSlot(isKamicha, handEditMeldCount, { rotate: Number(e.target.value) })}
        />
        <output>{active.rotate}°</output>
      </label>
      <div className="meld-edit-toolbar__row">
        <span className="meld-edit-toolbar__hint">
          横{Math.round(active.offsetX)}px・縦{Math.round(active.offsetY)}px
        </span>
        <button type="button" className="tile3d-debug-panel__btn" onClick={() => resetHandGroupSlot(isKamicha, handEditMeldCount)}>
          この状態をリセット
        </button>
      </div>
    </div>
  );
}
