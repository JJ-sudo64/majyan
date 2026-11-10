import { toimenHandSlotIndex, toimenMeldEachIndex, useTile3DDebugStore } from "../store/tile3dDebugStore.js";

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
  const meldEach = useTile3DDebugStore((s) => s.side2dMeldEach);
  const setMeldEach = useTile3DDebugStore((s) => s.setSide2dMeldEach);
  const resetMeldEach = useTile3DDebugStore((s) => s.resetSide2dMeldEach);
  const activeMeld = useTile3DDebugStore((s) => s.side2dEditActiveMeld);
  const setActiveMeld = useTile3DDebugStore((s) => s.setSide2dEditActiveMeld);

  if (!seat) return null;
  const isHand = target === "hand";
  const active = isHand ? handSlots[seat][toimenHandSlotIndex(meldCount, 0)]! : meldSlots[seat];
  const setActive = isHand ? setHandSlot : setMeldSlot;
  const resetActive = isHand ? resetHandSlot : resetMeldSlot;
  const eachIndex = toimenMeldEachIndex(activeMeld, ankanSlots[activeMeld] ?? false);
  const each = meldEach[seat][eachIndex]!;
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
      <div className="meld-edit-toolbar__row" role="group" aria-label="鳴いた副露の数（手牌の位置は副露の数ごとに保存。ポン/カンの違いでは変わらない）">
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
      {!isHand && (
        <div className="meld-edit-toolbar__row" role="group" aria-label="仮表示の副露の種類（押すとポン/暗槓が切り替わる）">
          {ankanSlots.map((isAnkan, i) => (
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
      {!isHand && (
        <div className="meld-edit-toolbar__row" role="group" aria-label="個別に動かす副露（卓上の副露を直接ドラッグしても選べる）">
          <span className="meld-edit-toolbar__hint">1個ずつ:</span>
          {Array.from({ length: Math.max(meldCount, 1) }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`tile3d-debug-panel__btn${activeMeld === i ? " tile3d-debug-panel__btn--active" : ""}`}
              onClick={() => setActiveMeld(i)}
            >
              副露{i + 1}
            </button>
          ))}
        </div>
      )}
      {!isHand && (
        <>
          <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
            <span>副露{activeMeld + 1}・角度</span>
            <input type="range" min={-45} max={45} step={1} value={each.rotate ?? 0} onChange={(e) => setMeldEach(eachIndex, { rotate: Number(e.target.value) })} />
            <output>{(each.rotate ?? 0).toFixed(0)}°</output>
          </label>
          <div className="meld-edit-toolbar__row">
            <span className="meld-edit-toolbar__hint">
              副露{activeMeld + 1}: 横{Math.round(each.offsetX)}px・縦{Math.round(each.offsetY)}px（副露をドラッグで個別に移動）
            </span>
            <button type="button" className="tile3d-debug-panel__btn" onClick={() => resetMeldEach(eachIndex)}>
              この副露をリセット
            </button>
          </div>
        </>
      )}
      <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
        <span>{isHand ? "手牌" : "副露全体"}・角度</span>
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
