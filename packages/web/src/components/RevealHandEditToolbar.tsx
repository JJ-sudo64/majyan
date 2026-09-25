import { useTile3DDebugStore, type RevealSeat } from "../store/tile3dDebugStore.js";

const SEATS: ReadonlyArray<readonly [RevealSeat, string]> = [
  ["shimocha", "下家"],
  ["toimen", "対面"],
  ["kamicha", "上家"],
];

/**
 * カゲロウの「透視の術」やジンの「大明立直」(オープンリーチ)で公開された
 * 他家の手牌の角度・位置を、実際の卓を見ながら調整するツールバー。位置は
 * 卓上の手牌(オレンジ枠)を直接ドラッグしても、スライダーでも動かせる。
 * スキルの発動を待たなくても確認できるよう、座席ごとに「公開表示」を
 * 強制するプレビューも持つ（編集モードを閉じると解除される）。
 */
export function RevealHandEditToolbar() {
  const rotate = useTile3DDebugStore((s) => s.revealHandRotate);
  const setRotate = useTile3DDebugStore((s) => s.setRevealHandRotate);
  const preview = useTile3DDebugStore((s) => s.revealPreview);
  const setPreview = useTile3DDebugStore((s) => s.setRevealPreview);
  const setOpen = useTile3DDebugStore((s) => s.setRevealEditOpen);
  const offset = useTile3DDebugStore((s) => s.revealHandOffset);
  const setOffset = useTile3DDebugStore((s) => s.setRevealHandOffset);

  return (
    <div className="meld-edit-toolbar reveal-hand-edit-toolbar">
      <div className="meld-edit-toolbar__header">
        <span className="meld-edit-toolbar__title">公開手牌の角度・位置</span>
        <button type="button" className="tile3d-debug-panel__close" aria-label="編集モードを終了" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <div className="meld-edit-toolbar__hint">
        「公開表示」をONにした座席は、スキル発動中でなくても手牌を公開状態で表示します（閉じると元に戻ります）。公開中の手牌は卓上でドラッグして移動できます。
      </div>
      {SEATS.map(([seat, label]) => (
        <div key={seat} className="reveal-hand-edit-toolbar__seat">
          <div className="meld-edit-toolbar__row">
            <button
              type="button"
              className={`tile3d-debug-panel__btn${preview[seat] ? " tile3d-debug-panel__btn--active" : ""}`}
              onClick={() => setPreview(seat, !preview[seat])}
            >
              {label}を公開表示
            </button>
            <button
              type="button"
              className="tile3d-debug-panel__btn"
              onClick={() => {
                setRotate(seat, 0);
                setOffset(seat, { x: 0, y: 0 });
              }}
            >
              {label}をリセット
            </button>
          </div>
          <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
            <span>角度</span>
            <input type="range" min={-90} max={90} step={1} value={rotate[seat]} onChange={(e) => setRotate(seat, Number(e.target.value))} />
            <output>{rotate[seat]}°</output>
          </label>
          <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
            <span>横</span>
            <input type="range" min={-400} max={400} step={1} value={offset[seat].x} onChange={(e) => setOffset(seat, { x: Number(e.target.value) })} />
            <output>{offset[seat].x}px</output>
          </label>
          <label className="meld-edit-toolbar__row meld-edit-toolbar__row--rotate">
            <span>縦</span>
            <input type="range" min={-400} max={400} step={1} value={offset[seat].y} onChange={(e) => setOffset(seat, { y: Number(e.target.value) })} />
            <output>{offset[seat].y}px</output>
          </label>
        </div>
      ))}
    </div>
  );
}
