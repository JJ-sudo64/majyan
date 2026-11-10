import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";
import { MELD_KIND_LABEL, nextMeldKind } from "../meldKind.js";

/**
 * 自分の副露の見え方の確認パネル。他家の配置編集と違い、自分の手牌・副露は位置の調整はできず、
 * 「鳴いた後にどう見えるか」だけを確かめるためのもの。開いている間、自分の手牌の横に仮の副露
 * （ポン・暗槓・加槓）を指定の数だけ並べ、手牌もその数ぶん短くして表示する。
 * 実際の副露データには一切触れない（Hand.tsx参照）。卓を暗転させず見ながら操作できる
 * 非モーダルの小さなツールバーとして、他の編集パネルと同じくdocument.body直下へPortalする（Table.tsx参照）。
 */
export function SelfMeldPreviewPanel() {
  const setOpen = useTile3DDebugStore((s) => s.setSelfMeldPreviewOpen);
  const count = useTile3DDebugStore((s) => s.selfMeldPreviewCount);
  const setCount = useTile3DDebugStore((s) => s.setSelfMeldPreviewCount);
  const kinds = useTile3DDebugStore((s) => s.selfMeldPreviewKinds);
  const setKind = useTile3DDebugStore((s) => s.setSelfMeldPreviewKind);

  return (
    <div className="meld-edit-toolbar self-meld-preview-panel">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">自分の副露の見え方</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="確認モードを終了" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">
        自分の手牌の横に、仮の副露を並べて表示します。実際の副露データには一切触れません（位置の調整はできません）。
      </div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="仮表示する副露の数">
        {[0, 1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            className={`tile3d-debug-panel__btn${count === n ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => setCount(n)}
          >
            {n === 0 ? "なし" : `${n}個`}
          </button>
        ))}
      </div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="仮表示の副露の種類（押すとポン→暗槓→加槓の順に切り替わる）">
        {kinds.slice(0, Math.max(count, 1)).map((kind, i) => (
          <button
            key={i}
            type="button"
            className={`tile3d-debug-panel__btn${kind !== "pon" ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => setKind(i, nextMeldKind(kind))}
          >
            副露{i + 1}: {MELD_KIND_LABEL[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}
