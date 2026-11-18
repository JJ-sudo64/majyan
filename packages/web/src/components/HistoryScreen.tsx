import { useEffect, useState } from "react";
import {
  CARDS,
  CHARACTERS,
  REPORT_REASONS,
  type MatchFormat,
  type ReportReason,
  type RankedHistoryResponse,
  type RankingEntry,
  type RankingResponse,
} from "@majyan/core";
import { fetchRankedHistory, fetchRanking, fetchReplay, reportPlayer } from "../online/account.js";
import { useGameStore } from "../store/gameStore.js";
import { HistoryStats } from "./HistoryStats.js";
import { useT, txRank } from "../i18n/index.js";

const FORMAT_KEY = { tonpuusen: "format.tonpuusen", hanchan: "format.hanchan" } as const;
/** 対局一覧の1ページに出す件数（スクロールなしで収まる数）。 */
const MATCHES_PER_PAGE = 3;

/** 「卓上のてんこしゃんこ・マサキ」→「マサキ」。二つ名の無いキャラはそのまま。 */
function shortCharacterName(characterId: string): string {
  const name = CHARACTERS[characterId]?.name ?? characterId;
  return name.slice(name.lastIndexOf("・") + 1);
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RankingRow({ e }: { e: RankingEntry }) {
  const t = useT();
  return (
    <tr className={e.isYou ? "ranking-screen__you" : undefined}>
      <td className="ranking-screen__position">{e.position}</td>
      <td className="ranking-screen__name">{e.displayName}</td>
      <td className="history-screen__rank">{txRank(e.rankLabel)}</td>
      <td>{e.points} pt</td>
      <td>{t("historyScreen.t11", { gamesPlayed: e.gamesPlayed })}</td>
    </tr>
  );
}

/** 段位の高い順のランキング。自分が上位に入っていなくても最後に自分の順位を出す。 */
function RankingView() {
  const t = useT();
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchRanking()
      .then(setRanking)
      .catch((err: Error) => setError(err.message));
  }, []);
  if (error) return <p className="online-lobby__error">{error}</p>;
  if (!ranking) return <p className="setup-lead">{t("friendsScreen.t2")}</p>;
  const youInTop = ranking.top.some((e) => e.isYou);
  return (
    <>
      <p className="setup-lead">{t("historyScreen.t12", { v1: ranking.totalPlayers.toLocaleString(), v2: ranking.you ? t("historyScreen.t19", { v1: ranking.you.position.toLocaleString() }) : t("historyScreen.t20") })}</p>
      <table className="history-screen__stats ranking-screen__table">
        <tbody>
          {ranking.top.map((e) => (
            <RankingRow key={`${e.position}-${e.displayName}-${e.isYou}`} e={e} />
          ))}
          {ranking.you && !youInTop && (
            <>
              <tr className="ranking-screen__gap">
                <td colSpan={5}>⋮</td>
              </tr>
              <RankingRow e={ranking.you} />
            </>
          )}
        </tbody>
      </table>
      {ranking.top.length === 0 && <p className="setup-lead">{t("historyScreen.t1")}</p>}
    </>
  );
}

