import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";

/**
 * 暗槓表示確認パネル。CPUが実際に暗槓を宣言するのを待たなくても、
 * 下家・対面・上家それぞれの卓上に仮の暗槓（4枚、両端伏せ）を1つ
 * 表示させて見た目を確認できるようにする——他家の暗槓だけ「厚み」の
 * 帯が変な位置に出る不具合の修正を、CPU任せにせず確認したいとの
 * 指摘のため。MeldEditToolbar/HandEditToolbarと同じく、卓を暗転させず
 * 見ながら操作できる非モーダルの小さなツールバーとしてdocument.body直下へ
 * Portalする（Table.tsx参照）。
 */
export function AnkanPreviewPanel() {
  const ankanPreview = useTile3DDebugStore((s) => s.ankanPreview);
  const setAnkanPreview = useTile3DDebugStore((s) => s.setAnkanPreview);
  const setPanelOpen = useTile3DDebugStore((s) => s.setAnkanPreviewPanelOpen);

  return (
    <div className="meld-edit-toolbar ankan-preview-panel">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">暗槓表示確認</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="確認モードを終了" onClick={() => setPanelOpen(false)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">
        ONにした座席の卓上に、仮の暗槓（4枚・両端伏せ）を1つ追加表示します。実際の副露データには一切触れません。
      </div>
      <div className="meld-edit-toolbar__row" role="group" aria-label="暗槓を表示する座席">
        {(
          [
            ["shimocha", "下家"],
            ["toimen", "対面"],
            ["kamicha", "上家"],
          ] as const
        ).map(([seat, label]) => (
          <button
            key={seat}
            type="button"
            className={`tile3d-debug-panel__btn${ankanPreview[seat] ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => setAnkanPreview(seat, !ankanPreview[seat])}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
