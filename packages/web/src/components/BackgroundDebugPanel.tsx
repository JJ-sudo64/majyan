import { useState } from "react";
import { useBackgroundDebugStore, type BackgroundDebugState } from "../store/backgroundDebugStore.js";

// Tile3DDebugPanel.tsxと同じ理由・同じ実装パターン（詳細なコメントは
// そちら参照）。localStorageがポート変更等で失われても調整値だけは
// 絶対に取り戻せるよう、ストアの中身をテキストで手元にコピー/復元
// できるようにする。
function exportSettingsJson(): string {
  const state = useBackgroundDebugStore.getState() as unknown as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (typeof state[key] !== "function") {
      data[key] = state[key];
    }
  }
  return JSON.stringify(data);
}

function importSettingsJson(json: string): void {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") throw new Error("not an object");
  const state = useBackgroundDebugStore.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) {
    if (key in state && typeof state[key] !== "function") {
      patch[key] = parsed[key];
    }
  }
  useBackgroundDebugStore.setState(patch as Partial<BackgroundDebugState>);
}

/**
 * 卓面背景画像(.table-surface、public/table/以下、tableBackgroundStore.tsで選択中の画像)の
 * サイズ・位置と、中央パネル(.center-board)の位置・拡大率を、実際の
 * 対局画面を見ながらその場で調整するためのデバッグパネル。
 *
 * 最初はピクセル解析で画像内の表示板位置を理論計算し、CSSに固定値として
 * 埋め込んでいたが、ユーザーから「全然ダメ、デカすぎる」と指摘され、
 * 理論値だけで正しい配置を当てるのは信頼できないと判明した。
 * Tile3DDebugPanelと同じ考え方で、SettingsPanel(歯車)の「背景の調整」
 * から開くモーダルとして実装している。
 */
export function BackgroundDebugPanel({ onClose }: { onClose: () => void }) {
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const bgScale = useBackgroundDebugStore((s) => s.bgScale);
  const bgPosX = useBackgroundDebugStore((s) => s.bgPosX);
  const bgPosY = useBackgroundDebugStore((s) => s.bgPosY);
  const centerBoardOffsetX = useBackgroundDebugStore((s) => s.centerBoardOffsetX);
  const centerBoardOffsetY = useBackgroundDebugStore((s) => s.centerBoardOffsetY);
  const centerBoardScale = useBackgroundDebugStore((s) => s.centerBoardScale);
  const setBgScale = useBackgroundDebugStore((s) => s.setBgScale);
  const setBgPosX = useBackgroundDebugStore((s) => s.setBgPosX);
  const setBgPosY = useBackgroundDebugStore((s) => s.setBgPosY);
  const setCenterBoardOffsetX = useBackgroundDebugStore((s) => s.setCenterBoardOffsetX);
  const setCenterBoardOffsetY = useBackgroundDebugStore((s) => s.setCenterBoardOffsetY);
  const setCenterBoardScale = useBackgroundDebugStore((s) => s.setCenterBoardScale);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportSettingsJson());
      setBackupStatus("コピーしました（メモ帳等に保存してください）");
    } catch {
      setBackupStatus("コピーに失敗しました（ブラウザの権限を確認してください）");
    }
    setTimeout(() => setBackupStatus(null), 4000);
  };
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      importSettingsJson(text);
      setBackupStatus("復元しました");
    } catch {
      setBackupStatus("復元に失敗しました（コピーした文字列がクリップボードにあるか確認してください）");
    }
    setTimeout(() => setBackupStatus(null), 4000);
  };

  return (
    <div className="tile3d-debug-overlay" onClick={onClose}>
      <div className="tile3d-debug-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tile3d-debug-panel__header">
          <div className="tile3d-debug-panel__title">卓面背景の調整</div>
          <button type="button" className="tile3d-debug-panel__close" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="tile3d-debug-panel__row">
          <span>背景・拡大</span>
          <input type="range" min={20} max={300} step={1} value={bgScale} onChange={(e) => setBgScale(Number(e.target.value))} />
          <output>{bgScale}%</output>
        </label>
        {/* 横/縦は中心からのpxオフセット。以前は%指定で、background-sizeが
            ちょうど100%の時は画像がコンテナぴったりに収まり動かす余地が
            無いため「縦が全然下がらない」不具合になっていた
            （backgroundDebugStore.ts参照）。pxオフセット方式なら拡大率に
            関係なく常に動き、範囲も画面の外まで大きく振れるよう
            -600〜600pxに広げてある。 */}
        <label className="tile3d-debug-panel__row">
          <span>背景・横</span>
          <input type="range" min={-600} max={600} step={1} value={bgPosX} onChange={(e) => setBgPosX(Number(e.target.value))} />
          <output>{bgPosX}px</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>背景・縦</span>
          <input type="range" min={-600} max={600} step={1} value={bgPosY} onChange={(e) => setBgPosY(Number(e.target.value))} />
          <output>{bgPosY}px</output>
        </label>

        {/* 中央パネル(.center-board、点数・局情報のUI)を背景画像内の
            表示板の絵に重ねるための調整。背景側(bgScale/bgPosX/Y)を
            動かすとこちらも合わせて動かす必要が出るため、同じパネルに
            まとめてある。 */}
        <label className="tile3d-debug-panel__row tile3d-debug-panel__row--group-offset">
          <span>表示板・拡大</span>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.01}
            value={centerBoardScale}
            onChange={(e) => setCenterBoardScale(Number(e.target.value))}
          />
          <output>{centerBoardScale.toFixed(2)}x</output>
        </label>
        <label className="tile3d-debug-panel__row tile3d-debug-panel__row--group-offset">
          <span>表示板・横</span>
          <input
            type="range"
            min={-200}
            max={200}
            step={1}
            value={centerBoardOffsetX}
            onChange={(e) => setCenterBoardOffsetX(Number(e.target.value))}
          />
          <output>{centerBoardOffsetX}px</output>
        </label>
        <label className="tile3d-debug-panel__row tile3d-debug-panel__row--group-offset">
          <span>表示板・縦</span>
          <input
            type="range"
            min={-200}
            max={200}
            step={1}
            value={centerBoardOffsetY}
            onChange={(e) => setCenterBoardOffsetY(Number(e.target.value))}
          />
          <output>{centerBoardOffsetY}px</output>
        </label>

        {/* localStorageが何らかの理由（ポート変更、ブラウザのキャッシュ
            クリア等）で失われても調整値だけは絶対に取り戻せるよう、独立
            したテキストバックアップを手元に持てるようにする
            （Tile3DDebugPanelと同じ仕組み）。 */}
        <div className="tile3d-debug-panel__group" role="group" aria-label="バックアップ">
          <button type="button" className="tile3d-debug-panel__btn" onClick={handleCopy}>
            設定をコピー
          </button>
          <button type="button" className="tile3d-debug-panel__btn" onClick={handlePaste}>
            設定を貼り付け
          </button>
        </div>
        {backupStatus && <div className="tile3d-debug-panel__backup-status">{backupStatus}</div>}
      </div>
    </div>
  );
}
