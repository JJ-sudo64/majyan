import { useState } from "react";
import type { MatchFormat, RankedPlaceStats, RankedSeriesPoint } from "@majyan/core";

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
  const [sizeIndex, setSizeIndex] = useState(2);
  const size = WINDOW_SIZES[sizeIndex]!;
  const shown = series.slice(-size);
  const step = shown.length > 1 ? (CHART_W - CHART_LEFT - CHART_RIGHT) / (shown.length - 1) : 0;
  const x = (i: number) => (shown.length > 1 ? CHART_LEFT + i * step : (CHART_LEFT + CHART_W - CHART_RIGHT) / 2);
  const points = shown.map((s, i) => `${x(i).toFixed(1)},${chartY(s.place).toFixed(1)}`).join(" ");
  return (
    <section className="history-stats__block">
      <div className="history-stats__head">
        <h3>対戦記録</h3>
        <span className="history-stats__window">
          <button type="button" aria-label="表示する対局を減らす" disabled={sizeIndex === 0} onClick={() => setSizeIndex(sizeIndex - 1)}>
            −
          </button>
          直近{shown.length ? Math.min(size, series.length) : size}戦
          <button type="button" aria-label="表示する対局を増やす" disabled={sizeIndex === WINDOW_SIZES.length - 1} onClick={() => setSizeIndex(sizeIndex + 1)}>
            ＋
          </button>
        </span>
      </div>
      <svg className="history-stats__line" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label="直近の順位の推移">
        {[1, 2, 3, 4].map((p) => (
          <g key={p}>
            <line x1={CHART_LEFT - 4} x2={CHART_W - CHART_RIGHT} y1={chartY(p)} y2={chartY(p)} className="history-stats__grid" />
            <text x={CHART_LEFT - 8} y={chartY(p) + 5} textAnchor="end" className="history-stats__axis">
              {p}位
            </text>
          </g>
        ))}
        {shown.length > 1 && <polyline points={points} className="history-stats__path" />}
        {shown.map((s, i) => (
          <circle key={i} cx={x(i)} cy={chartY(s.place)} r={shown.length > 60 ? 2.6 : 3.8} className={`history-stats__dot history-stats__dot--place${s.place}`} />
        ))}
        {shown.length === 0 && (
          <text x={CHART_W / 2} y={CHART_H / 2} textAnchor="middle" className="history-stats__axis">
            まだ段位戦を打っていません
          </text>
        )}
      </svg>
    </section>
  );
}

/** 直近100戦の順位の割合（横棒）。 */
function PlaceBars({ series }: { series: RankedSeriesPoint[] }) {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const s of series) counts[s.place - 1]! += 1;
  return (
    <section className="history-stats__block">
      <div className="history-stats__head">
        <h3>順位グラフ</h3>
        <span className="history-stats__note">直近{series.length}戦</span>
      </div>
      <div className="history-stats__bars">
        {counts.map((n, i) => (
          <div key={i} className="history-stats__bar-row">
            <span className="history-stats__bar-label">{i + 1}位</span>
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

/** 東風戦・半荘戦ごとの成績（順位の割合など）。 */
function FormatPanel({ format, stats }: { format: MatchFormat; stats: RankedPlaceStats }) {
  const [first, second, third, fourth] = stats.places;
  return (
    <section className="history-stats__block history-stats__panel">
      <div className="history-stats__head">
        <h3>{FORMAT_LABEL[format]}</h3>
        <span className="history-stats__note">{stats.games}戦</span>
      </div>
      <div className="history-stats__grid-stats">
        <Stat label="一位率" value={percent(first, stats.games)} />
        <Stat label="二位率" value={percent(second, stats.games)} />
        <Stat label="三位率" value={percent(third, stats.games)} />
        <Stat label="四位率" value={percent(fourth, stats.games)} />
        <Stat label="連対率" value={percent(first + second, stats.games)} />
        <Stat label="四位回避率" value={percent(stats.games - fourth, stats.games)} />
        <Stat label="対戦数" value={String(stats.games)} />
        <Stat label="平均順位" value={averagePlace(stats)} />
        <Stat label="飛び率" value={percent(stats.busted, stats.games)} />
      </div>
    </section>
  );
}

/** 戦績のまとめ。左に折れ線と順位の割合、右に東風戦・半荘戦ごとの成績を並べ、スクロールなしで収める。 */
export function HistoryStats({
  total,
  byFormat,
  series,
}: {
  total: RankedPlaceStats;
  byFormat: Record<MatchFormat, RankedPlaceStats>;
  series: RankedSeriesPoint[];
}) {
  return (
    <div className="history-stats">
      <p className="history-stats__total">
        通算 {total.games}戦・平均順位 {averagePlace(total)}
      </p>
      <div className="history-stats__cols">
        <div className="history-stats__left">
          <PlaceLineChart series={series} />
          <PlaceBars series={series} />
        </div>
        <div className="history-stats__right">
          <FormatPanel format="tonpuusen" stats={byFormat.tonpuusen} />
          <FormatPanel format="hanchan" stats={byFormat.hanchan} />
        </div>
      </div>
    </div>
  );
}
