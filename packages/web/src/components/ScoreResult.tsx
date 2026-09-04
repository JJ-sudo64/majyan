import { useState } from "react";
import { CHARACTERS, doraIndicators, uraDoraIndicators, type Meld, type PlayerIndex, type RoundScoreOutcome, type RoundState, type Tile } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { MatchVictoryOverlay } from "./MatchVictoryOverlay.js";
import { TileView } from "./TileView.js";

const PLAYER_NAMES: Record<number, string> = { 0: "あなた", 1: "下家", 2: "対面", 3: "上家" };

// 和了時、それまで伏せられていた他家の手牌も含めて「実際にどういう手で
// 上がったか」を牌姿で見せる（役・点数の文字情報だけでは分かりにくい、
// 対戦相手の手を知りたいとの想定のため）。ツモはdraw時点で当たり牌が
// 既にhand.concealedへ混ざって入っている（hand.tsのaddTileToHand参照）ため
// idで抜き出すだけで済むが、ロンは放銃者の捨て牌がそのまま当たり牌なので
// 手牌には含まれておらず、表示用に別途くっつける必要がある。
function winningHandTiles(round: RoundState, player: PlayerIndex): { closedTiles: Tile[]; winTile: Tile | null; melds: Meld[] } {
  const hand = round.players[player].hand;
  const result = round.result;
  if (result?.type === "tsumo") {
    const winId = round.lastDrawnTile?.id;
    const closedTiles = winId ? hand.concealed.filter((t) => t.id !== winId) : hand.concealed;
    const winTile = (winId && hand.concealed.find((t) => t.id === winId)) || null;
    return { closedTiles, winTile, melds: hand.melds };
  }
  if (result?.type === "ron") {
    return { closedTiles: hand.concealed, winTile: round.lastDiscard?.tile ?? null, melds: hand.melds };
  }
  return { closedTiles: hand.concealed, winTile: null, melds: hand.melds };
}

function WinningHandView({ round, player }: { round: RoundState; player: PlayerIndex }) {
  const { closedTiles, winTile, melds } = winningHandTiles(round, player);
  return (
    <div className="win-detail__hand">
      {closedTiles.map((t) => (
        <TileView key={t.id} code={t.code} red={t.isRed} small highlightable={false} />
      ))}
      {winTile && <TileView key={winTile.id} code={winTile.code} red={winTile.isRed} small drawn highlightable={false} />}
      {melds.map((m, i) => (
        <div key={i} className="meld meld--small">
          {m.tiles.map((t, j) => (
            <TileView
              key={j}
              code={t.code}
              red={t.isRed}
              small
              highlightable={false}
              dimmed={m.type === "ankan" && (j === 0 || j === m.tiles.length - 1)}
              rotated={m.calledTile?.id === t.id}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

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

  // 対局全体の最終順位1位（同点なら若い席順）。結果モーダルを見終えた後に
  // 別画面でドンと出す「優勝」演出用。
  const championIndex = match?.scores
    ? (match.scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s)[0]?.i as PlayerIndex | undefined)
    : undefined;
  const championCharacter = championIndex !== undefined ? CHARACTERS[round.characterIds[championIndex]!] : undefined;
  const champion = championIndex !== undefined && championCharacter ? { player: championIndex, character: championCharacter } : undefined;

  // 結果モーダル（役・点数内訳、順位一覧）を確認し終えてから優勝演出に進む。
  // 以前は狭いモーダルの中に絵を埋め込んでいたが、他の情報に埋もれて
  // 目立たなかった（「全然出てない」との指摘）ため、確認後に別のオーバーレイへ
  // 切り替える2段階の見せ方にする。
  const [showVictory, setShowVictory] = useState(false);
  if (match?.finished && champion && showVictory) {
    return <MatchVictoryOverlay champion={champion} onBackToTitle={backToTitle} />;
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{resultTitle(round)}</h2>

        {winnerEntries.map(([playerStr, { analysis, score }]) => {
          const player = Number(playerStr) as PlayerIndex;
          const winner = round.players[player];
          const showUraDora = winner.riichi || winner.doubleRiichi;
          return (
            <div key={player} className="win-detail">
              <div className="win-detail__player">{PLAYER_NAMES[player]}</div>
              <WinningHandView round={round} player={player} />
              <div className="win-detail__dora">
                <span className="hud__dora-label">ドラ表示</span>
                <div className="hud__dora">
                  {doraIndicators(round.wall).map((d, i) => (
                    <TileView key={i} code={d} tiny highlightable={false} />
                  ))}
                </div>
              </div>
              {showUraDora && (
                <div className="win-detail__dora">
                  <span className="hud__dora-label">裏ドラ表示</span>
                  <div className="hud__dora">
                    {uraDoraIndicators(round.wall).map((d, i) => (
                      <TileView key={i} code={d} tiny highlightable={false} />
                    ))}
                  </div>
                </div>
              )}
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
            <div className="tenpai-list__label">
              テンパイ: {(round.result.tenpaiPlayers ?? []).map((p) => PLAYER_NAMES[p]).join("、") || "なし"}
            </div>
            {/* 実際の麻雀のルール通り、荒牌流局時はテンパイを申告した者の手牌を
                開示する（ノーテン者は開示不要のため対象外）。名前だけでは
                「本当にテンパイしていたか」が分からず不透明だったため。 */}
            {(round.result.tenpaiPlayers ?? []).map((p) => (
              <div key={p} className="win-detail">
                <div className="win-detail__player">{PLAYER_NAMES[p]}</div>
                <WinningHandView round={round} player={p} />
              </div>
            ))}
          </div>
        )}

        <div className="rank-cards">
          {match?.scores
            .map((s, i) => ({ i, s }))
            .sort((a, b) => b.s - a.s)
            .map(({ i, s }, rank) => (
              <div key={i} className={`rank-card rank-card--${rank + 1}`}>
                <img className="rank-card__avatar" src={CHARACTERS[round.characterIds[i]!]?.avatar ?? `/avatars/seat${i}.svg`} alt="" />
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
            <button className="btn btn--primary" onClick={() => setShowVictory(true)}>
              結果を見る
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
