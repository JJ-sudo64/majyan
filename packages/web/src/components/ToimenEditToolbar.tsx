import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";

/**
 * 対面(player2)の手牌・副露の位置・大きさを、実際の卓の上で直接ドラッグ
 * ＋スライダーで調整するためのツールバー。下家・上家と違いTile3D非表示
 * （常に通常の2D牌）で、鳴き数ごとの状態分岐も無いため、MeldEditToolbar等
 * よりシンプルに「手牌全体」「副露全体」の2つの対象を切り替えるだけの
 * 構造にした。
 */
export function ToimenEditToolbar() {
  const target = useTile3DDebugStore((s) => s.toimenEditTarget);
  const setTarget = useTile3DDebugStore((s) => s.setToimenEditTarget);
  const handSlot = useTile3DDebugStore((s) => s.toimenHandSlot);
  const setHandSlot = useTile3DDebugStore((s) => s.setToimenHandSlot);
  const resetHandSlot = useTile3DDebugStore((s) => s.resetToimenHandSlot);
  const meldSlot = useTile3DDebugStore((s) => s.toimenMeldSlot);
  const setMeldSlot = useTile3DDebugStore((s) => s.setToimenMeldSlot);
  const resetMeldSlot = useTile3DDebugStore((s) => s.resetToimenMeldSlot);

  if (!target) return null;
  const isHand = target === "hand";
  const active = isHand ? handSlot : meldSlot;
  const setActive = isHand ? setHandSlot : setMeldSlot;
  const resetActive = isHand ? resetHandSlot : resetMeldSlot;

  return (
    <div className="meld-edit-toolbar toimen-edit-toolbar">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">対面の配置編集</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="編集モードを終了" onClick={() => setTarget(null)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">卓上のオレンジ枠をドラッグして配置してください</div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="編集する対象">
        <button type="button" className={`tile3d-debug-panel__btn${isHand ? " tile3d-debug-panel__btn--active" : ""}`} onClick={() => setTarget("hand")}>
          手牌
        </button>
        <button type="button" className={`tile3d-debug-panel__btn${!isHand ? " tile3d-debug-panel__btn--active" : ""}`} onClick={() => setTarget("meld")}>
          副露
        </button>
      </div>
      <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
        <span>{isHand ? "手牌" : "副露"}・大きさ</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={active.scale}
          onChange={(e) => setActive({ scale: Number(e.target.value) })}
        />
        <output>{active.scale.toFixed(2)}倍</output>
      </label>
      <div className="meld-edit-toolbar__row">
        <span className="meld-edit-toolbar__hint">
          横{Math.round(active.offsetX)}px・縦{Math.round(active.offsetY)}px
        </span>
        <button type="button" className="tile3d-debug-panel__btn" onClick={() => resetActive()}>
          {isHand ? "手牌" : "副露"}をリセット
        </button>
      </div>
    </div>
  );
}
