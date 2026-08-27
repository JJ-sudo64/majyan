import { useState } from "react";
import type { Meld, RoundState, TileCode, Hand as HandShape } from "@majyan/core";
import {
  canDeclareTsumo,
  canRiichi,
  riichiCandidateTileIds,
  ankanOptions,
  kakanOptions,
  canKyushuKyuhai,
  getWaitingTiles,
  doraIndicators,
} from "@majyan/core";
import { useGameStore } from "../store/gameStore.js";
import { TileView } from "./TileView.js";
import { CallPrompt } from "./CallPrompt.js";

const HUMAN = 0 as const;

// じゃんたま等を参考に、テンパイ時は待ち牌を一覧表示する。「あと何枚
// 見えているか」も添えたいので、自分の手牌（伏せられておらず自分には
// 見えている）・全員の副露（公開情報）・鳴かれていない捨て牌（公開情報）・
// ドラ表示牌を数え、4枚からその分を引く。他家の伏せた手牌は数えない
// （プレイヤーには見えていない情報のため）。
function countVisibleTiles(round: RoundState, code: TileCode): number {
  let count = 0;
  const human = round.players[HUMAN];
  for (const t of human.hand.concealed) if (t.code === code) count++;
  for (const p of round.players) {
    for (const m of p.hand.melds) {
      for (const t of m.tiles) if (t.code === code) count++;
    }
    for (const d of p.discards) if (!d.calledAway && d.tile.code === code) count++;
  }
  for (const indicator of doraIndicators(round.wall)) if (indicator === code) count++;
  return count;
}

function MeldView({ meld }: { meld: Meld }) {
  return (
    <div className="meld">
      {meld.tiles.map((t, i) => (
        <TileView
          key={i}
          code={t.code}
          small
          dimmed={meld.type === "ankan" && (i === 0 || i === meld.tiles.length - 1)}
          rotated={meld.calledTile?.id === t.id}
          red={t.isRed}
        />
      ))}
    </div>
  );
}

