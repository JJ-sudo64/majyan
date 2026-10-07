import { useEffect, useState } from "react";
import { CARDS, CHARACTERS, type MatchFormat, type RankedHistoryResponse, type RankedPlaceStats } from "@majyan/core";
import { fetchRankedHistory } from "../online/account.js";

const FORMAT_LABEL: Record<MatchFormat, string> = { tonpuusen: "東風戦", hanchan: "半荘戦" };

/** 「卓上のてんこしゃんこ・マサト」→「マサト」。二つ名の無いキャラはそのまま。 */
function shortCharacterName(characterId: string): string {
  const name = CHARACTERS[characterId]?.name ?? characterId;
  return name.slice(name.lastIndexOf("・") + 1);
}

function percent(n: number, games: number): string {
  return games ? `${((n / games) * 100).toFixed(1)}%` : "-";
}

function averagePlace(stats: RankedPlaceStats): string {
  if (!stats.games) return "-";
  const sum = stats.places.reduce((acc, n, i) => acc + n * (i + 1), 0);
  return (sum / stats.games).toFixed(2);
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StatsRow({ label, stats }: { label: string; stats: RankedPlaceStats }) {
  const [first, second, , fourth] = stats.places;
  return (
    <tr>
      <th>{label}</th>
      <td>{stats.games}</td>
      <td>{averagePlace(stats)}</td>
      <td>{percent(first, stats.games)}</td>
      <td>{percent(first + second, stats.games)}</td>
      <td>{percent(stats.games - fourth, stats.games)}</td>
      <td className="history-screen__places">{stats.places.join(" / ")}</td>
    </tr>
  );
}

/** 段位戦の戦績（通算の順位の成績と、最近の対局）。 */
export function HistoryScreen({ onClose }: { onClose: () => void }) {
  const [history, setHistory] = useState<RankedHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRankedHistory()
      .then(setHistory)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen history-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">戦績（段位戦）</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {!history && !error && <p className="setup-lead">読み込んでいます…</p>}
        {error && <p className="online-lobby__error">{error}</p>}

        {history && (
          <>
            <table className="history-screen__stats">
              <thead>
                <tr>
                  <th />
                  <th>対局数</th>
                  <th>平均順位</th>
                  <th>1位率</th>
                  <th>連対率</th>
                  <th>4位回避率</th>
                  <th>1位/2位/3位/4位</th>
                </tr>
              </thead>
              <tbody>
                <StatsRow label="通算" stats={history.total} />
                <StatsRow label={FORMAT_LABEL.tonpuusen} stats={history.byFormat.tonpuusen} />
                <StatsRow label={FORMAT_LABEL.hanchan} stats={history.byFormat.hanchan} />
              </tbody>
            </table>

            <div className="online-lobby__section-title">最近の対局</div>
            {history.recent.length === 0 && <p className="setup-lead">まだ段位戦を打っていません。</p>}
            <ul className="history-screen__list">
              {history.recent.map((e) => (
                <li key={e.matchId} className={`history-screen__match history-screen__match--place${e.place}`}>
                  <div className="history-screen__match-head">
                    <span className="history-screen__place">{e.place}位</span>
                    <span>{FORMAT_LABEL[e.format]}</span>
                    <span className="history-screen__score">{e.finalScore.toLocaleString()}点</span>
                    <span className={e.delta >= 0 ? "history-screen__delta--up" : "history-screen__delta--down"}>
                      {e.delta >= 0 ? `+${e.delta}` : e.delta} pt
                    </span>
                    {e.rankAfter && <span className="history-screen__rank">→ {e.rankAfter}</span>}
                    <span className="history-screen__date">{formatDate(e.finishedAt)}</span>
                  </div>
                  {e.seats.length > 0 && (
                    <ol className="history-screen__seats">
                      {e.seats.map((s) => (
                        <li key={`${s.place}-${s.name}`} className={s.isYou ? "history-screen__seat--you" : undefined}>
                          <span className="history-screen__seat-place">{s.place}</span>
                          <span className="history-screen__seat-name">
                            {s.name}
                            {s.isCpu && <small>（CPU）</small>}
                          </span>
                          <span className="history-screen__seat-character">
                            {shortCharacterName(s.characterId)}
                            {s.cardId && <small> ＋ {CARDS[s.cardId]?.name ?? s.cardId}</small>}
                          </span>
                          <span className="history-screen__score">{s.finalScore.toLocaleString()}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
