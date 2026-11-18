import { createPortal } from "react-dom";
import { CHARACTERS, rankSeats, type PlayerIndex, type RoundState } from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { portalRoot } from "../orientation.js";
import { useT } from "../i18n/index.js";

const HUMAN = 0 as const;

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * 卓中央の点数表示を押した時に出す点差の一覧。順位・持ち点・自分との差を4人分
 * まとめて見せる。供託（リーチ棒）と本場は点差に含めず、別の行で添える。
 * 順位はcoreのrankSeats（同点は起家に近い順）と同じ並び。
 */
export function ScoreStandings({
  round,
  scores,
  startingDealer,
  onClose,
}: {
  round: RoundState;
  scores: [number, number, number, number];
  startingDealer: PlayerIndex;
  onClose: () => void;
}) {
  const t = useT();
  const onlineSeats = useGameStore((s) => s.onlineSeats);
  const order = rankSeats(scores, startingDealer);
  const myRank = order.indexOf(HUMAN);
  const nameOf = (seat: PlayerIndex) =>
    seat === HUMAN ? t("standings.you") : (onlineSeats?.[seat]?.name ?? CHARACTERS[round.characterIds[seat]]?.name ?? "");

  // 自分から見たトップ・1つ上・1つ下との差（該当する相手がいない時はnull）。
  const gapTo = (rank: number): number | null => (rank >= 0 && rank < 4 ? scores[order[rank]!] - scores[HUMAN] : null);
  const top = myRank === 0 ? null : gapTo(0);
  const above = myRank === 0 ? null : gapTo(myRank - 1);
  const below = myRank === 3 ? null : gapTo(myRank + 1);

  return createPortal(
    // Portalでも、Reactのクリックは親(.center-board、押すと開く側)まで伝わるため、
    // ここで止めないと閉じた直後にまた開いてしまう。
    <div
      className="score-standings__overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="score-standings" role="dialog" aria-label={t("standings.title")} onClick={(e) => e.stopPropagation()}>
        <div className="score-standings__title">{t("standings.title")}</div>
        <table className="score-standings__table">
          <tbody>
            {order.map((seat, i) => (
              <tr key={seat} className={seat === HUMAN ? "score-standings__row--me" : undefined}>
                <td className="score-standings__rank">{t("standings.place", { n: i + 1 })}</td>
                <td className="score-standings__name">{nameOf(seat)}</td>
                <td className="score-standings__score">{scores[seat]}</td>
                <td className="score-standings__diff">{seat === HUMAN ? "" : signed(scores[seat] - scores[HUMAN])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="score-standings__notes">
          {top !== null && <div>{t("standings.diffTop", { d: signed(top) })}</div>}
          {above !== null && myRank > 1 && <div>{t("standings.diffAbove", { d: signed(above) })}</div>}
          {below !== null && <div>{t("standings.diffBelow", { d: signed(below) })}</div>}
          <div>
            {t("standings.sticks", { kyotaku: round.kyotaku, honba: round.honba })}
          </div>
        </div>
        <button type="button" className="score-standings__close" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>,
    portalRoot(),
  );
}
