import { toimenHandSlotIndex, toimenMeldEachIndex, useTile3DDebugStore } from "../store/tile3dDebugStore.js";

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
  const handSlots = useTile3DDebugStore((s) => s.toimenHandSlots);
  const setHandSlot = useTile3DDebugStore((s) => s.setToimenHandSlot);
  const resetHandSlot = useTile3DDebugStore((s) => s.resetToimenHandSlot);
  const meldSlot = useTile3DDebugStore((s) => s.toimenMeldSlot);
  const setMeldSlot = useTile3DDebugStore((s) => s.setToimenMeldSlot);
  const resetMeldSlot = useTile3DDebugStore((s) => s.resetToimenMeldSlot);

  const meldCount = useTile3DDebugStore((s) => s.toimenEditMeldCount);
  const setMeldCount = useTile3DDebugStore((s) => s.setToimenEditMeldCount);
  const meldEach = useTile3DDebugStore((s) => s.toimenMeldEach);
  const setMeldEach = useTile3DDebugStore((s) => s.setToimenMeldEach);
  const resetMeldEach = useTile3DDebugStore((s) => s.resetToimenMeldEach);
  const activeMeld = useTile3DDebugStore((s) => s.toimenEditActiveMeld);
  const setActiveMeld = useTile3DDebugStore((s) => s.setToimenEditActiveMeld);
  const ankanSlots = useTile3DDebugStore((s) => s.toimenEditAnkanSlots);
  const setAnkanSlot = useTile3DDebugStore((s) => s.setToimenEditAnkanSlot);

  if (!target) return null;
  const isHand = target === "hand";
  const kanCount = ankanSlots.slice(0, meldCount).filter(Boolean).length;
  const eachIndex = toimenMeldEachIndex(activeMeld, !!ankanSlots[activeMeld]);
  const handSlot = handSlots[toimenHandSlotIndex(meldCount, kanCount)]!;
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
      {!isHand && (
        <>
          <div className="meld-edit-toolbar__hint">
            卓上の副露そのものをドラッグすると、その副露だけ動きます（ポンと暗槓は別々に記憶）。副露の外側をドラッグすると全体が動きます
          </div>
          <div className="meld-edit-toolbar__row" role="group" aria-label="個別に動かす副露">
            {ankanSlots.map((isAnkan, i) => (
              <button
                key={i}
                type="button"
                className={`tile3d-debug-panel__btn${activeMeld === i ? " tile3d-debug-panel__btn--active" : ""}`}
                onClick={() => setActiveMeld(i)}
              >
                {i + 1}{isAnkan ? "(暗槓)" : "(ポン)"}
              </button>
            ))}
          </div>
          <div className="meld-edit-toolbar__row">
            <span className="meld-edit-toolbar__hint">
              副露{activeMeld + 1}の個別: 横{Math.round(meldEach[eachIndex]!.offsetX)}px・縦{Math.round(meldEach[eachIndex]!.offsetY)}px
            </span>
            <button type="button" className="tile3d-debug-panel__btn" onClick={() => resetMeldEach(eachIndex)}>
              副露{activeMeld + 1}をリセット
            </button>
          </div>
        </>
      )}
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