export function Hand({ round }: { round: RoundState }) {
  const humanDiscard = useGameStore((s) => s.humanDiscard);
  const humanRiichi = useGameStore((s) => s.humanRiichi);
  const humanTsumo = useGameStore((s) => s.humanTsumo);
  const humanAnkan = useGameStore((s) => s.humanAnkan);
  const humanKakan = useGameStore((s) => s.humanKakan);
  const humanKyushuKyuhai = useGameStore((s) => s.humanKyushuKyuhai);
  const [riichiMode, setRiichiMode] = useState(false);
  // リーチ選択中の待ちプレビュー専用のホバー状態。盤面全体で共有される
  // hoveredCode（同一牌ハイライト用、code単位）をそのまま使うと、河や
  // 他家の副露にたまたま同じcodeの牌が見えているだけでもプレビューが
  // 反応してしまう不具合があった。自分の手牌の候補牌そのものへのホバー
  // だけを拾うよう、牌ID単位でローカルに持つ。
  const [hoveredCandidateId, setHoveredCandidateId] = useState<string | null>(null);

  const humanCallOptions = useGameStore((s) => s.humanCallOptions);
  const player = round.players[HUMAN];
  const isMyTurn = round.currentTurn === HUMAN && round.phase === "awaiting-discard";
  const isAwaitingCall = !!humanCallOptions && round.phase === "awaiting-calls";
  const tsumoAnalysis = isMyTurn ? canDeclareTsumo(round, HUMAN) : null;
  const riichiEligible = isMyTurn && canRiichi(round, HUMAN);
  const riichiTileIds = riichiEligible ? new Set(riichiCandidateTileIds(round, HUMAN)) : new Set<string>();
  const ankanChoices = isMyTurn ? ankanOptions(round, HUMAN) : [];
  const kakanChoices = isMyTurn ? kakanOptions(round, HUMAN) : [];
  const kyushuOk = isMyTurn && canKyushuKyuhai(round, HUMAN);

  function handleTileClick(tileId: string) {
    if (!isMyTurn) return;
    if (riichiMode) {
      if (riichiTileIds.has(tileId)) {
        humanRiichi(tileId);
        setRiichiMode(false);
      }
      return;
    }
    if (player.riichi) {
      if (tileId === round.lastDrawnTile?.id) humanDiscard(tileId);
      return;
    }
    humanDiscard(tileId);
  }

  const drawnTileId = isMyTurn ? round.lastDrawnTile?.id : undefined;
  const restTiles = drawnTileId ? player.hand.concealed.filter((t) => t.id !== drawnTileId) : player.hand.concealed;
  const drawnTile = drawnTileId ? player.hand.concealed.find((t) => t.id === drawnTileId) : undefined;

  // まだ切るか決めていないツモ牌（drawnTile）は待ち判定には含めない
  // 「確定している13枚相当」で計算する。自分のターンでなければ
  // restTiles===player.hand.concealedなのでそのまま現在の待ちになる。
  const coreHand: HandShape = { concealed: restTiles, melds: player.hand.melds };

  // 自分の手番中（リーチを選んでいるかどうかに関わらず）、切る牌の候補に
  // カーソルを合わせている間は「その牌を切ったら何待ちになるか」に表示を
  // 切り替える。以前はリーチ選択中（リーチボタンを押した後）だけこの
  // プレビューが働いていたが、それだと通常のテンパイ時（まだリーチ宣言
  // 前）にどの牌を切ればどんな待ちになるか比較できなかった。じゃんたまが
  // 常時この挙動なのに倣い、手番中は常に候補牌をホバーで比較できるように
  // する。合わせていない間はツモ牌をそのまま切ったと仮定した待ちを表示
  // （今まで通り）。リーチ後はツモ切りしか選べず待りも固定されるため対象外。
  const hoveredCandidate = hoveredCandidateId ? player.hand.concealed.find((t) => t.id === hoveredCandidateId) : undefined;
  const previewCode = isMyTurn && !player.riichi && hoveredCandidate ? hoveredCandidate.code : undefined;
  const previewHand: HandShape | undefined = hoveredCandidate && previewCode
    ? (() => {
        const idx = player.hand.concealed.findIndex((t) => t.id === hoveredCandidate.id);
        const concealed = [...player.hand.concealed.slice(0, idx), ...player.hand.concealed.slice(idx + 1)];
        return { concealed, melds: player.hand.melds };
      })()
    : undefined;
  const waitingTiles = getWaitingTiles(previewHand ?? coreHand);

  return (
    <div className="hand-area">
      <div className="hand-row">
        <div className="hand-tiles" data-hand-anchor={HUMAN}>
          {restTiles.map((t) => (
            <TileView
              key={t.id}
              code={t.code}
              onClick={isMyTurn ? () => handleTileClick(t.id) : undefined}
              selected={riichiMode && riichiTileIds.has(t.id)}
              dimmed={riichiMode && !riichiTileIds.has(t.id)}
              red={t.isRed}
              highlightable={false}
              onHoverChange={(hovering) => setHoveredCandidateId((prev) => (hovering ? t.id : prev === t.id ? null : prev))}
            />
          ))}
          {drawnTile && (
            <TileView
              key={drawnTile.id}
              code={drawnTile.code}
              onClick={() => handleTileClick(drawnTile.id)}
              selected={riichiMode && riichiTileIds.has(drawnTile.id)}
              dimmed={riichiMode && !riichiTileIds.has(drawnTile.id)}
              drawn
              red={drawnTile.isRed}
              onHoverChange={(hovering) =>
                setHoveredCandidateId((prev) => (hovering ? drawnTile.id : prev === drawnTile.id ? null : prev))
              }
              highlightable={false}
            />
          )}
        </div>
        <div className="melds-row">
          {/* 最初に鳴いた組を画面右端に、以降は鳴くたびにその左へ付け足す
              （じゃんたま等の一般的な並び）ので、配列を新しい順に描画する。 */}
          {[...player.hand.melds].reverse().map((m, i) => (
            <MeldView key={i} meld={m} />
          ))}
        </div>
      </div>
      <div className="action-row">
        <CallPrompt round={round} active={isAwaitingCall} />
        {isMyTurn && (
          <div className="call-actions">
            {tsumoAnalysis && (
              <button className="btn btn--ron" onClick={() => humanTsumo()}>
                ツモ ({tsumoAnalysis.isYakuman ? "役満" : `${tsumoAnalysis.han}翻${tsumoAnalysis.fu}符`})
              </button>
            )}
            {riichiEligible && !riichiMode && !player.riichi && (
              <button className="btn btn--riichi" onClick={() => setRiichiMode(true)}>
                リーチ
              </button>
            )}
            {riichiMode && (
              <button className="btn btn--skip" onClick={() => setRiichiMode(false)}>
                リーチ取消
              </button>
            )}
            {ankanChoices.map((code) => (
              <button key={code} className="btn btn--call" onClick={() => humanAnkan(code)}>
                暗槓
              </button>
            ))}
            {kakanChoices.map((id) => (
              <button key={id} className="btn btn--call" onClick={() => humanKakan(id)}>
                加槓
              </button>
            ))}
            {kyushuOk && (
              <button className="btn btn--skip" onClick={() => humanKyushuKyuhai()}>
                九種九牌流局
              </button>
            )}
          </div>
        )}
      </div>
      {waitingTiles.length > 0 && (
        <div className="wait-row">
          <span className="wait-row__label">
            {previewCode ? (
              <>
                <TileView code={previewCode} tiny highlightable={false} />
                切りなら
              </>
            ) : (
              "待ち"
            )}
          </span>
          <div className="wait-row__tiles">
            {waitingTiles.map((code) => {
              const remaining = Math.max(0, 4 - countVisibleTiles(round, code));
              return (
                <div key={code} className="wait-row__tile">
                  <TileView code={code} tiny />
                  <span className="wait-row__count">{remaining}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
