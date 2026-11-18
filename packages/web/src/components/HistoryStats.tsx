import { useState } from "react";
import type { MatchFormat, RankedPlaceStats, RankedSeriesPoint, RoundStatsSummary, WinKinds } from "@majyan/core";
import { useT } from "../i18n/index.js";

const FORMAT_LABEL: Record<MatchFormat, string> = { tonpuusen: "東風戦", hanchan: "半荘戦" };
/** 順位の推移グラフに出す対局数の選択肢（−・＋で切り替える）。 */
const WINDOW_SIZES = [10, 20, 50, 100] as const;

function percent(n: number, games: number): string {
  return games ? `${((n / games) * 100).toFixed(2)}%` : "-";
}

export function averagePlace(stats: Pick<RankedPlaceStats, "games" | "places">): string {
  if (!stats.games) return "-";
  const sum = stats.places.reduce((acc, n, i) => acc + n * (i + 1), 0);
  return (sum / stats.games).toFixed(2);
}

const CHART_W = 420;
const CHART_H = 150;
const CHART_LEFT = 40;
const CHART_RIGHT = 10;
const chartY = (place: number) => 20 + (place - 1) * 37;

/** 直近の順位の折れ線。縦が1位〜4位、右が新しい対局。 */
function PlaceLineChart({ series }: { series: RankedSeriesPoint[] }) {
  const t = useT();
  const [sizeIndex, setSizeIndex] = useState(2);
  const size = WINDOW_SIZES[sizeIndex]!;
  const shown = series.slice(-size);
  const step = shown.length > 1 ? (CHART_W - CHART_LEFT - CHART_RIGHT) / (shown.length - 1) : 0;
  const x = (i: number) => (shown.length > 1 ? CHART_LEFT + i * step : (CHART_LEFT + CHART_W - CHART_RIGHT) / 2);
  const points = shown.map((s, i) => `${x(i).toFixed(1)},${chartY(s.place).toFixed(1)}`).join(" ");
  return (
    <section className="history-stats__block">
      <div className="history-stats__head">
        <h3>{t("historyStats.t1")}</h3>
        <span className="history-stats__window">
          <button type="button" aria-label={t("historyStats.t2")} disabled={sizeIndex === 0} onClick={() => setSizeIndex(sizeIndex - 1)}>
            −
          </button>
          直近{shown.length ? Math.min(size, series.length) : size}戦
          <button type="button" aria-label={t("historyStats.t3")} disabled={sizeIndex === WINDOW_SIZES.length - 1} onClick={() => setSizeIndex(sizeIndex + 1)}>
            ＋
          </button>
        </span>
      </div>
      <svg className="history-stats__line" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={t("historyStats.t4")}>
        {[1, 2, 3, 4].map((p) => (
          <g key={p}>
            <line x1={CHART_LEFT - 4} x2={CHART_W - CHART_RIGHT} y1={chartY(p)} y2={chartY(p)} className="history-stats__grid" />
            <text x={CHART_LEFT - 8} y={chartY(p) + 5} textAnchor="end" className="history-stats__axis">{t("historyStats.t28", { p })}</text>
          </g>
        ))}
        {shown.length > 1 && <polyline points={points} className="history-stats__path" />}
        {shown.map((s, i) => (
          <circle key={i} cx={x(i)} cy={chartY(s.place)} r={shown.length > 60 ? 2.6 : 3.8} className={`history-stats__dot history-stats__dot--place${s.place}`} />
        ))}
        {shown.length === 0 && (
          <text x={CHART_W / 2} y={CHART_H / 2} textAnchor="middle" className="history-stats__axis">
            {t("historyStats.t5")}
          </text>
        )}
      </svg>
    </section>
  );
}

