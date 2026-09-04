import { useEffect, useRef, useState } from "react";
import type { Meld, RoundState, TileCode, Hand as HandShape } from "@majyan/core";
import {
  CARDS,
  CHARACTERS,
  canDeclareTsumo,
  canRiichi,
  riichiCandidateTileIds,
  ankanOptions,
  kakanOptions,
  canKyushuKyuhai,
  canUseCard,
  canUseSkill,
  canSwapStartingTile,
  getWaitingTiles,
  doraIndicators,
  isFuriten,
  allHandTileCodes,
} from "@majyan/core";
import { useGameStore, TIME_STOP_FAKE_TURN_STEP_MS } from "../store/gameStore.js";
import { useSettingsStore } from "../store/settingsStore.js";
import { TileView } from "./TileView.js";
import { CallPrompt } from "./CallPrompt.js";
import { SkillGauge } from "./SkillGauge.js";

/** 自動ツモ切りが実際に切るまでの待ち時間。0だと切られたことに気付く前に
    河へ飛んでしまい、リーチ・カン等の選択肢に気付いて手を止める余地が
    無くなってしまうため、一呼吸だけ間を置く。 */
const AUTO_TSUMOGIRI_DELAY_MS = 500;

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

// スバルの必殺技「山読み」が発動中は、見えている牌からの推測（4枚からの
// 引き算）ではなく、実際に山(liveTiles)に残っている枚数をそのまま数えて
// 正確な残り枚数として表示する。
function countInLiveWall(round: RoundState, code: TileCode): number {
  let count = 0;
  for (const t of round.wall.liveTiles) if (t.code === code) count++;
  return count;
}

