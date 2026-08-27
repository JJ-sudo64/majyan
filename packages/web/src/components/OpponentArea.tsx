import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Meld, PlayerIndex, RoundState } from "@majyan/core";
import { TileView } from "./TileView.js";

const NAMES: Record<number, string> = { 1: "下家CPU", 2: "対面CPU", 3: "上家CPU" };

// 副露が分かりにくいとの指摘を受け、鳴いた瞬間に発声を模した大きな文字を
// 一瞬表示する。暗槓は他家の捨て牌に反応した「鳴き」ではなく自分の手番中の
// 自己申告だが、実際の対局でも「カン」は声に出して宣言するのが普通なので
// 表示対象に含める。
const CALL_LABELS: Partial<Record<Meld["type"], string>> = {
  chi: "チー",
  pon: "ポン",
  minkan: "カン",
  kakan: "カン",
  ankan: "カン",
};
const CALL_ANNOUNCE_MS = 1000;

// 手出し（ツモった牌を一旦手牌に加えてから中ほどの牌を選んで切った）と
// わかるように、手出しの瞬間だけ残った手牌が中央でサッと割れて開き、
// そこから閉じる演出を見せる。ツモ切りは手牌に触れず端の牌をそのまま
// 切っただけなので、この演出は出さない（DiscardPile側の入場演出とだけ
// 差がつく）。CSSアニメーションの実時間(tile-slide-in, 300ms)と揃える。
const HAND_SPLIT_MS = 320;
const HAND_SPLIT_DISTANCE = 16;

export function OpponentArea({ round, player }: { round: RoundState; player: PlayerIndex }) {
  const p = round.players[player];
  const isCurrent = round.currentTurn === player;
  const concealedCount = p.hand.concealed.length;
  const discardCount = p.discards.length;

  const prevDiscardCountRef = useRef(discardCount);
  const [splitting, setSplitting] = useState(false);

  useEffect(() => {
    const prevCount = prevDiscardCountRef.current;
    prevDiscardCountRef.current = discardCount;
    if (discardCount > prevCount) {
      const latest = p.discards[discardCount - 1];
      if (latest && !latest.isTsumogiri) {
        setSplitting(true);
        const timer = setTimeout(() => setSplitting(false), HAND_SPLIT_MS);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [discardCount, p.discards]);

  // 加槓は新しい副露を追加するのではなく、既存のポンをその場でカンへ
  // 差し替える（配列の長さは変わらない）ため、枚数だけの比較では検出でき
  // ない。副露「種類の並び」を比較し、枚数が増えた場合と、同じ枚数のまま
  // 途中の種類が変わった場合（加槓）の両方を拾う。
  const meldTypes = p.hand.melds.map((m) => m.type);
  const meldsSignature = meldTypes.join(",");
  const prevMeldTypesRef = useRef(meldTypes);
  const [callAnnounce, setCallAnnounce] = useState<string | null>(null);

  useEffect(() => {
    const prevTypes = prevMeldTypesRef.current;
    let changedType: Meld["type"] | undefined;
    if (meldTypes.length > prevTypes.length) {
      changedType = meldTypes[meldTypes.length - 1];
    } else if (meldTypes.length === prevTypes.length) {
      for (let j = 0; j < meldTypes.length; j++) {
        if (meldTypes[j] !== prevTypes[j]) {
          changedType = meldTypes[j];
          break;
        }
      }
    }
    prevMeldTypesRef.current = meldTypes;
    const label = changedType && CALL_LABELS[changedType];
    if (label) {
      setCallAnnounce(label);
      const timer = setTimeout(() => setCallAnnounce(null), CALL_ANNOUNCE_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [meldsSignature]);

  // 自分の手牌(Hand.tsx)と同じく、ツモった直後（まだ切っていない間）は
  // その1枚だけ本体から少し離して見せる。ここでツモ切り／手出しの分かれ道を
  // 作る：
  // - ツモ切り＝この離れた牌がそのまま河へ運ばれる（DiscardPile側の入場
  //   演出が、この牌を含む.opponent-hand-backの右端付近を実測して起点に
  //   使うため、離れた牌の位置とほぼ一致した所から飛んでいくように見える）。
  // - 手出し＝この離れた牌は本体側に合流して見え隠れし、代わりに本体が
  //   中央で割れて別の牌が河へ出ていく（上のsplitting演出）。
  const hasPendingDraw = round.currentTurn === player && round.phase === "awaiting-discard";
  const mainCount = hasPendingDraw ? concealedCount - 1 : concealedCount;
  const leftCount = Math.ceil(mainCount / 2);

  return (
    <div className={`opponent-area opponent-area--${player}${isCurrent ? " opponent-area--active" : ""}`}>
      {callAnnounce && <div className="call-announce">{callAnnounce}</div>}
      <div className="nameplate">
        <img className="nameplate__avatar" src={`/avatars/seat${player}.svg`} alt="" />
        <div className="nameplate__text">
          <div className="nameplate__name">{NAMES[player]}</div>
          <div className="nameplate__title">称号なし</div>
        </div>
      </div>
      <div className="opponent-hand-row">
        <div className="opponent-hand-back" data-hand-anchor={player}>
          <div className="opponent-hand-back__inner">
            {Array.from({ length: mainCount }, (_, i) => {
              const style: CSSProperties | undefined = splitting
                ? i < leftCount
                  ? ({ "--enter-x": `${-HAND_SPLIT_DISTANCE}px`, "--enter-y": "0px" } as CSSProperties)
                  : ({ "--enter-x": `${HAND_SPLIT_DISTANCE}px`, "--enter-y": "0px" } as CSSProperties)
                : undefined;
              return <TileView key={i} code="1m" faceDown small slideIn={splitting ? "default" : undefined} style={style} />;
            })}
            {hasPendingDraw && <TileView key="drawn" code="1m" faceDown small drawn />}
          </div>
        </div>
        <div className="opponent-melds">
          <div className="opponent-melds__inner">
            {p.hand.melds.map((m, i) => (
              <div key={i} className="meld meld--small">
                {m.tiles.map((t, j) => (
                  <TileView key={j} code={t.code} small rotated={m.calledTile?.id === t.id} red={t.isRed} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
