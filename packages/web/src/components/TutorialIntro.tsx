import { TUTORIAL_COURSE_START, type TutorialCourse } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { useT } from "../i18n/index.js";

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
  const t = useT();
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
      <div className="tutorial-intro" role="dialog" aria-label={t("tutorial.introTitle")}>
        <h2 className="tutorial-intro__title">{t("tutorial.introTitle")}</h2>
        <p className="tutorial-intro__lead">
          {t("tutorial.introLead")}
        </p>
        <div className="tutorial-intro__options">
          <button type="button" className="tutorial-intro__option" onClick={() => choose("beginner")}>
            <span className="tutorial-intro__option-name">{t("tutorial.beginnerName")}</span>
            <span className="tutorial-intro__option-desc">{t("tutorial.beginnerDesc")}</span>
            <span className="tutorial-intro__option-meta">{t("tutorial.beginnerMeta")}</span>
          </button>
          <button type="button" className="tutorial-intro__option tutorial-intro__option--primary" onClick={() => choose("experienced")}>
            <span className="tutorial-intro__option-name">{t("tutorial.experiencedName")}</span>
            <span className="tutorial-intro__option-desc">{t("tutorial.experiencedDesc")}</span>
            <span className="tutorial-intro__option-meta">{t("tutorial.experiencedMeta")}</span>
          </button>
        </div>
        <button type="button" className="tutorial-intro__skip" onClick={skip}>
          {t("tutorial.skip")}
        </button>
        <p className="tutorial-intro__note">{t("tutorial.note")}</p>
      </div>
    </div>
  );
}
