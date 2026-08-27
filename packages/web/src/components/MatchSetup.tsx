import { useState } from "react";
import type { AiDifficulty, MatchFormat } from "@majyan/core";
import { useGameStore, type CpuDifficultySettings } from "../store/gameStore.js";

const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  1: "Lv1 初心者",
  2: "Lv2 弱め",
  3: "Lv3 普通",
  4: "Lv4 強め",
  5: "Lv5 最強",
};
const DIFFICULTY_OPTIONS: AiDifficulty[] = [1, 2, 3, 4, 5];

/** OpponentArea.tsxのNAMESと表記を合わせてある（下家→対面→上家の順）。 */
const CPU_SEATS: { player: 1 | 2 | 3; label: string }[] = [
  { player: 1, label: "下家CPU" },
  { player: 2, label: "対面CPU" },
  { player: 3, label: "上家CPU" },
];

export function MatchSetup() {
  const startMatch = useGameStore((s) => s.startMatch);
  const [debugMode, setDebugMode] = useState(false);
  const [cpuDifficulty, setCpuDifficulty] = useState<CpuDifficultySettings>([2, 2, 2, 2]);

  function setSeatDifficulty(player: 1 | 2 | 3, level: AiDifficulty) {
    setCpuDifficulty((prev) => {
      const next = [...prev] as CpuDifficultySettings;
      next[player] = level;
      return next;
    });
  }

  function start(format: MatchFormat) {
    startMatch(format, debugMode, cpuDifficulty);
  }

  return (
    <div className="setup-screen">
      <h1>雀 - 対戦型麻雀</h1>
      <p>CPU3人と対局します。対局形式を選んでください。</p>

      <div className="setup-cpu-difficulty">
        {CPU_SEATS.map(({ player, label }) => (
          <label key={player} className="setup-cpu-difficulty__row">
            <span className="setup-cpu-difficulty__name">{label}</span>
            <select
              value={cpuDifficulty[player]}
              onChange={(e) => setSeatDifficulty(player, Number(e.target.value) as AiDifficulty)}
            >
              {DIFFICULTY_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {DIFFICULTY_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="setup-buttons">
        <button className="btn btn--primary btn--large" onClick={() => start("tonpuusen")}>
          東風戦
        </button>
        <button className="btn btn--primary btn--large" onClick={() => start("hanchan")}>
          半荘戦
        </button>
      </div>
      <label className="setup-debug-toggle">
        <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
        デバッグモード（CPUは和了しない・CPUの手番を早送り・巻き戻し可能）
      </label>
    </div>
  );
}
