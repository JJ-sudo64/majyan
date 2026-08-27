import type { PlayerIndex, RoundScoreOutcome, RoundState } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";

const PLAYER_NAMES: Record<number, string> = { 0: "あなた", 1: "下家", 2: "対面", 3: "上家" };

function resultTitle(round: RoundState): string {
  const r = round.result!;
  if (r.type === "tsumo") return `${PLAYER_NAMES[r.winners[0]!]} のツモ和了`;
  if (r.type === "ron") return `${r.winners.map((w) => PLAYER_NAMES[w]).join("・")} のロン和了`;
  if (r.type === "exhaustive-draw") return "流局（荒牌平局）";
  return "流局（九種九牌）";
}

export function ScoreResult({ round, outcome }: { round: RoundState; outcome: RoundScoreOutcome }) {
  const acknowledgeRoundEnd = useGameStore((s) => s.acknowledgeRoundEnd);
  const backToTitle = useGameStore((s) => s.backToTitle);
  const match = useGameStore((s) => s.match);

  const winnerEntries = Object.entries(outcome.winAnalyses) as [string, { analysis: import("@majyan/core").WinAnalysis; score: import("@majyan/core").ScoreResult }][];

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{resultTitle(round)}</h2>

        {winnerEntries.map(([playerStr, { analysis, score }]) => {
          const player = Number(playerStr) as PlayerIndex;
          return (
            <div key={player} className="win-detail">
              <div className="win-detail__player">{PLAYER_NAMES[player]}</div>
              <ul className="yaku-list">
                {analysis.yaku.map((y, i) => (
                  <li key={i}>
                    {y.name} {y.han > 0 ? `${y.han}翻` : ""}
                  </li>
                ))}
              </ul>
              <div className="win-detail__score">
                {analysis.isYakuman ? "役満" : `${analysis.han}翻${analysis.fu}符`} {score.payments.total}点
                {score.limitName ? `（${score.limitName}）` : ""}
              </div>
            </div>
          );
        })}

        {round.result?.type === "exhaustive-draw" && (
          <div className="tenpai-list">
            テンパイ: {(round.result.tenpaiPlayers ?? []).map((p) => PLAYER_NAMES[p]).join("、") || "なし"}
          </div>
        )}

        <div className="rank-cards">
          {match?.scores
            .map((s, i) => ({ i, s }))
            .sort((a, b) => b.s - a.s)
            .map(({ i, s }, rank) => (
              <div key={i} className={`rank-card rank-card--${rank + 1}`}>
                <img className="rank-card__avatar" src={`/avatars/seat${i}.svg`} alt="" />
                <div className="rank-card__body">
                  <div className="rank-card__name">{PLAYER_NAMES[i]}</div>
                  <div className="rank-card__score-row">
                    <span className="rank-card__rank">{rank + 1}位</span>
                    <span className="rank-card__score">{s}点</span>
                    <span className={outcome.scoreDeltas[i]! >= 0 ? "delta-positive" : "delta-negative"}>
                      {outcome.scoreDeltas[i]! >= 0 ? "+" : ""}
                      {outcome.scoreDeltas[i]}
                    </span>
                  </div>
                </div>
              </div>
            ))}
        </div>

        {match?.finished ? (
          <div>
            <h3>対局終了</h3>
            <button className="btn btn--primary" onClick={backToTitle}>
              タイトルへ戻る
            </button>
          </div>
        ) : (
          <button className="btn btn--primary" onClick={acknowledgeRoundEnd}>
            次の局へ
          </button>
        )}
      </div>
    </div>
  );
}
