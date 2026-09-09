import type { CSSProperties } from "react";
import { CHARACTERS, WIND_NAMES, seatWindOf, type PlayerIndex, type RoundState } from "@majyan/core";
import { TIME_STOP_FAKE_TURN_STEP_MS } from "../store/gameStore.js";
import { SkillGauge } from "./SkillGauge.js";

const SEAT_LABELS: Record<number, string> = { 1: "下家CPU", 2: "対面CPU", 3: "上家CPU" };

// キャラ名は「異名・名前」形式（例:「開花の巫女・ヒイラギ」）。自分/対面/
// 上家/下家とも「・」の位置できっちり2行に分け、異名・名前とも1段ずつ
// 見せる（指摘により、自分だけ1行に詰めて表示していた例外を廃止し
// 全員統一）。行が増えてパネルが縦に伸びるのは許容する。
function splitCharacterName(name: string | undefined): [string, string] {
  if (!name) return ["", ""];
  const i = name.indexOf("・");
  return i === -1 ? [name, ""] : [name.slice(0, i), name.slice(i + 1)];
}

export type PanelCorner = "top" | "right" | "left" | "bottom";

/**
 * 「画像→額縁→名前→点数/状態」を1枚にまとめたキャラクターパネル。
 * 以前はOpponentArea.tsx（対面/上家/下家）とHand.tsx（自分）にそれぞれ
 * 別々に実装されていたネームプレート＋必殺技ゲージを、卓の外に独立した
 * レイヤーとして置くために1つの共通コンポーネントへ統合した。
 *
 * 卓（.table）の内部レイアウト（河・手牌のgrid/flex計算）とは完全に
 * 独立したposition:absoluteの兄弟要素として配置するため、河がどれだけ
 * 伸びてもこのパネルと場所を奪い合うことがない（以前z-indexのパッチ当てを
 * 繰り返す原因になっていた「河とネームプレートが同じ箱の中で高さを取り
 * 合う」構造そのものを解消する）。
 */
export function CharacterPanel({
  round,
  player,
  score,
  corner,
  isSelf,
  onShowSkillInfo,
}: {
  round: RoundState;
  player: PlayerIndex;
  score: number;
  corner: PanelCorner;
  isSelf?: boolean;
  onShowSkillInfo?: () => void;
}) {
  const p = round.players[player];
  const character = CHARACTERS[round.characterIds[player]];
  const isCurrent = round.currentTurn === player;
  const wind = seatWindOf(round.dealerSeat, player);
  const isDealer = player === round.dealerSeat;

  // 必殺技「時間停止」発動中の演出。OpponentArea.tsx/Hand.tsxに元々
  // あったのと同じ判定をこちらへ移設した（ロジックの計算式自体は変更なし）。
  const timeStopSource = ([0, 1, 2, 3] as const).find((seat) => round.players[seat]!.timeStopTurnsRemaining > 0);
  const isTimeStopped = timeStopSource !== undefined;
  const frozen = isTimeStopped && timeStopSource !== player;
  const fakeTurnWindow = isTimeStopped && round.phase === "awaiting-draw" && round.currentTurn === timeStopSource;
  const fakeTurnStepIndex = frozen && fakeTurnWindow ? (player - timeStopSource! + 4) % 4 : 0;

  return (
    <div
      className={`character-panel character-panel--${corner}${isCurrent ? " character-panel--active" : ""}${frozen ? " character-panel--frozen" : ""}`}
    >
      <div
        className={`character-panel__portrait${fakeTurnStepIndex > 0 ? " character-panel__portrait--fake-turn" : ""}`}
        style={
          fakeTurnStepIndex > 0
            ? ({
                animationDelay: `${(fakeTurnStepIndex - 1) * TIME_STOP_FAKE_TURN_STEP_MS}ms`,
                animationDuration: `${TIME_STOP_FAKE_TURN_STEP_MS}ms`,
              } as CSSProperties)
            : undefined
        }
      >
        <img className="character-panel__avatar" src={character?.avatar ?? `/avatars/seat${player}.svg`} alt="" />
      </div>
      <div className="character-panel__body">
        {isSelf && onShowSkillInfo ? (
          <button
            type="button"
            className="character-panel__name character-panel__name--split character-panel__name--clickable"
            onClick={onShowSkillInfo}
          >
            {splitCharacterName(character?.name ?? "あなた").map((line, i) => (
              <span key={i} className="character-panel__name-line">
                {line}
              </span>
            ))}
          </button>
        ) : (
          <div className="character-panel__name character-panel__name--split">
            {splitCharacterName(character?.name ?? SEAT_LABELS[player]).map((line, i) => (
              <span key={i} className="character-panel__name-line">
                {line}
              </span>
            ))}
          </div>
        )}
        <div className="character-panel__meta">
          <span className="wind-badge">
            {WIND_NAMES[wind]}
            {isDealer ? "(親)" : ""}
          </span>
          <span className="character-panel__score">{score}点</span>
        </div>
        {p.riichi && <span className="riichi-badge">リーチ</span>}
        <SkillGauge round={round} player={player} />
      </div>
    </div>
  );
}
