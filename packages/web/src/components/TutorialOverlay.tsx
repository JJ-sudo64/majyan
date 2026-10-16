import { useEffect, useState } from "react";
import { TUTORIAL_SCENARIOS } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";

/** 光らせるボタンの見つけ方（Hand.tsx・CallPrompt.tsxのボタンのクラス）。ツモとロンのボタンは同じクラス。 */
const HINT_BUTTON_SELECTOR = {
  riichi: ".btn--riichi",
  pon: ".btn--call",
  ron: ".btn--ron",
  tsumo: ".btn--ron",
} as const;

/**
 * チュートリアルの案内。台本（core/src/tutorial.ts）の今の案内を画面に重ね、触ってほしい牌・ボタンを
 * 光らせる。光らせるのは、CSSのルールを1つ差し込むだけ（Reactが描く牌・ボタンには触らない）。
 */
export function TutorialOverlay() {
  const tutorial = useGameStore((s) => s.tutorial);
  const tutorialNext = useGameStore((s) => s.tutorialNext);
  const backToTitle = useGameStore((s) => s.backToTitle);
  const [shake, setShake] = useState(0);

  // 台本が許さない操作をされた時、案内をひと揺らしして知らせる。
  const nudge = tutorial?.nudge ?? 0;
  useEffect(() => {
    if (nudge > 0) setShake((n) => n + 1);
  }, [nudge]);

  if (!tutorial) return null;
  const scenario = TUTORIAL_SCENARIOS[tutorial.scenarioIndex];
  const step = scenario?.steps[tutorial.stepIndex];
  const hintRules: string[] = [];
  if (tutorial.visible && step) {
    if (step.hintTile) hintRules.push(`.hand-tiles__real .tile[data-tile-code="${step.hintTile}"] { animation: tutorial-pulse 1s ease-in-out infinite; }`);
    if (step.hintButton) hintRules.push(`${HINT_BUTTON_SELECTOR[step.hintButton]} { animation: tutorial-pulse 1s ease-in-out infinite; }`);
  }

  return (
    <>
      {hintRules.length > 0 && <style>{hintRules.join("\n")}</style>}
      <button type="button" className="tutorial-quit" onClick={backToTitle}>
        チュートリアルをやめる
      </button>
      {tutorial.visible && step && (
        <div key={`${tutorial.scenarioIndex}-${tutorial.stepIndex}-${shake}`} className={`tutorial-panel${step.advance === "result" ? " tutorial-panel--top" : ""}${shake > 0 ? " tutorial-panel--nudge" : ""}`}>
          <div className="tutorial-panel__head">
            チュートリアル {tutorial.scenarioIndex + 1}/{TUTORIAL_SCENARIOS.length}
          </div>
          <p className="tutorial-panel__text">{step.text}</p>
          {step.advance === "next" && (
            <button type="button" className="btn btn--primary tutorial-panel__next" onClick={tutorialNext}>
              次へ
            </button>
          )}
          {step.advance === "action" && <div className="tutorial-panel__wait">↑ 案内のとおりに操作してください</div>}
        </div>
      )}
    </>
  );
}
