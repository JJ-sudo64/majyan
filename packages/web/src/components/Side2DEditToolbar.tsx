import { toimenHandSlotIndex, useTile3DDebugStore } from "../store/tile3dDebugStore.js";

/**
 * 立体牌をOFF（2D表示）にした時の、下家・上家の手牌・副露の位置・大きさを、
 * 実際の卓の上で直接ドラッグ＋スライダーで調整するためのツールバー。
 * 作りは対面の配置編集（ToimenEditToolbar.tsx）と同じで、3D用の値
 * （下家の調整・手牌配置編集モード等）とは別枠に保存される。
 */
export function Side2DEditToolbar() {
  const seat = useTile3DDebugStore((s) => s.side2dEditSeat);
  const target = useTile3DDebugStore((s) => s.side2dEditTarget);
  const setTarget = useTile3DDebugStore((s) => s.setSide2dEditTarget);
  const close = useTile3DDebugStore((s) => s.openSide2dEdit);
  const handSlots = useTile3DDebugStore((s) => s.side2dHandSlots);
  const meldSlots = useTile3DDebugStore((s) => s.side2dMeldSlot);
  const setHandSlot = useTile3DDebugStore((s) => s.setSide2dHandSlot);
  const resetHandSlot = useTile3DDebugStore((s) => s.resetSide2dHandSlot);
  const setMeldSlot = useTile3DDebugStore((s) => s.setSide2dMeldSlot);
  const resetMeldSlot = useTile3DDebugStore((s) => s.resetSide2dMeldSlot);
  const meldCount = useTile3DDebugStore((s) => s.side2dEditMeldCount);
  const setMeldCount = useTile3DDebugStore((s) => s.setSide2dEditMeldCount);
  const ankanSlots = useTile3DDebugStore((s) => s.side2dEditAnkanSlots);
  const setAnkanSlot = useTile3DDebugStore((s) => s.setSide2dEditAnkanSlot);

  if (!seat) return null;
  const isHand = target === "hand";
  const kanCount = ankanSlots.slice(0, meldCount).filter(Boolean).length;
  const active = isHand ? handSlots[seat][toimenHandSlotIndex(meldCount, kanCount)]! : meldSlots[seat];
  const setActive = isHand ? setHandSlot : setMeldSlot;
  const resetActive = isHand ? resetHandSlot : resetMeldSlot;
  const seatName = seat === "shimocha" ? "下家" : "上家";

  return (
    <div className={`meld-edit-toolbar side2d-edit-toolbar side2d-edit-toolbar--${seat}`}>
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">{seatName}の2D配置編集（立体牌OFF用）</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="編集モードを終了" onClick={() => close(null)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">卓上のオレンジ枠をドラッグして配置してください。設定の「立体牌」をOFFにした時の見た目が対象です</div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="編集する対象">
        <button type="button" className={`tile3d-debug-panel__btn${isHand ? " tile3d-debug-panel__btn--active" : ""}`} onClick={() => setTarget("hand")}>
          手牌
        </button>
        <button type="button" className={`tile3d-debug-panel__btn${!isHand ? " tile3d-debug-panel__btn--active" : ""}`} onClick={() => setTarget("meld")}>
          副露
        </button>
      </div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="鳴いた副露の数（手牌の枚数と副露の仮表示が連動し、手牌の位置はこの副露数ごとに保存される）">
        {[0, 1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            className={`tile3d-debug-panel__btn${meldCount === n ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => setMeldCount(n)}
          >
            {n === 0 ? "鳴かず" : `${n}副露`}
          </button>
        ))}
      </div>
      {(!isHand || meldCount > 0) && (
        <div className="meld-edit-toolbar__row" role="group" aria-label="仮表示の副露の種類（押すとポン/暗槓が切り替わる。手牌の位置は暗槓の数ごとに保存される）">
          {ankanSlots.slice(0, isHand ? meldCount : ankanSlots.length).map((isAnkan, i) => (
            <button
              key={i}
              type="button"
              className={`tile3d-debug-panel__btn${isAnkan ? " tile3d-debug-panel__btn--active" : ""}`}
              onClick={() => setAnkanSlot(i, !isAnkan)}
            >
              副露{i + 1}: {isAnkan ? "暗槓" : "ポン"}
            </button>
          ))}
        </div>
      )}
      <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
        <span>{isHand ? "手牌" : "副露"}・大きさ</span>
        <input type="range" min={0.5} max={2} step={0.05} value={active.scale} onChange={(e) => setActive({ scale: Number(e.target.value) })} />
        <output>{active.scale.toFixed(2)}倍</output>
      </label>
      <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
        <span>{isHand ? "手牌" : "副露"}・角度</span>
        <input type="range" min={-45} max={45} step={1} value={active.rotate ?? 0} onChange={(e) => setActive({ rotate: Number(e.target.value) })} />
        <output>{(active.rotate ?? 0).toFixed(0)}°</output>
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
