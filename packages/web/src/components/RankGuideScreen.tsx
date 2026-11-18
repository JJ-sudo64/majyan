import { Fragment, useState } from "react";
import { RANK_TIERS, rankLabel, rankMaxPoints, rankPointDelta, type MatchFormat, type RankState, type RankView } from "@majyan/core";
import { useT } from "../i18n/index.js";

const PLACES = [1, 2, 3, 4] as const;
/** 持ち点による増減が0になる点数（順位による増減だけを取り出すのに使う）。 */
const BASE_SCORE = 25000;

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0";
}

function deltaClass(n: number): string {
  return n > 0 ? " is-plus" : n < 0 ? " is-minus" : "";
}

/** 表の1行ぶん（1つの段）。 */
function ladderRows(): RankState[] {
  return RANK_TIERS.flatMap((tier, t) => Array.from({ length: Math.max(1, tier.levelMax.length) }, (_, level) => ({ tier: t, level, points: 0 })));
}

/** 段位のしくみを表で見せる。数値はcoreのranked.tsからそのまま出す。 */
export function RankGuideScreen({ rank, onClose }: { rank: RankView | null; onClose: () => void }) {
  const t = useT();
  const [format, setFormat] = useState<MatchFormat>("tonpuusen");
  const rows = ladderRows();
  const isMine = (r: RankState) => !!rank && rank.tier === r.tier && rank.level === r.level;
  // 例に使う段（自分の段。まだ分からなければ最初の段）。
  const sample: RankState = rank ?? rows[0]!;
  const sampleScore = 35000;
  const samplePlacement = rankPointDelta(sample, format, 1, BASE_SCORE);
  const sampleTotal = rankPointDelta(sample, format, 1, sampleScore);
  // 持ち点1000点ぶんで動くポイント（段位ごとに少し違う。1位・35000点と25000点の差から割り出す）。
  const scoreSlope = (sampleTotal - samplePlacement) / ((sampleScore - BASE_SCORE) / 1000);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen rank-guide" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">{t("onlineLobby.t28")}</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="rank-guide__cols">
          <div className="rank-guide__left">
            {rank && (
              <div className="rank-guide__mine">
                <span className="rank-guide__mine-label">{t("rankGuideScreen.t1")}</span>
                <span className="rank-guide__mine-rank">{rank.label}</span>
                <span className="rank-guide__mine-points">
                  {rank.maxPoints === null
                    ? t("rankGuideScreen.t15", { points: rank.points })
                    : t("rankGuideScreen.t16", { points: rank.points, maxPoints: rank.maxPoints, v1: rank.maxPoints - rank.points })}
                </span>
              </div>
            )}

            <div className="rank-guide__ladder">
              {RANK_TIERS.map((tier, ti) => (
                <Fragment key={tier.id}>
                  {ti > 0 && <span className="rank-guide__arrow">▶</span>}
                  <span className={`rank-guide__step${rank?.tier === ti ? " is-mine" : ""}`}>
                    <span className="rank-guide__step-name">{tier.name}</span>
                    <span className="rank-guide__step-levels">{tier.levelMax.length === 0 ? t("rankGuideScreen.t17") : "1 → 2 → 3"}</span>
                  </span>
                </Fragment>
              ))}
            </div>

            <ol className="rank-guide__rules">
              <li>{t("rankGuideScreen.t2")}</li>
              <li>
                ポイントが<b>{t("rankGuideScreen.t3")}</b>上がります。
              </li>
              <li>
                ポイントが<b>{t("rankGuideScreen.t4")}</b>下がります（下雀1だけは下がりません。表の「降段なし」の段です）。
              </li>
            </ol>

            <ul className="rank-guide__notes">
          <li>{t("rankGuideScreen.t5")}</li>
          <li>{t("rankGuideScreen.t6")}</li>
          <li>{t("rankGuideScreen.t7")}</li>
          <li>{t("rankGuideScreen.t8")}</li>
        </ul>
          </div>
          <div className="rank-guide__right">
            <div className="rank-guide__tabs">
              <span className="rank-guide__tabs-label">{t("rankGuideScreen.t9")}</span>
              {(["tonpuusen", "hanchan"] as MatchFormat[]).map((f) => (
                <button key={f} type="button" className={`rank-guide__tab${format === f ? " is-active" : ""}`} onClick={() => setFormat(f)}>
                  {f === "hanchan" ? t("format.hanchan") : t("format.tonpuusen")}
                </button>
              ))}
            </div>

            <div className="rank-guide__table-wrap">
              <table className="rank-guide__table">
                <thead>
                  <tr>
                    <th>{t("rankGuideScreen.t10")}</th>
                    <th>{t("rankGuideScreen.t11")}</th>
                    {PLACES.map((p) => (
                      <th key={p}>{t("historyStats.t28", { p })}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const tier = RANK_TIERS[r.tier]!;
                    const max = rankMaxPoints(r);
                    return (
                      <tr key={`${r.tier}-${r.level}`} className={`${isMine(r) ? "is-mine" : ""}${r.level === 0 ? " is-tier-start" : ""}`}>
                        <th scope="row">
                          {rankLabel(r)}
                          {isMine(r) && <span className="rank-guide__here">{t("rankGuideScreen.t12")}</span>}
                          {!tier.canDemote[r.level] && <span className="rank-guide__safe">{t("rankGuideScreen.t13")}</span>}
                        </th>
                        <td>{max === null ? t("rankGuideScreen.t18") : `${tier.levelStart[r.level]} → ${max}`}</td>
                        {PLACES.map((p) => {
                          const d = rankPointDelta(r, format, p, BASE_SCORE);
                          return (
                            <td key={p} className={`rank-guide__delta${deltaClass(d)}`}>
                              {signed(d)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="rank-guide__score">
              <div className="rank-guide__score-title">{t("rankGuideScreen.t14")}</div>
              <p>
                25000点より<b>{t("rankGuideScreen.t19", { v1: scoreSlope.toFixed(1) })}</b>、<b>{t("rankGuideScreen.t20", { v1: scoreSlope.toFixed(1) })}</b> が、上の表の数字に足されます（段位が上がるほど大きくなります）。
              </p>
              <p className="rank-guide__example">
                例：{rankLabel(sample)}で{format === "hanchan" ? t("format.hanchan") : t("format.tonpuusen")}を1位・{sampleScore.toLocaleString()}点で終えると、
                <b>{t("rankGuideScreen.t21", { v1: signed(samplePlacement), v2: signed(sampleTotal - samplePlacement), v3: signed(sampleTotal) })}</b>
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