/** 直近100戦の順位の割合（横棒）。 */
function PlaceBars({ series }: { series: RankedSeriesPoint[] }) {
  const t = useT();
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const s of series) counts[s.place - 1]! += 1;
  return (
    <section className="history-stats__block">
      <div className="history-stats__head">
        <h3>{t("historyStats.t6")}</h3>
        <span className="history-stats__note">{t("historyStats.t29", { length: series.length })}</span>
      </div>
      <div className="history-stats__bars">
        {counts.map((n, i) => (
          <div key={i} className="history-stats__bar-row">
            <span className="history-stats__bar-label">{t("historyStats.t30", { v1: i + 1 })}</span>
            <span className="history-stats__bar-track">
              <span className={`history-stats__bar history-stats__bar--place${i + 1}`} style={{ width: `${series.length ? (n / series.length) * 100 : 0}%` }} />
            </span>
            <span className="history-stats__bar-value">{percent(n, series.length)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="history-stats__stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** 和了の種類（立直・副露・闇聴）の内訳をドーナツで見せる。 */
function WinKindsDonut({ kinds }: { kinds: WinKinds }) {
  const t = useT();
  const total = kinds.riichi + kinds.open + kinds.dama;
  const parts = [
    { label: "立直", n: kinds.riichi, className: "history-stats__donut--riichi" },
    { label: "副露", n: kinds.open, className: "history-stats__donut--open" },
    { label: "闇聴", n: kinds.dama, className: "history-stats__donut--dama" },
  ];
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <section className="history-stats__block">
      <div className="history-stats__head">
        <h3>{t("historyStats.t7")}</h3>
      </div>
      <div className="history-stats__donut-wrap">
        <svg viewBox="0 0 100 100" className="history-stats__donut" role="img" aria-label={t("historyStats.t8")}>
          <circle cx="50" cy="50" r={radius} className="history-stats__donut-bg" />
          {total > 0 &&
            parts.map((part) => {
              const length = (part.n / total) * circumference;
              const circle = (
                <circle
                  key={part.label}
                  cx="50"
                  cy="50"
                  r={radius}
                  className={`history-stats__donut-seg ${part.className}`}
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 50 50)"
                />
              );
              offset += length;
              return circle;
            })}
        </svg>
        <ul className="history-stats__legend">
          {parts.map((part) => (
            <li key={part.label}>
              <span className={`history-stats__swatch ${part.className}`} />
              {part.label} <strong>{percent(part.n, total)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ratio(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(2)}%` : "-";
}

/** 東風戦・半荘戦ごとの成績。順位の割合は対局ごと、和了率などは局ごとの記録から出す。 */
function FormatPanel({ format, stats, rounds }: { format: MatchFormat; stats: RankedPlaceStats; rounds: RoundStatsSummary }) {
  const t = useT();
  const [first, second, third, fourth] = stats.places;
  return (
    <section className="history-stats__block history-stats__panel">
      <div className="history-stats__grid-stats" data-format={format}>
        <Stat label={t("historyStats.t9")} value={percent(first, stats.games)} />
        <Stat label={t("historyStats.t10")} value={String(stats.games)} />
        <Stat label={t("historyStats.t11")} value={ratio(rounds.wins, rounds.rounds)} />
        <Stat label={t("historyStats.t12")} value={percent(second, stats.games)} />
        <Stat label={t("historyStats.t13")} value={rounds.wins ? String(Math.round(rounds.winPointsTotal / rounds.wins)) : "-"} />
        <Stat label={t("historyStats.t14")} value={ratio(rounds.tsumoWins, rounds.wins)} />
        <Stat label={t("historyStats.t15")} value={percent(third, stats.games)} />
        <Stat label={t("historyStats.t16")} value={averagePlace(stats)} />
        <Stat label={t("historyStats.t17")} value={ratio(rounds.dealtIn, rounds.rounds)} />
        <Stat label={t("historyStats.t18")} value={percent(fourth, stats.games)} />
        <Stat label={t("historyStats.t19")} value={rounds.maxRenchan ? String(rounds.maxRenchan) : "-"} />
        <Stat label={t("historyStats.t20")} value={ratio(rounds.openRounds, rounds.rounds)} />
        <Stat label={t("historyStats.t21")} value={percent(stats.busted, stats.games)} />
        <Stat label={t("historyStats.t22")} value={rounds.wins ? (rounds.winTurnTotal / rounds.wins).toFixed(2) : "-"} />
        <Stat label={t("historyStats.t23")} value={ratio(rounds.riichiRounds, rounds.rounds)} />
        <Stat label={t("historyStats.t24")} value={percent(first + second, stats.games)} />
        <Stat label={t("historyStats.t25")} value={percent(stats.games - fourth, stats.games)} />
        <Stat label={t("historyStats.t26")} value={String(rounds.rounds)} />
      </div>
    </section>
  );
}

/** 戦績のまとめ。左に折れ線・和了グラフ・順位グラフ、右に東風戦／半荘戦の成績を出し、スクロールなしで収める。 */
export function HistoryStats({
  total,
  byFormat,
  series,
  roundStats,
  winKinds,
}: {
  total: RankedPlaceStats;
  byFormat: Record<MatchFormat, RankedPlaceStats>;
  series: RankedSeriesPoint[];
  roundStats: Record<MatchFormat, RoundStatsSummary>;
  winKinds: WinKinds;
}) {
  const t = useT();
  // 対局の多いほうを先に出す。
  const [format, setFormat] = useState<MatchFormat>(byFormat.tonpuusen.games >= byFormat.hanchan.games ? "tonpuusen" : "hanchan");
  return (
    <div className="history-stats">
      <p className="history-stats__total">{t("historyStats.t31", { games: total.games, v1: averagePlace(total) })}</p>
      <div className="history-stats__cols">
        <div className="history-stats__left">
          <PlaceLineChart series={series} />
          <div className="history-stats__pair">
            <WinKindsDonut kinds={winKinds} />
            <PlaceBars series={series} />
          </div>
        </div>
        <div className="history-stats__right">
          <div className="history-stats__formats">
            {(["tonpuusen", "hanchan"] as MatchFormat[]).map((f) => (
              <button key={f} type="button" className={`history-stats__format${format === f ? " is-active" : ""}`} onClick={() => setFormat(f)}>
                {FORMAT_LABEL[f]}
                <small>{t("historyStats.t32", { games: byFormat[f].games })}</small>
              </button>
            ))}
          </div>
          <FormatPanel format={format} stats={byFormat[format]} rounds={roundStats[format]} />
          <p className="history-stats__note history-stats__footnote">{t("historyStats.t27")}</p>
        </div>
      </div>
    </div>
  );
}
