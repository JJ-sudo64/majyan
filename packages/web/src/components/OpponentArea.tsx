import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Meld, PlayerIndex, RoundState } from "@majyan/core";
import { TileView } from "./TileView.js";

const HUMAN: PlayerIndex = 0;

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

  // 必殺技発動の演出はTable.tsxのSkillActivationOverlay（卓全体を使った
  // ド派手な演出）に一本化したため、ここでの個別表示は行わない。

  // 自分の手牌(Hand.tsx)と同じく、ツモった直後（まだ切っていない間）は
  // その1枚だけ本体から少し離して見せる。ここでツモ切り／手出しの分かれ道を
  // 作る：
  // - ツモ切り＝この離れた牌がそのまま河へ運ばれる（DiscardPile側の入場
  //   演出が、この牌を含む.opponent-hand-backの右端付近を実測して起点に
  //   使うため、離れた牌の位置とほぼ一致した所から飛んでいくように見える）。
  // - 手出し＝この離れた牌は本体側に合流して見え隠れし、代わりに本体が
  //   中央で割れて別の牌が河へ出ていく（上のsplitting演出）。
  const hasPendingDraw = round.currentTurn === player && round.phase === "awaiting-discard";
  // カゲロウの「透視の術」発動中（自分＝人間プレイヤーに見えている間）、
  // またはこの対面がジンの「大明立直」でオープンリーチ中（p.openRiichi）
  // なら、伏せ牌の代わりに実際の牌柄を表示する。
  const revealHand = round.handsRevealedTo === HUMAN || p.openRiichi;
  const drawnTileId = hasPendingDraw ? round.lastDrawnTile?.id : undefined;
  const mainTiles = drawnTileId ? p.hand.concealed.filter((t) => t.id !== drawnTileId) : p.hand.concealed;
  const drawnTile = drawnTileId ? p.hand.concealed.find((t) => t.id === drawnTileId) : undefined;
  const mainCount = mainTiles.length;
  const leftCount = Math.ceil(mainCount / 2);
  // 上家・下家(opponent-area--1/3)の手牌枠(.opponent-hand-back)は、以前は
  // 常に最大14枚ぶん(474px)を固定で確保していた。鳴いて副露が増えても
  // 手牌側の枠は縮まないため、同じ行内でflex:1により余りしか渡されない
  // 副露側(.opponent-melds)が窮屈になり、90度回転後の見た目の高さが
  // 枠からはみ出して卓の外側で見切れてしまっていた（1副露だけでもtile--small
  // 3枚ぶん≒102pxを要求するのに対し、手牌側が常に474px専有していたため
  // 副露側に残る余白が足りなかった）。手牌が減ったぶんだけ副露に幅を
  // 返せるよう、実際の手牌枚数（ツモ牌含む）から必要な分だけ確保する。
  // ツモった牌(.tile--drawn)には本体から離して見せるための
  // margin-left:10pxが別途乗るため、枚数ぶんの実寸だけでは10px足りず、
  // ツモった瞬間だけそのぶんが枠からはみ出して見切れてしまう
  // （＝ツモっても手が開かれて見えない）。手番中で表示対象がある間だけ
  // その10pxも加算する。
  const handTileCount = p.hand.concealed.length;
  const drawnMargin = hasPendingDraw && drawnTile ? 10 : 0;
  const handGap = 2;
  const handBackTrack = handTileCount > 0 ? handTileCount * (32 + handGap) - handGap + drawnMargin : 0;

  // 副露枠(.opponent-melds)も手牌枠と同じ理屈で、実際の副露牌の実寸から
  // 必要な幅（回転後は「卓の縁沿い」の長さになる）を算出する。以前は
  // 副露どうしを横に並べず1つずつ縦に積んでいたが（回転後は逆に卓の内側へ
  // 向かって伸びる向きになり、鳴くたびに卓へめり込んでいくように見える
  // 不具合になっていた）、自分/対面と同じく鳴いた順に一列へ並べる方式に
  // 統一したことで、この実寸ぶんを手牌と同じ並び方向に確保する必要がある。
  // 1副露あたりの実寸は.meld（tile--small 32px×n + 内側gap1px×(n-1) +
  // padding 2px×2）=33n+3px。ただし鳴いた牌(calledTile、暗槓を除く全て)は
  // 横向き表示(tile--rotated)で幅が32px→43pxに広がる（tile--smallの
  // --tile-h）ため、その差11pxを1副露につき1枚ぶんだけ追加する。副露間は
  // opponent-melds__innerのgap 2pxぶん。
  const ROTATED_TILE_EXTRA_WIDTH = 43 - 32;
  const meldsTrack =
    p.hand.melds.reduce((sum, m) => sum + 33 * m.tiles.length + 3 + (m.calledTile ? ROTATED_TILE_EXTRA_WIDTH : 0), 0) +
    Math.max(0, p.hand.melds.length - 1) * 2;

  // 必殺技「時間停止」発動中の演出。発動者本人（timeStopSource）以外は
  // 手牌ごと丸ごとグレーアウトする（2巡ぶんの発動中はずっと）。
  // ネームプレート側の「空振りの光り演出」（fakeTurnStepIndex）は
  // CharacterPanel.tsxへ移設したため、ここでは手牌グレーアウト用の
  // frozen判定だけ残す。
  const timeStopSource = ([0, 1, 2, 3] as const).find((seat) => round.players[seat]!.timeStopTurnsRemaining > 0);
  const isTimeStopped = timeStopSource !== undefined;
  const frozen = isTimeStopped && timeStopSource !== player;

  return (
    <div
      className={`opponent-area opponent-area--${player}${isCurrent ? " opponent-area--active" : ""}${frozen ? " opponent-area--frozen" : ""}`}
    >
      {callAnnounce && <div className="call-announce">{callAnnounce}</div>}
      <div className="opponent-hand-row">
        <div
          className="opponent-hand-back"
          data-hand-anchor={player}
          style={{ "--hand-back-track": `${handBackTrack}px` } as CSSProperties}
        >
          <div className="opponent-hand-back__inner">
            {mainTiles.map((t, i) => {
              const style: CSSProperties | undefined = splitting
                ? i < leftCount
                  ? ({ "--enter-x": `${-HAND_SPLIT_DISTANCE}px`, "--enter-y": "0px" } as CSSProperties)
                  : ({ "--enter-x": `${HAND_SPLIT_DISTANCE}px`, "--enter-y": "0px" } as CSSProperties)
                : undefined;
              return (
                <TileView
                  key={t.id}
                  code={revealHand ? t.code : "1m"}
                  faceDown={!revealHand}
                  red={revealHand ? t.isRed : undefined}
                  small
                  slideIn={splitting ? "default" : undefined}
                  style={style}
                />
              );
            })}
            {hasPendingDraw && drawnTile && (
              <TileView
                key="drawn"
                code={revealHand ? drawnTile.code : "1m"}
                faceDown={!revealHand}
                red={revealHand ? drawnTile.isRed : undefined}
                small
                drawn
              />
            )}
          </div>
        </div>
        <div className="opponent-melds" style={{ "--melds-track": `${meldsTrack}px` } as CSSProperties}>
          <div className="opponent-melds__inner">
            {(() => {
              // 上家・下家の副露は川の捨て牌と同じ帯（厚み）の向きにしたが、
              // 川と違ってどの牌にも段内の奥行きz-indexが付いていないため、
              // 隣の牌の帯がそのまま前の牌の絵の上に乗って見えてしまって
              // いた（川と同じ「隣り合う牌が互いの帯を隠す」処理が必要）。
              // 帯が伸びる向き（下家=左向き/-X、上家=右向き/+X）へ進むほど
              // 手前に来るよう、副露をまたいだ通し番号でz-indexを振る
              // （.meldはposition未指定でスタッキングコンテキストを
              // 作らないため、この番号は副露の境をまたいでそのまま比較される）。
              let globalIdx = 0;
              return p.hand.melds.map((m, i) => (
                <div key={i} className="meld meld--small">
                  {m.tiles.map((t, j) => {
                    // 暗槓は自己申告のみで鳴きではないため、実際の対局同様
                    // 両端の2枚は伏せたまま（種類を悟らせない）。以前は
                    // dimmed（半透明）にするだけで柄自体は見えてしまっており、
                    // 対戦相手の暗槓の中身が丸わかりになってしまっていた。
                    const isAnkanEdge = m.type === "ankan" && (j === 0 || j === m.tiles.length - 1);
                    const idx = globalIdx++;
                    const zIndexStyle: CSSProperties | undefined =
                      player === 1 ? { zIndex: -idx } : player === 3 ? { zIndex: idx } : undefined;
                    return (
                      <TileView
                        key={j}
                        code={t.code}
                        faceDown={isAnkanEdge}
                        small
                        rotated={m.calledTile?.id === t.id}
                        red={t.isRed}
                        style={zIndexStyle}
                      />
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
