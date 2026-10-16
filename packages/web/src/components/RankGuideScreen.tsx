import { Fragment, useState } from "react";
import { RANK_TIERS, rankLabel, rankMaxPoints, rankPointDelta, type MatchFormat, type RankState, type RankView } from "@majyan/core";

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
  const [format, setFormat] = useState<MatchFormat>("tonpuusen");
  const rows = ladderRows();
  const isMine = (r: RankState) => !!rank && rank.tier === r.tier && rank.level === r.level;
  // 例に使う段（自分の段。まだ分からなければ最初の段）。
  const sample: RankState = rank ?? rows[0]!;
  const sampleScore = 35000;
  const samplePlacement = rankPointDelta(sample, format, 1, BASE_SCORE);
  const sampleTotal = rankPointDelta(sample, format, 1, sampleScore);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen rank-guide" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">段位のしくみ</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="rank-guide__cols">
          <div className="rank-guide__left">
            {rank && (
              <div className="rank-guide__mine">
                <span className="rank-guide__mine-label">今のあなた</span>
                <span className="rank-guide__mine-rank">{rank.label}</span>
                <span className="rank-guide__mine-points">
                  {rank.maxPoints === null
                    ? `${rank.points} pt（いちばん上の段位です）`
                    : `${rank.points} / ${rank.maxPoints} pt・あと ${rank.maxPoints - rank.points} pt で昇段`}
                </span>
              </div>
            )}

            <div className="rank-guide__ladder">
              {RANK_TIERS.map((tier, t) => (
                <Fragment key={tier.id}>
                  {t > 0 && <span className="rank-guide__arrow">▶</span>}
                  <span className={`rank-guide__step${rank?.tier === t ? " is-mine" : ""}`}>
                    <span className="rank-guide__step-name">{tier.name}</span>
                    <span className="rank-guide__step-levels">{tier.levelMax.length === 0 ? "頂点" : "1 → 2 → 3"}</span>
                  </span>
                </Fragment>
              ))}
            </div>

            <ol className="rank-guide__rules">
              <li>段位戦を1回打つたびに、順位に応じてポイントが増えたり減ったりします。</li>
              <li>
                ポイントが<b>「昇段」の数字に届くと次の段へ</b>上がります。
              </li>
              <li>
                ポイントが<b>0を下回ると1つ下の段へ</b>下がります（下雀・中雀は下がりません）。
              </li>
            </ol>

            <ul className="rank-guide__notes">
          <li>昇段・降段した時のポイントは、新しい段の「始まり」の数字になります。</li>
          <li>昇段・降段は1回の対局で1段までです。</li>
          <li>雀神には上限がなく、ポイントを積み上げ続けます。0を下回ると雀帝3に戻ります。</li>
          <li>段位戦では、段位の近い人どうしで卓を組みます。友人戦では段位は動きません。</li>
        </ul>
          </div>
          <div className="rank-guide__right">
            <div className="rank-guide__tabs">
              <span className="rank-guide__tabs-label">1回の対局で動くポイント</span>
              {(["tonpuusen", "hanchan"] as MatchFormat[]).map((f) => (
                <button key={f} type="button" className={`rank-guide__tab${format === f ? " is-active" : ""}`} onClick={() => setFormat(f)}>
                  {f === "hanchan" ? "半荘戦" : "東風戦"}
                </button>
              ))}
            </div>

            <div className="rank-guide__table-wrap">
              <table className="rank-guide__table">
                <thead>
                  <tr>
                    <th>段位</th>
                    <th>始まり → 昇段</th>
                    {PLACES.map((p) => (
                      <th key={p}>{p}位</th>
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
                          {isMine(r) && <span className="rank-guide__here">今ここ</span>}
                          {!tier.canDemote && <span className="rank-guide__safe">降段なし</span>}
                        </th>
                        <td>{max === null ? "上限なし" : `${tier.levelStart[r.level]} → ${max}`}</td>
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
              <div className="rank-guide__score-title">終わった時の持ち点でも増減します</div>
              <p>
                25000点より<b>1000点多いごとに +1</b>、<b>1000点少ないごとに −1</b> が、上の表の数字に足されます。
              </p>
              <p className="rank-guide__example">
                例：{rankLabel(sample)}で{format === "hanchan" ? "半荘戦" : "東風戦"}を1位・{sampleScore.toLocaleString()}点で終えると、
                <b>
                  {signed(samplePlacement)}（1位） {signed(sampleTotal - samplePlacement)}（持ち点） ＝ {signed(sampleTotal)} pt
                </b>
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
