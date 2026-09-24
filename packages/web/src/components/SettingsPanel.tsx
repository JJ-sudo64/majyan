import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../store/settingsStore.js";
import { useTile3DDebugStore } from "../store/tile3dDebugStore.js";
import { useBackgroundDebugStore } from "../store/backgroundDebugStore.js";
import { TABLE_BACKGROUND_OPTIONS, useTableBackgroundStore } from "../store/tableBackgroundStore.js";

/** 自動ツモ切り/自動和了トグルを、対局情報(Hud.tsx)とは切り離して画面左下に
    常設する設定パネル。以前はHudパネル(左上)に同居していたが、対局情報と
    設定操作は役割が異なるため分離した。BGM音量は画面右端の歯車アイコンを
    押した時だけ出るポップオーバーに移した（指摘により）。 */
export function SettingsPanel() {
  const bgmVolume = useSettingsStore((s) => s.bgmVolume);
  const setBgmVolume = useSettingsStore((s) => s.setBgmVolume);
  const seVolume = useSettingsStore((s) => s.seVolume);
  const setSeVolume = useSettingsStore((s) => s.setSeVolume);
  const autoTsumogiri = useSettingsStore((s) => s.autoTsumogiri);
  const setAutoTsumogiri = useSettingsStore((s) => s.setAutoTsumogiri);
  const autoWin = useSettingsStore((s) => s.autoWin);
  const setAutoWin = useSettingsStore((s) => s.setAutoWin);
  const tile3dEnabled = useSettingsStore((s) => s.tile3dEnabled);
  const setTile3dEnabled = useSettingsStore((s) => s.setTile3dEnabled);
  const setActiveTile3DPanel = useTile3DDebugStore((s) => s.setActivePanel);
  const setMeldEditSeat = useTile3DDebugStore((s) => s.setMeldEditSeat);
  const setHandEditSeat = useTile3DDebugStore((s) => s.setHandEditSeat);
  const setAnkanPreviewPanelOpen = useTile3DDebugStore((s) => s.setAnkanPreviewPanelOpen);
  const setRiverEditOpen = useTile3DDebugStore((s) => s.setRiverEditOpen);
  const setRiichiStickEditOpen = useTile3DDebugStore((s) => s.setRiichiStickEditOpen);
  const setNameplateEditOpen = useTile3DDebugStore((s) => s.setNameplateEditOpen);
  const setToimenEditTarget = useTile3DDebugStore((s) => s.setToimenEditTarget);
  const setIsBgPanelOpen = useBackgroundDebugStore((s) => s.setIsPanelOpen);
  const tableBackgroundId = useTableBackgroundStore((s) => s.backgroundId);
  const setTableBackgroundId = useTableBackgroundStore((s) => s.setBackgroundId);
  const tableBackgroundPreviousId = useTableBackgroundStore((s) => s.previousBackgroundId);
  const revertTableBackground = useTableBackgroundStore((s) => s.revertToPrevious);

  const [volumeOpen, setVolumeOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // ポップオーバーの外側をクリックしたら閉じる（歯車自体の再クリックは
  // トグルのままにしたいので、ここではrefの外側かどうかだけ見る）。
  useEffect(() => {
    if (!volumeOpen) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setVolumeOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [volumeOpen]);

  return (
    <>
      <div className="settings-panel">
        <div className="hud__row hud__auto-toggles">
          <button
            type="button"
            className={`hud__toggle-btn${autoTsumogiri ? " hud__toggle-btn--on" : ""}`}
            onClick={() => setAutoTsumogiri(!autoTsumogiri)}
          >
            自動ツモ切り{autoTsumogiri ? " ON" : " OFF"}
          </button>
          <button
            type="button"
            className={`hud__toggle-btn${autoWin ? " hud__toggle-btn--on" : ""}`}
            onClick={() => setAutoWin(!autoWin)}
          >
            自動和了{autoWin ? " ON" : " OFF"}
          </button>
        </div>
      </div>

      {createPortal(
        <div className="volume-gear-wrap" ref={wrapRef}>
          <button
            type="button"
            className="volume-gear"
            aria-label="音量設定"
            aria-expanded={volumeOpen}
            onClick={() => setVolumeOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94a7.14 7.14 0 0 0 .06-.94 7.14 7.14 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.32.66.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.1.52.02.66-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7"
              />
            </svg>
          </button>
          {volumeOpen && (
          <div className="volume-popover">
            <div className="hud__row hud__bgm-volume">
              <span className="hud__dora-label">BGM音量</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={bgmVolume}
                onChange={(e) => setBgmVolume(Number(e.target.value))}
              />
              <span className="hud__bgm-volume__value">{Math.round(bgmVolume * 100)}%</span>
            </div>
            <div className="hud__row hud__bgm-volume">
              <span className="hud__dora-label">SE音量</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={seVolume}
                onChange={(e) => setSeVolume(Number(e.target.value))}
              />
              <span className="hud__bgm-volume__value">{Math.round(seVolume * 100)}%</span>
            </div>
            {/* 立体牌(Tile3D)はCSS 3Dの合成負荷が高く、GPUが弱い/実質
                ハードウェアアクセラレーションが効かない環境では画面が
                真っ白のまま固まって開けなくなる不具合が実機で発覚した
                （ブラウザのGPUプロセスがCPUを食い尽くす）。設定側で
                いつでも2D表示に戻せるようにする。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className={`hud__toggle-btn${tile3dEnabled ? " hud__toggle-btn--on" : ""}`}
                onClick={() => setTile3dEnabled(!tile3dEnabled)}
              >
                立体牌{tile3dEnabled ? " ON" : " OFF"}
              </button>
            </div>
            {/* 立体牌(Tile3D)の調整パネルは、スライダーの数が多く常時
                画面に出しておくと邪魔になる・左下固定だと上家の手牌が
                隠れるとの指摘のため、この設定メニューから開くモーダルに
                した（Tile3DDebugPanel.tsx参照）。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                disabled={!tile3dEnabled}
                onClick={() => {
                  setActiveTile3DPanel("shimocha");
                  setVolumeOpen(false);
                }}
              >
                下家の調整
              </button>
              <button
                type="button"
                className="hud__toggle-btn"
                disabled={!tile3dEnabled}
                onClick={() => {
                  setActiveTile3DPanel("kamicha");
                  setVolumeOpen(false);
                }}
              >
                上家の調整
              </button>
            </div>
            {/* 副露の位置は、別画面の縮小プレビューでは実際の卓の配置と
                一致せず意味がないとの指摘のため、実際の卓の上で副露を
                直接ドラッグして配置する編集モードに変更した
                （MeldEditToolbar.tsx参照）。押すと卓を暗転させない小さな
                ツールバーが出て、卓上の副露自体をつかんで動かせる。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                disabled={!tile3dEnabled}
                onClick={() => {
                  setMeldEditSeat("shimocha");
                  setVolumeOpen(false);
                }}
              >
                副露編集モード
              </button>
            </div>
            {/* 手牌の列全体の位置も、鳴いた副露の数(0〜4)ごとに実際の卓の
                上で直接ドラッグして固定できる（副露編集モードと同じ理由:
                手牌が短くなるたびに位置が変わって見えるとの指摘のため）。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                disabled={!tile3dEnabled}
                onClick={() => {
                  setHandEditSeat("shimocha");
                  setVolumeOpen(false);
                }}
              >
                手牌配置編集モード
              </button>
            </div>
            {/* 他家の暗槓（自分以外）は厚みの帯が変な位置に出る不具合の
                修正確認用。CPUが実際に暗槓を宣言するのを待たなくても、
                座席ごとに仮の暗槓を1つ卓上に表示できる（AnkanPreviewPanel.
                tsx参照）。Tile3D無効時でも対面の確認には使うためtile3d
                Enabledでは無効化しない。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                onClick={() => {
                  setAnkanPreviewPanelOpen(true);
                  setVolumeOpen(false);
                }}
              >
                暗槓表示確認
              </button>
            </div>
            {/* 河・ネームプレートの位置・角度を、自分含む4人全員分、実際の
                卓の上で直接ドラッグして調整できるようにする
                （RiverEditToolbar/NameplateEditToolbar.tsx参照）。副露/
                手牌と違いTile3D非依存（対面・自分も対象）のためtile3d
                Enabledでは無効化しない。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                onClick={() => {
                  setRiverEditOpen(true);
                  setVolumeOpen(false);
                }}
              >
                河の配置編集モード
              </button>
            </div>
            {/* リーチ棒の位置・角度も同じ考え方で編集できる
                （RiichiStickEditToolbar.tsx参照）。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                onClick={() => {
                  setRiichiStickEditOpen(true);
                  setVolumeOpen(false);
                }}
              >
                リーチ棒の配置編集モード
              </button>
            </div>
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                onClick={() => {
                  setNameplateEditOpen(true);
                  setVolumeOpen(false);
                }}
              >
                ネームプレート配置編集モード
              </button>
            </div>
            {/* 対面の手牌・副露は下家/上家と違いTile3D非表示（常に通常の
                2D牌）のため、位置に加えて大きさ(scale)も調整できるように
                する（ToimenEditToolbar.tsx参照）。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                onClick={() => {
                  setToimenEditTarget("hand");
                  setVolumeOpen(false);
                }}
              >
                対面の配置編集モード
              </button>
            </div>
            {/* 卓面背景画像も同じ理由でモーダル化（BackgroundDebugPanel.tsx
                参照）。最初は理論計算で位置合わせしていたが、実機で
                「デカすぎる、自由に調整できるように」との指摘のため、
                実機で動かせるスライダーパネルに変更した。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                onClick={() => {
                  setIsBgPanelOpen(true);
                  setVolumeOpen(false);
                }}
              >
                背景の調整
              </button>
            </div>
            {/* 卓面背景画像そのものの切り替え。今後も背景素材を追加していく
                想定のため、選択肢はtableBackgroundStore.tsのリストに追加
                するだけで増やせる。切り替えた直後だけ「元に戻す」で
                1つ前の画像に戻せる（変だった場合の保険）。 */}
            <div className="hud__row volume-popover__tile3d-row">
              <span className="hud__dora-label">卓の背景</span>
            </div>
            <div className="hud__row volume-popover__tile3d-row volume-popover__bg-row">
              {TABLE_BACKGROUND_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`hud__toggle-btn${tableBackgroundId === opt.id ? " hud__toggle-btn--on" : ""}`}
                  onClick={() => setTableBackgroundId(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="hud__row volume-popover__tile3d-row">
              <button
                type="button"
                className="hud__toggle-btn"
                disabled={!tableBackgroundPreviousId || tableBackgroundPreviousId === tableBackgroundId}
                onClick={() => revertTableBackground()}
              >
                背景を元に戻す
              </button>
            </div>
          </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
