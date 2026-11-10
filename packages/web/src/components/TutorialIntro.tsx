import { TUTORIAL_COURSE_START, type TutorialCourse } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";

/** アカウントごとに、最初の案内を出したか（選んだコース／skipped）をこのブラウザに覚えておく。 */
const KEY_PREFIX = "majyan.intro.";

export function introSeen(accountId: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + accountId) !== null;
  } catch {
    // 読めない環境では、毎回出さないよう「出した」扱いにする（案内が繰り返し出て邪魔になるよりまし）。
    return true;
  }
}

function markIntro(accountId: string, value: TutorialCourse | "skipped") {
  try {
    localStorage.setItem(KEY_PREFIX + accountId, value);
  } catch {
    // 保存できなくても、このページを開いている間は出さない（呼び出し側のstateで閉じる）。
  }
}

/**
 * アカウントを作った直後に出す、最初の簡単なチュートリアルの案内。麻雀を知らない人は基本から（打牌・リーチ・
 * ツモ→鳴き→必殺技→カード）、知っている人はこのゲームならではの必殺技とカードの説明からやる。
 * 台本・進行は既存のチュートリアル（core/src/tutorial.ts、store/gameStore.ts）をそのまま使い、ここは
 * コースを選んで始めるだけ。「あとで」でやめることもでき、遊び方の画面の「チュートリアル」からいつでもやり直せる。
 */
export function TutorialIntro({ accountId, onDone }: { accountId: string; onDone: () => void }) {
  const startTutorial = useGameStore((s) => s.startTutorial);

  function choose(course: TutorialCourse) {
    markIntro(accountId, course);
    onDone();
    startTutorial(TUTORIAL_COURSE_START[course]);
  }

  function skip() {
    markIntro(accountId, "skipped");
    onDone();
  }

  return (
    <div className="modal-overlay">
      <div className="tutorial-intro" role="dialog" aria-label="はじめに">
        <h2 className="tutorial-intro__title">はじめに</h2>
        <p className="tutorial-intro__lead">
          遊び方を、実際の画面で触りながら体験できます（数分ほど）。麻雀は知っていますか？
        </p>
        <div className="tutorial-intro__options">
          <button type="button" className="tutorial-intro__option" onClick={() => choose("beginner")}>
            <span className="tutorial-intro__option-name">麻雀を知らない・あまり知らない</span>
            <span className="tutorial-intro__option-desc">牌の捨て方、リーチ、あがり方、鳴き（ポン）を、基本から。そのあと、必殺技とカードも体験します。</span>
            <span className="tutorial-intro__option-meta">4局・約5分</span>
          </button>
          <button type="button" className="tutorial-intro__option tutorial-intro__option--primary" onClick={() => choose("experienced")}>
            <span className="tutorial-intro__option-name">麻雀は知っている</span>
            <span className="tutorial-intro__option-desc">ルールの説明は省いて、このゲームならではの「必殺技」と「カード」の使い方から。</span>
            <span className="tutorial-intro__option-meta">2局・約2分</span>
          </button>
        </div>
        <button type="button" className="tutorial-intro__skip" onClick={skip}>
          あとで（スキップ）
        </button>
        <p className="tutorial-intro__note">あとからでも、プレイ→CPU戦の画面の「チュートリアル」からいつでも体験できます。</p>
      </div>
    </div>
  );
}
