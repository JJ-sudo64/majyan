import { CHARACTERS, type PlayerIndex, type RoundState } from "@majyan/core";

/** 必殺技ゲージの表示。溜まり具合をバーで見せ、満タン時は光らせて発動可能を知らせる。 */
export function SkillGauge({ round, player }: { round: RoundState; player: PlayerIndex }) {
  const character = CHARACTERS[round.characterIds[player]];
  if (!character) return null;
  // ゲージを一切消費しないキャラ（ナオキ/トモヒロ等、gaugePerTurn/
  // gaugePerDealInが両方0の完全パッシブ）はバーが満タンまで伸びることが
  // 無いにも関わらず表示だけされると「ボタンが出ないバグ」に見えてしまう
  // ため、そもそも表示しない。onActivate/onRiichiの有無ではなく実際に
  // ゲージが貯まるかどうかで判定する（サキの「特技ドラ引き」のように
  // onActivateもonRiichiも持たずonBeforeDrawだけでゲージ満タン時に自動
  // 発動するキャラも、ゲージ自体は貯まるためバーは表示する）。
  if (character.gaugePerTurn <= 0 && character.gaugePerDealIn <= 0) return null;
  const gauge = round.players[player].skillGauge;
  const pct = Math.min(100, Math.round((gauge / character.gaugeMax) * 100));
  const ready = gauge >= character.gaugeMax;
  return (
    <div className={`skill-gauge${ready ? " skill-gauge--ready" : ""}`} title={character.skill.description}>
      {/* ボタンの説明はホバー時のtitleに任せるとして、バーだけだと
          「これは何のゲージか」が伝わらないとの指摘のため、常時見える
          ラベルとして「必殺技」だけは出しておく（技名まで出すと横長に
          なりすぎるため、名前はready時のボタン側に譲る）。 */}
      <div className="skill-gauge__label">必殺技</div>
      <div className="skill-gauge__bar">
        <div className="skill-gauge__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
