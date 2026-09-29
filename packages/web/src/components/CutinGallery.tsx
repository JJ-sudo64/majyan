import { useEffect, useState } from "react";
import { CHARACTERS } from "@majyan/core";
import { DeclarationCutinView, characterCutin, type Declaration } from "./DeclarationCutinOverlay.js";
import { SkillActivationView } from "./SkillActivationOverlay.js";

/**
 * 全キャラのリーチ・ツモ・ロン・必殺技カットインを、対局中と同じ部品・CSSで
 * 並べて見比べるための確認用ページ（URLに ?cutin-gallery を付けて開く。
 * キャラ選択画面のデバッグモードの下のボタンからも開ける）。
 * 各コマは ?cutin-frame=キャラID&kind=種類 のiframeで、iframeの中が1つの
 * 画面になる。カットインは卓ではなく画面全体に出るので、iframeはこのページを
 * 開いているブラウザの窓と同じ大きさで描いてから縮小する（＝自分の画面で
 * 実際に出る見え方になる）。
 */

type Kind = Declaration | "skill";

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "riichi", label: "リーチ" },
  { kind: "tsumo", label: "ツモ" },
  { kind: "ron", label: "ロン" },
  { kind: "skill", label: "必殺技" },
];

/** 繰り返し再生の間隔。演出の長さ(DeclarationCutinOverlay/SkillActivationOverlayのDISPLAY_MS)に少し間を足したもの。 */
const LOOP_MS: Record<Kind, number> = { riichi: 2200, tsumo: 2800, ron: 2800, skill: 2300 };

/** 一覧の1コマの表示幅(px)。iframeは実寸で描いてから縮小する。 */
const THUMB_WIDTH = 260;

export function CutinGallery() {
  const screen = useWindowSize();
  const [playing, setPlaying] = useState(false);
  // コマをクリックした時に、そのコマだけ再生し直すための番号。
  const [replay, setReplay] = useState<Record<string, number>>({});
  const scale = THUMB_WIDTH / screen.w;
  const thumbHeight = Math.round(screen.h * scale);

  return (
    <div className="cutin-gallery">
      <header className="cutin-gallery__header">
        <h1>カットイン一覧</h1>
        <label>
          <input type="checkbox" checked={playing} onChange={(e) => setPlaying(e.target.checked)} />
          アニメーションを繰り返し再生（オフなら表示中の一瞬で止める）
        </label>
        <span className="cutin-gallery__hint">コマをクリックすると、そのコマだけ最初から再生します。</span>
      </header>
      <table className="cutin-gallery__table">
        <thead>
          <tr>
            <th />
            {KINDS.map((k) => (
              <th key={k.kind}>{k.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.values(CHARACTERS).map((character) => (
            <tr key={character.id}>
              <th className="cutin-gallery__name">{character.name}</th>
              {KINDS.map(({ kind }) => {
                const id = `${character.id}-${kind}`;
                const exists = kind === "skill" || characterCutin(character.id, kind) !== null;
                if (!exists) {
                  return (
                    <td key={kind}>
                      <div className="cutin-gallery__missing" style={{ width: THUMB_WIDTH, height: thumbHeight }}>
                        絵なし
                      </div>
                    </td>
                  );
                }
                const mode = playing ? "loop" : replay[id] ? "once" : "still";
                return (
                  <td key={kind}>
                    <div
                      className="cutin-gallery__thumb"
                      style={{ width: THUMB_WIDTH, height: thumbHeight }}
                      onClick={() => setReplay((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }))}
                    >
                      <iframe
                        key={`${mode}-${replay[id] ?? 0}`}
                        title={id}
                        loading="lazy"
                        src={`?cutin-frame=${character.id}&kind=${kind}&mode=${mode}`}
                        width={screen.w}
                        height={screen.h}
                        style={{ transform: `scale(${scale})` }}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ブラウザの窓の大きさ。窓の大きさを変えるとiframeの大きさも変わり、中身もそれに合わせて描き直される。 */
function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/**
 * 一覧の1コマ（iframeの中身）。mode=stillならアニメーションを表示中の一瞬で
 * 止め、onceなら1回再生してから止め絵に戻り、loopなら繰り返し再生する。
 */
export function CutinFrame({ characterId, kind, mode }: { characterId: string; kind: Kind; mode: string }) {
  const [round, setRound] = useState(0);
  // 1回再生(once)は、演出が最後に消えたままにならないよう、終わったら止め絵に戻す。
  const [still, setStill] = useState(mode === "still");
  useEffect(() => {
    if (mode === "loop") {
      const timer = setInterval(() => setRound((r) => r + 1), LOOP_MS[kind]);
      return () => clearInterval(timer);
    }
    if (mode === "once") {
      const timer = setTimeout(() => setStill(true), LOOP_MS[kind]);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [mode, kind]);
  const character = CHARACTERS[characterId];
  if (!character) return null;
  const cutin = kind === "skill" ? null : characterCutin(characterId, kind);
  const view = kind === "skill" ? <SkillActivationView character={character} /> : cutin && <DeclarationCutinView cutin={cutin} />;
  return (
    <div className={`cutin-frame${still ? " cutin-frame--still" : ""}`} key={`${round}-${still}`}>
      {view}
    </div>
  );
}
