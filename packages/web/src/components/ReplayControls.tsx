import { useEffect, useState } from "react";
import type { PlayerIndex } from "@majyan/core";
import { replayLastStep, useGameStore } from "../store/gameStore.js";

const WIND = ["", "東", "南", "西", "北"];
/** 自動再生で1手進める間隔。 */
const AUTO_PLAY_MS = 900;

/** 牌譜の再生中、画面の下に出す操作バー（1手ずつ・局送り・自動再生・視点切り替え）。 */
export function ReplayControls() {
  const replay = useGameStore((s) => s.replay);
  const step = useGameStore((s) => s.replayStep);
  const gotoRound = useGameStore((s) => s.replayGotoRound);
  const setViewer = useGameStore((s) => s.replaySetViewer);
  const toggleReveal = useGameStore((s) => s.replayToggleRevealAll);
  const backToTitle = useGameStore((s) => s.backToTitle);
  const [playing, setPlaying] = useState(false);

  const atEnd = !!replay && replay.step >= replayLastStep(replay);
  useEffect(() => {
    if (!playing) return;
    // 局の終わり（結果画面）まで来たら止める。次の局へは結果画面のボタンか▶で進む。
    if (atEnd) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => step(1), AUTO_PLAY_MS);
    return () => window.clearTimeout(id);
  }, [playing, atEnd, replay?.step, replay?.roundIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === " ") setPlaying((p) => !p);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (!replay) return null;
  const start = replay.frames.states[0]!.round;
  const total = replayLastStep(replay);

  return (
    <div className="replay-controls" onClick={(e) => e.stopPropagation()}>
      <div className="replay-controls__info">
        <strong>
          {WIND[start.roundWind]}
          {start.roundNumber}局 {start.honba}本場
        </strong>
        <span>
          {replay.roundIndex + 1}/{replay.data.rounds.length}局目・{Math.min(replay.step, total)}/{total}手
        </span>
      </div>
      <div className="replay-controls__buttons">
        <button type="button" className="btn" disabled={replay.roundIndex === 0} onClick={() => gotoRound(replay.roundIndex - 1)} title="前の局">
          ⏮
        </button>
        <button type="button" className="btn" onClick={() => step(-1)} title="1手戻す（←）">
          ◀
        </button>
        <button type="button" className="btn btn--primary" onClick={() => setPlaying((p) => !p)} title="自動再生（スペース）">
          {playing ? "■ 停止" : "▶ 再生"}
        </button>
        <button type="button" className="btn" onClick={() => step(1)} title="1手進める（→）">
          ▶
        </button>
        <button
          type="button"
          className="btn"
          disabled={replay.roundIndex + 1 >= replay.data.rounds.length}
          onClick={() => gotoRound(replay.roundIndex + 1)}
          title="次の局"
        >
          ⏭
        </button>
      </div>
      <div className="replay-controls__buttons">
        <label className="replay-controls__viewer">
          視点
          <select value={replay.viewer} onChange={(e) => setViewer(Number(e.target.value) as PlayerIndex)}>
            {replay.data.seats.map((s, i) => (
              <option key={i} value={i}>
                {s.name}
                {i === replay.data.yourSeat ? "（あなた）" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={`btn${replay.revealAll ? " btn--primary" : ""}`} onClick={toggleReveal}>
          全員の手牌
        </button>
        <button type="button" className="btn btn--secondary" onClick={backToTitle}>
          終了
        </button>
      </div>
    </div>
  );
}
