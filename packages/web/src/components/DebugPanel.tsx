import { useGameStore } from "../store/gameStore.js";

export function DebugPanel() {
  const debugMode = useGameStore((s) => s.debugMode);
  const debugSpeed = useGameStore((s) => s.debugSpeed);
  const debugPaused = useGameStore((s) => s.debugPaused);
  const historyLength = useGameStore((s) => s.history.length);
  const debugRewind = useGameStore((s) => s.debugRewind);
  const debugSetSpeed = useGameStore((s) => s.debugSetSpeed);
  const debugTogglePause = useGameStore((s) => s.debugTogglePause);
  const backToTitle = useGameStore((s) => s.backToTitle);

  if (!debugMode) return null;

  return (
    <div className="debug-panel">
      <span className="debug-panel__label">
        デバッグモード（{debugPaused ? "一時停止中" : debugSpeed === "fast" ? "早送り中" : "通常速度"}・CPU和了なし）
      </span>
      <button className="btn btn--secondary" onClick={debugTogglePause}>
        {debugPaused ? "▶ 再開" : "⏸ 一時停止"}
      </button>
      <button
        className="btn btn--secondary"
        onClick={() => debugSetSpeed(debugSpeed === "fast" ? "normal" : "fast")}
        disabled={debugPaused}
      >
        {debugSpeed === "fast" ? "🐢 通常速度に" : "⏩ 早送りに"}
      </button>
      <button className="btn btn--secondary" onClick={debugRewind} disabled={historyLength === 0}>
        ⏪ 巻き戻す（{historyLength}）
      </button>
      <button className="btn btn--secondary debug-panel__quit" onClick={backToTitle}>
        ⏹ 途中終了
      </button>
    </div>
  );
}
