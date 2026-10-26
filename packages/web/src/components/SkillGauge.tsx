import { useEffect, useRef, useState } from "react";
import { CHARACTERS, type PlayerIndex, type RoundState } from "@majyan/core";

/** 必殺技ゲージの表示。溜まり具合をバーで見せ、満タン時は光らせて発動可能を知らせる。 */
export function SkillGauge({ round, player }: { round: RoundState; player: PlayerIndex }) {
  const readyNow = (() => {
    const c = CHARACTERS[round.characterIds[player]];
    return !!c && round.players[player].skillGauge >= c.gaugeMax;
  })();
  // 満タンになった瞬間だけ短い爆発演出（.skill-gauge--burst）を出す。表示し始めた時点で既に満タンなら出さない。
  const [burst, setBurst] = useState(false);
  const prevReadyRef = useRef(readyNow);
  useEffect(() => {
    if (readyNow && !prevReadyRef.current) {
      setBurst(true);
      const t = setTimeout(() => setBurst(false), 1400);
      prevReadyRef.current = readyNow;
      return () => clearTimeout(t);
    }
    prevReadyRef.current = readyNow;
  }, [readyNow]);
  const character = CHARACTERS[round.characterIds[player]];
  if (!character) return null;
  // ゲージを一切消費しないキャラ（ナオト/トモヒコ等、gaugePerTurn/
  // gaugePerDealInが両方0の完全パッシブ）はバーが満タンまで伸びることが
  // 無いにも関わらず表示だけされると「ボタンが出ないバグ」に見えてしまう
  // ため、そもそも表示しない。onActivate/onRiichiの有無ではなく実際に
  // ゲージが貯まるかどうかで判定する（マキの「特技ドラ引き」のように
  // onActivateもonRiichiも持たずonBeforeDrawだけでゲージ満タン時に自動
  // 発動するキャラも、ゲージ自体は貯まるためバーは表示する）。
  if (character.gaugePerTurn <= 0 && character.gaugePerDealIn <= 0) return null;
  const gauge = round.players[player].skillGauge;
  const pct = Math.min(100, Math.round((gauge / character.gaugeMax) * 100));
  const ready = gauge >= character.gaugeMax;
  return (
    <div className={`skill-gauge${ready ? " skill-gauge--ready" : ""}${burst ? " skill-gauge--burst" : ""}`} title={character.skill.description}>
      {/* ボタンの説明はホバー時のtitleに任せるとして、バーだけだと
          「これは何のゲージか」が伝わらないとの指摘のため、常時見える
          ラベルとして「必殺技」だけは出しておく（技名まで出すと横長に
          なりすぎるため、名前はready時のボタン側に譲る）。 */}
      <div className="skill-gauge__label">{ready ? "必殺技 READY!" : "必殺技"}</div>
      <div className="skill-gauge__bar">
        <div className="skill-gauge__fill" style={{ width: `${pct}%` }} />
        <div className="skill-gauge__ticks" />
      </div>
      {burst && (
        <div className="skill-gauge__burst" aria-hidden>
          <span className="skill-gauge__ring" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <span key={i} className="skill-gauge__spark" style={{ ["--a" as string]: `${i * 45}deg` }} />
          ))}
        </div>
      )}
    </div>
  );
}