/** 段位戦の戦績（通算の順位の成績と、最近の対局）と、段位のランキング。 */
export function HistoryScreen({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<"stats" | "history" | "ranking">("stats");
  const [history, setHistory] = useState<RankedHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingReplay, setLoadingReplay] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  /** 通報しようとしている相手（理由を選んで送るまで）。 */
  const [reporting, setReporting] = useState<{ matchId: string; seat: number; name: string } | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("name");
  const [reportBusy, setReportBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendReport() {
    if (!reporting || reportBusy) return;
    setReportBusy(true);
    setError(null);
    try {
      await reportPlayer(reporting.matchId, reporting.seat, reportReason);
      setNotice(t("historyScreen.t13", { name: reporting.name }));
      setReporting(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReportBusy(false);
    }
  }

  async function openReplay(matchId: string) {
    setLoadingReplay(matchId);
    setError(null);
    try {
      // 再生を始めると卓の画面に切り替わる（App.tsx）。終了するとこのロビーに戻る。
      useGameStore.getState().openReplay(await fetchReplay(matchId));
    } catch (err) {
      setError((err as Error).message);
      setLoadingReplay(null);
    }
  }

  useEffect(() => {
    fetchRankedHistory()
      .then(setHistory)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen history-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="inbox-screen__tabs">
            <button type="button" className={`inbox-screen__tab${tab === "stats" ? " is-active" : ""}`} onClick={() => setTab("stats")}>
              {t("historyScreen.t2")}
            </button>
            <button type="button" className={`inbox-screen__tab${tab === "history" ? " is-active" : ""}`} onClick={() => setTab("history")}>
              {t("historyScreen.t3")}
            </button>
            <button type="button" className={`inbox-screen__tab${tab === "ranking" ? " is-active" : ""}`} onClick={() => setTab("ranking")}>
              {t("historyScreen.t4")}
            </button>
          </div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {tab === "ranking" && <RankingView />}
        {tab !== "ranking" && !history && !error && <p className="setup-lead">{t("friendsScreen.t2")}</p>}
        {error && <p className="online-lobby__error">{error}</p>}
        {notice && (
          <div className="online-lobby__notice" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}

        {tab === "stats" && history && <HistoryStats total={history.total} byFormat={history.byFormat} series={history.series} roundStats={history.roundStats} winKinds={history.winKinds} />}

        {tab === "history" && history && (
          <>
            <div className="online-lobby__section-title">{t("historyScreen.t5")}</div>
            {history.recent.length === 0 && <p className="setup-lead">{t("historyScreen.t6")}</p>}
            <ul className="history-screen__list">
              {history.recent.slice(page * MATCHES_PER_PAGE, (page + 1) * MATCHES_PER_PAGE).map((e) => (
                <li key={e.matchId} className={`history-screen__match history-screen__match--place${e.place}`}>
                  <div className="history-screen__match-head">
                    <span className="history-screen__place">{t("historyScreen.t14", { place: e.place })}</span>
                    <span>{t(FORMAT_KEY[e.format])}</span>
                    <span className="history-screen__score">{t("historyScreen.t15", { v1: e.finalScore.toLocaleString() })}</span>
                    <span className={e.delta >= 0 ? "history-screen__delta--up" : "history-screen__delta--down"}>
                      {e.delta >= 0 ? `+${e.delta}` : e.delta} pt
                    </span>
                    {e.rankAfter && <span className="history-screen__rank">→ {e.rankAfter}</span>}
                    <span className="history-screen__date">{formatDate(e.finishedAt)}</span>
                    {e.hasReplay && (
                      <button
                        type="button"
                        className="btn online-lobby__gacha-btn"
                        disabled={loadingReplay !== null}
                        onClick={() => void openReplay(e.matchId)}
                      >
                        {loadingReplay === e.matchId ? t("historyScreen.t16") : t("historyScreen.t17")}
                      </button>
                    )}
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
                            {s.cardId2 && <small> ＋ {CARDS[s.cardId2]?.name ?? s.cardId2}</small>}
                          </span>
                          <span className="history-screen__score">{s.finalScore.toLocaleString()}</span>
                          {!s.isYou && !s.isCpu && (
                            <button
                              type="button"
                              className="history-screen__report"
                              onClick={() => setReporting({ matchId: e.matchId, seat: s.seat, name: s.name })}
                            >
                              {t("historyScreen.t7")}
                            </button>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {reporting?.matchId === e.matchId && (
                    <div className="first-gacha__confirm history-screen__report-form">
                      <p>{t("historyScreen.t18", { name: reporting.name })}</p>
                      <select value={reportReason} onChange={(ev) => setReportReason(ev.target.value as ReportReason)}>
                        {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
                          <option key={r} value={r}>
                            {REPORT_REASONS[r]}
                          </option>
                        ))}
                      </select>
                      <div className="setup-buttons">
                        <button type="button" className="btn btn--primary" disabled={reportBusy} onClick={() => void sendReport()}>
                          {t("historyScreen.t8")}
                        </button>
                        <button type="button" className="btn btn--secondary" onClick={() => setReporting(null)}>
                          {t("cardSlot.t7")}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {history.recent.length > MATCHES_PER_PAGE && (
              <div className="history-screen__pager">
                <button type="button" className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  {t("historyScreen.t9")}
                </button>
                <span>
                  {page + 1} / {Math.ceil(history.recent.length / MATCHES_PER_PAGE)}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={(page + 1) * MATCHES_PER_PAGE >= history.recent.length}
                  onClick={() => setPage(page + 1)}
                >
                  {t("historyScreen.t10")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