// マサトの必殺技「三色の煌めき」用。1〜7を開始点とする7通りの三色同順
// （例: 開始2なら2m3m4m/2p3p4p/2s3s4s）それぞれについて、手牌（副露込み）
// が実際に持っている該当牌の枚数を数え、最も多く絡んでいる一組を選んで
// その9種のコードのうち実際に手にある牌だけをハイライト対象として返す。
// 該当牌が1枚も無ければ空集合（何も光らない）。
function computeSanshokuHintCodes(hand: HandShape): Set<TileCode> {
  const allCodes = allHandTileCodes(hand);
  let bestCodes: TileCode[] = [];
  let bestCount = 0;
  for (let n = 1; n <= 7; n++) {
    const runCodes = [
      `${n}m`,
      `${n + 1}m`,
      `${n + 2}m`,
      `${n}p`,
      `${n + 1}p`,
      `${n + 2}p`,
      `${n}s`,
      `${n + 1}s`,
      `${n + 2}s`,
    ] as TileCode[];
    const matched = allCodes.filter((c) => runCodes.includes(c));
    if (matched.length > bestCount) {
      bestCount = matched.length;
      bestCodes = matched;
    }
  }
  return new Set(bestCodes);
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

export function Hand({ round, onShowSkillInfo }: { round: RoundState; onShowSkillInfo: () => void }) {
  const humanDiscard = useGameStore((s) => s.humanDiscard);
  const humanRiichi = useGameStore((s) => s.humanRiichi);
  const humanTsumo = useGameStore((s) => s.humanTsumo);
  const humanAnkan = useGameStore((s) => s.humanAnkan);
  const humanKakan = useGameStore((s) => s.humanKakan);
  const humanKyushuKyuhai = useGameStore((s) => s.humanKyushuKyuhai);
  const humanUseSkill = useGameStore((s) => s.humanUseSkill);
  const humanUseCard = useGameStore((s) => s.humanUseCard);
  const humanSwapTiles = useGameStore((s) => s.humanSwapTiles);
  const [riichiMode, setRiichiMode] = useState(false);
  // ルナの必殺技で得た配牌入れ替え権を使っている間のモード。手番かどうかに
  // 関わらず（配牌直後、自分の手番が来る前でも）使えるようにするため、
  // isMyTurnとは独立したトグルにしてある。交換は1枚ずつ即時ではなく、
  // 残り枚数ぶん選び終えてから「交換する」で一括確定する仕様のため、
  // 選択中の牌idも別途保持する。
  const [swapMode, setSwapMode] = useState(false);
  const [swapSelection, setSwapSelection] = useState<string[]>([]);
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
  const skillReady = isMyTurn && canUseSkill(round, HUMAN);
  const character = CHARACTERS[round.characterIds[HUMAN]];
  // 必殺技発動の演出はTable.tsxのSkillActivationOverlay（卓全体を使った
  // ド派手な演出）に一本化したため、ここでの個別表示は行わない。

  const heldCard = round.cardIds[HUMAN] ? CARDS[round.cardIds[HUMAN]!] : undefined;
  const cardReady = isMyTurn && canUseCard(round, HUMAN);

  // 必殺技「時間停止」発動中の演出。OpponentArea.tsxと同じロジック
  // （発動者以外は丸ごとグレーアウト＋ボーナス手番の間だけ座順どおりの
  // 空振り演出）を、自分(HUMAN)が発動者かどうかで判定する。
  const timeStopSource = ([0, 1, 2, 3] as const).find((seat) => round.players[seat]!.timeStopTurnsRemaining > 0);
  const isTimeStopped = timeStopSource !== undefined;
  const isTimeStopSource = timeStopSource === HUMAN;
  const frozen = isTimeStopped && !isTimeStopSource;
  const fakeTurnWindow = isTimeStopped && round.phase === "awaiting-draw" && round.currentTurn === timeStopSource;
  const fakeTurnStepIndex = frozen && fakeTurnWindow ? (HUMAN - timeStopSource! + 4) % 4 : 0; // 1〜3

  const swapAvailable = canSwapStartingTile(round, HUMAN);
  // 交換権を使い切った/局が進んだ等でswapAvailableがfalseに戻ったら、
  // モードに入ったままボタンだけ消えて操作不能に見えないよう自動で抜ける。
  useEffect(() => {
    if (!swapAvailable && swapMode) {
      setSwapMode(false);
      setSwapSelection([]);
    }
  }, [swapAvailable, swapMode]);

  function handleTileClick(tileId: string) {
    if (swapMode) {
      setSwapSelection((prev) => {
        if (prev.includes(tileId)) return prev.filter((id) => id !== tileId);
        if (prev.length >= player.tileSwapsRemaining) return prev; // 残り枚数以上は選べない
        return [...prev, tileId];
      });
      return;
    }
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

  // isMyTurn（phase==="awaiting-discard"）だけで判定すると、ツモ和了で
  // phaseが"round-over"へ変わった瞬間にこの除外が効かなくなり、和了済み
  // （4面子+雀頭が既に揃った14枚）の手牌をそのままrestTiles/coreHandへ
  // 渡してしまっていた。「既に完成している手」に何を1枚足してもshanten
  // 計算上は無視できる余り牌として扱われ和了形のまま=-1になるため、
  // getWaitingTilesがほぼ全種類の牌を「待ち」として返し、待ち欄に大量の
  // 牌が並ぶ不具合になっていた。ツモ和了直後も自分の手番のまま
  // （currentTurnは変わらない）なので、phaseではなくcurrentTurnで判定する。
  // 打牌後（awaiting-calls中）はlastDrawnTileが既に手牌から取り除かれた
  // 牌のidを指したままになるが、その場合はfilter/findが単に何も見つけず
  // 無害（＝以前と同じ挙動）。
  const drawnTileId = round.currentTurn === HUMAN ? round.lastDrawnTile?.id : undefined;
  const restTiles = drawnTileId ? player.hand.concealed.filter((t) => t.id !== drawnTileId) : player.hand.concealed;
  const drawnTile = drawnTileId ? player.hand.concealed.find((t) => t.id === drawnTileId) : undefined;

  // じゃんたま等の「自動ツモ切り」「自動和了」相当。設定はlocalStorageに
  // 保存され対局をまたいで覚えている（settingsStore.ts参照）。
  const autoTsumogiri = useSettingsStore((s) => s.autoTsumogiri);
  const autoWin = useSettingsStore((s) => s.autoWin);

  // 自動和了: ツモ和了できる瞬間、ボタンを押さず即座に和了する。
  useEffect(() => {
    if (autoWin && tsumoAnalysis) humanTsumo();
  }, [autoWin, tsumoAnalysis, humanTsumo]);

  // 自動ツモ切り: 和了できる場合は自動和了に判断を譲るためここでは切らない
  // （勝手に捨てて和了を逃さないため）。配牌交換モード中は牌クリックの
  // 意味が変わるため対象外。それ以外は一呼吸置いてから自動でツモった牌を
  // 切る（即切りだとリーチ・カン等に気付いて手を止める余地が無くなるため）。
  useEffect(() => {
    if (!autoTsumogiri || !isMyTurn || !drawnTile || tsumoAnalysis || swapMode) return;
    const timer = setTimeout(() => humanDiscard(drawnTile.id), AUTO_TSUMOGIRI_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoTsumogiri, isMyTurn, drawnTile, tsumoAnalysis, swapMode, humanDiscard]);

  // ナギの「積み込み」等、ツモ牌をすり替える必殺技を使った瞬間だけ、
  // その場でカードがひっくり返るような演出を挟む。「牌がいきなり変わって
  // いてすり替えた感が薄い」との指摘のため。
  // 判定は「必殺技ゲージが満タン(>0)から0に戻った（＝発動した）瞬間」かつ
  // 「同じ手番のままツモ牌のidが変わった」の両方が揃った時だけに絞る
  // （カン後の嶺上ツモ等、普通にツモ牌が変わる場面まで誤発火させないため）。
  const prevDrawnRef = useRef(drawnTile);
  const prevGaugeRef = useRef(player.skillGauge);
  const swapKeyRef = useRef(0);
  const [swapEffect, setSwapEffect] = useState<{
    fromCode: TileCode;
    fromRed?: boolean;
    toCode: TileCode;
    toRed?: boolean;
    key: number;
  } | null>(null);
  useEffect(() => {
    const prevDrawn = prevDrawnRef.current;
    const prevGauge = prevGaugeRef.current;
    prevDrawnRef.current = drawnTile;
    prevGaugeRef.current = player.skillGauge;
    if (prevGauge > 0 && player.skillGauge === 0 && prevDrawn && drawnTile && prevDrawn.id !== drawnTile.id) {
      swapKeyRef.current += 1;
      setSwapEffect({ fromCode: prevDrawn.code, fromRed: prevDrawn.isRed, toCode: drawnTile.code, toRed: drawnTile.isRed, key: swapKeyRef.current });
      const timer = setTimeout(() => setSwapEffect(null), 700);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [drawnTile, player.skillGauge]);

  // マサトの必殺技「三色の煌めき」発動演出。この技はround側の状態を
  // 一切変えない（onActivateはround不変のno-op）純粋な見た目だけの効果
  // のため、他の必殺技と同じ「ゲージが満タン(>0)から0に戻った瞬間」検知を
  // ここでも流用し、5秒間だけ該当牌をtile--sanshoku-hintで光らせる。
  // swapEffect用のprevGaugeRefと共用すると片方のuseEffectが先に消費して
  // しまい判定が壊れるため、専用のrefを別に持つ。
  const prevSanshokuGaugeRef = useRef(player.skillGauge);
  const [sanshokuHintCodes, setSanshokuHintCodes] = useState<Set<TileCode> | null>(null);
  useEffect(() => {
    const prevGauge = prevSanshokuGaugeRef.current;
    prevSanshokuGaugeRef.current = player.skillGauge;
    if (character?.skill.id === "masato-sanshoku-kirameki" && prevGauge > 0 && player.skillGauge === 0) {
      setSanshokuHintCodes(computeSanshokuHintCodes(player.hand));
      const timer = setTimeout(() => setSanshokuHintCodes(null), 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [character, player.skillGauge, player.hand]);

  // まだ切るか決めていないツモ牌（drawnTile）は待ち判定には含めない
  // 「確定している13枚相当」で計算する。自分のターンでなければ
  // restTiles===player.hand.concealedなのでそのまま現在の待ちになる。
  const coreHand: HandShape = { concealed: restTiles, melds: player.hand.melds };

  // coreHandが実際に「13枚相当」になっているかどうか。ツモ直後はdrawnTileId
  // の除外で正しく13枚相当まで戻るが、チー/ポンで4つ目の面子を完成させた
  // 直後（まだ何を切るか決めていない状態）はround.lastDrawnTileが更新されず
  // 古いツモ牌のidを指したまま（gameEngine.tsのexecuteMeldCall参照。カンは
  // 嶺上ツモでlastDrawnTileが更新されるため対象外）になるため、restTilesの
  // 除外が空振りしてconcealedが1枚多い「14枚相当」のまま残ってしまう。
  // この14枚相当のhandをgetWaitingTilesにそのまま渡すと、超過した1枚を
  // 「シャンテン計算上ただ捨てられるだけの余り牌」として自由に無視できて
  // しまい、ほぼ全ての候補牌が和了牌として誤検出される（フリテンも連動して
  // 誤表示される）不具合になっていた。この状態では（ホバー中のプレビューを
  // 除き）待ち表示自体を出さないことで回避する。
  const isResolvedCoreHand = restTiles.length === 13 - player.hand.melds.length * 3;

  // 自分の手番中（リーチを選んでいるかどうかに関わらず）、切る牌の候補に
  // カーソルを合わせている間は「その牌を切ったら何待ちになるか」に表示を
  // 切り替える。以前はリーチ選択中（リーチボタンを押した後）だけこの
  // プレビューが働いていたが、それだと通常のテンパイ時（まだリーチ宣言
  // 前）にどの牌を切ればどんな待ちになるか比較できなかった。じゃんたまが
  // 常時この挙動なのに倣い、手番中は常に候補牌をホバーで比較できるように
  // する。合わせていない間はツモ牌をそのまま切ったと仮定した待ちを表示
  // （今まで通り）。リーチ後はツモ切りしか選べず待りも固定されるため対象外。
  // previewHandは元のconcealed全体からホバー中の1枚を直接除いて作るため、
  // 上記のisResolvedCoreHandに関わらず常に正しい13枚相当になる。
  const hoveredCandidate = hoveredCandidateId ? player.hand.concealed.find((t) => t.id === hoveredCandidateId) : undefined;
  const previewCode = isMyTurn && !player.riichi && hoveredCandidate ? hoveredCandidate.code : undefined;
  const previewHand: HandShape | undefined = hoveredCandidate && previewCode
    ? (() => {
        const idx = player.hand.concealed.findIndex((t) => t.id === hoveredCandidate.id);
        const concealed = [...player.hand.concealed.slice(0, idx), ...player.hand.concealed.slice(idx + 1)];
        return { concealed, melds: player.hand.melds };
      })()
    : undefined;
  const waitingTiles = previewHand ? getWaitingTiles(previewHand) : isResolvedCoreHand ? getWaitingTiles(coreHand) : [];
  // フリテン判定はホバー中のプレビュー待ちではなく、実際の現在の待ち（coreHand）
  // に対して行う。じゃんたま等と同様「ロンできない理由」が一目でわかるように
  // 手牌下の待ち表示にそのまま添える。coreHandが13枚相当に正規化できていない
  // 間はこちらも計算せず、待ち表示ごと隠す。
  const actualWaitingTiles = isResolvedCoreHand ? (previewHand ? getWaitingTiles(coreHand) : waitingTiles) : [];
  const furiten = actualWaitingTiles.length > 0 && isFuriten({ ...player, hand: coreHand });

  const showTopStatus = player.revealedFutureDraws.length > 0 || waitingTiles.length > 0;

  return (
    <div className={`hand-area${frozen ? " hand-area--frozen" : ""}`}>
      {/* 未来視・待ち表示は左側の縦積み(.hand-left-status)から独立させ、
          手牌の真上・中央に置く。カード/ベタ降りの盾等、左側に積む状態
          表示が増えるにつれ.hand-left-status自体が縦に伸び、これらが下の
          方の状態表示や手牌そのものと被って見えなくなっていたため
          （「待ち表示・未来視の予測牌が手牌と被って見にくい」との指摘）。
          手牌の位置を固定するためabsolute配置にしていた以前のやり方だと、
          両方同時に出た場合など内容が多い時に絶対に被らない保証ができない
          ため、通常のフロー内（.hand-row の前）に置き、内容ぶんだけ
          手牌側が自動で押し下げられる形にして「絶対に被らない」ことを
          保証する。 */}
      {showTopStatus && (
        <div className="hand-top-status">
          {player.revealedFutureDraws.length > 0 && (
            <div className="wait-row">
              <span className="wait-row__label">未来視</span>
              <div className="wait-row__tiles">
                {player.revealedFutureDraws.map((code, i) => (
                  <TileView key={i} code={code} tiny highlightable={false} />
                ))}
              </div>
            </div>
          )}
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
              {furiten && <span className="wait-row__furiten">フリテン</span>}
              {round.wallReadRevealedTo === HUMAN && <span className="wait-row__wallread">山読み中</span>}
              <div className="wait-row__tiles">
                {waitingTiles.map((code) => {
                  const remaining =
                    round.wallReadRevealedTo === HUMAN
                      ? countInLiveWall(round, code)
                      : Math.max(0, 4 - countVisibleTiles(round, code));
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
      )}
      <div className="hand-row">
        <div className="hand-tiles">
          <div className="hand-tiles__real" data-hand-anchor={HUMAN}>
            {restTiles.map((t) => (
              <TileView
                key={t.id}
                code={t.code}
                onClick={isMyTurn || swapMode ? () => handleTileClick(t.id) : undefined}
                selected={(riichiMode && riichiTileIds.has(t.id)) || (swapMode && swapSelection.includes(t.id))}
                dimmed={riichiMode && !riichiTileIds.has(t.id)}
                red={t.isRed}
                highlightable={false}
                sanshokuHint={!!sanshokuHintCodes?.has(t.code)}
                onHoverChange={(hovering) => setHoveredCandidateId((prev) => (hovering ? t.id : prev === t.id ? null : prev))}
              />
            ))}
            {swapEffect ? (
              <div className="tile-swap-flip" key={swapEffect.key}>
                <div className="tile-swap-flip__inner">
                  <div className="tile-swap-flip__face tile-swap-flip__face--front">
                    <TileView code={swapEffect.fromCode} red={swapEffect.fromRed} drawn highlightable={false} />
                  </div>
                  <div className="tile-swap-flip__face tile-swap-flip__face--back">
                    <TileView code={swapEffect.toCode} red={swapEffect.toRed} drawn highlightable={false} />
                  </div>
                </div>
                <div className="tile-swap-flip__flash" />
              </div>
            ) : (
              drawnTile && (
                <TileView
                  key={drawnTile.id}
                  code={drawnTile.code}
                  onClick={() => handleTileClick(drawnTile.id)}
                  selected={(riichiMode && riichiTileIds.has(drawnTile.id)) || (swapMode && swapSelection.includes(drawnTile.id))}
                  dimmed={riichiMode && !riichiTileIds.has(drawnTile.id)}
                  drawn
                  red={drawnTile.isRed}
                  onHoverChange={(hovering) =>
                    setHoveredCandidateId((prev) => (hovering ? drawnTile.id : prev === drawnTile.id ? null : prev))
                  }
                  highlightable={false}
                  sanshokuHint={!!sanshokuHintCodes?.has(drawnTile.code)}
                />
              )
            )}
          </div>
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
        {swapAvailable && !swapMode && (
          <div className="call-actions">
            <button
              className="btn btn--skill"
              onClick={() => {
                setSwapMode(true);
                setSwapSelection([]);
              }}
            >
              配牌交換 (残り{player.tileSwapsRemaining})
            </button>
          </div>
        )}
        {swapMode && (
          <div className="call-actions">
            <span className="wait-row__label">
              {swapSelection.length}/{player.tileSwapsRemaining}枚選択中
            </span>
            {swapSelection.length === player.tileSwapsRemaining && (
              <button
                className="btn btn--skill"
                onClick={() => {
                  humanSwapTiles(swapSelection);
                  setSwapMode(false);
                  setSwapSelection([]);
                }}
              >
                交換する
              </button>
            )}
            <button
              className="btn btn--skip"
              onClick={() => {
                setSwapMode(false);
                setSwapSelection([]);
              }}
            >
              取消
            </button>
          </div>
        )}
        {isMyTurn && (
          <div className="call-actions">
            {skillReady && character && (
              <button className="btn btn--skill" onClick={() => humanUseSkill()} title={character.skill.description}>
                必殺技: {character.skill.name}
              </button>
            )}
            {cardReady && heldCard && (
              <button className="btn btn--skill" onClick={() => humanUseCard()} title={heldCard.description}>
                カード使用: {heldCard.name}
              </button>
            )}
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
      {/* キャラ表示・必殺技ゲージ・待ち表示は左側にまとめて固定する。
          以前はキャラ表示をaction-row（右寄せ、チー/ポン等のボタンで
          幅が変わる）に置いていたため、鳴きの選択肢が出るたびに位置が
          左右にガタついて邪魔だった。ここなら右側のボタンの増減と無関係に
          位置が安定する。 */}
      <div className="hand-left-status">
        {character && (
          <div
            className={`nameplate${fakeTurnStepIndex > 0 ? " nameplate--fake-turn" : ""}`}
            style={
              fakeTurnStepIndex > 0
                ? {
                    animationDelay: `${(fakeTurnStepIndex - 1) * TIME_STOP_FAKE_TURN_STEP_MS}ms`,
                    animationDuration: `${TIME_STOP_FAKE_TURN_STEP_MS}ms`,
                  }
                : undefined
            }
          >
            <img className="nameplate__avatar" src={character.avatar} alt="" />
            <div className="nameplate__text">
              <button type="button" className="nameplate__name nameplate__name--clickable" onClick={onShowSkillInfo}>
                {character.name}
              </button>
              <div className="nameplate__title">あなた</div>
            </div>
          </div>
        )}
        <SkillGauge round={round} player={HUMAN} />
        {heldCard && (
          <div className="wait-row">
            <span className="wait-row__label">カード</span>
            <span
              className={`wait-row__shield${round.cardUsesRemaining[HUMAN] > 0 ? " wait-row__shield--up" : ""}`}
              title={heldCard.description}
            >
              {heldCard.name}
              {heldCard.kind === "passive"
                ? "（常時発動中）"
                : round.cardUsesRemaining[HUMAN] > 0
                  ? `（残り${round.cardUsesRemaining[HUMAN]}回）`
                  : "（使用済み）"}
            </span>
          </div>
        )}
        {player.bettaoriActive && (
          <div className="wait-row">
            <span className="wait-row__label">ベタ降り</span>
            <span className={`wait-row__shield${player.bettaoriShield ? " wait-row__shield--up" : ""}`}>
              {player.bettaoriShield ? "盾あり（ロンされない）" : "盾なし（メンツを崩すと盾が立つ）"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
