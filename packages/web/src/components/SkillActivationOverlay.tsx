import { useEffect, useRef, useState } from "react";
import { CHARACTERS, type RoundState } from "@majyan/core";

const DISPLAY_MS = 1700;

interface ActiveAnnounce {
  characterId: string;
  /** 同じキャラが連続で発動した時もCSSアニメーションを最初からやり直させるための一意キー。 */
  key: number;
}

/**
 * 必殺技発動の瞬間、キャラ絵が画面端からカットインするド派手な演出。
 * 自分・CPU3人のどのプレイヤーが発動しても、この1箇所で検知して表示する
 * （以前はHand.tsx/OpponentArea.tsxにそれぞれ小さな吹き出しを出していたが、
 * 「押した後にしか何が起きたか分からない」上に地味との指摘を受け、ここに一本化した）。
 * cutin画像（縦長の立ち絵）が用意されているキャラはそれを、無ければavatar
 * （円形アイコン）を代わりに大きく表示する。
 */
export function SkillActivationOverlay({ round }: { round: RoundState }) {
  const gauges = round.players.map((p) => p.skillGauge);
  const gaugeSignature = gauges.join(",");
  const prevGaugesRef = useRef(gauges);
  const keyRef = useRef(0);
  const [active, setActive] = useState<ActiveAnnounce | null>(null);

  useEffect(() => {
    const prev = prevGaugesRef.current;
    prevGaugesRef.current = gauges;
    // ゲージは通常の加算では減らないため、満タン(>0)から0への低下＝発動とみなせる。
    for (let i = 0; i < gauges.length; i++) {
      if (prev[i]! > 0 && gauges[i] === 0) {
        keyRef.current += 1;
        setActive({ characterId: round.characterIds[i]!, key: keyRef.current });
        const timer = setTimeout(() => setActive(null), DISPLAY_MS);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [gaugeSignature]);

  // ナオキの「クマクマタイム」等、ゲージを使わず配牌時に自動発動するパッシブ
  // 系の演出。上のゲージ低下検知では拾えないため、局の切り替わり
  // （東/南・局番号・本場の組み合わせが変わった瞬間）を別途検知し、その
  // 新しい局がround.dealerRenchanByWinで、かつ親のキャラがonDealHandを
  // 持つ（＝実際にこの局でパッシブが働いた）場合にだけカットインを出す。
  const roundKey = `${round.roundWind}-${round.roundNumber}-${round.honba}`;
  const prevRoundKeyRef = useRef(roundKey);
  useEffect(() => {
    const prevKey = prevRoundKeyRef.current;
    prevRoundKeyRef.current = roundKey;
    if (prevKey === roundKey) return undefined;
    if (!round.dealerRenchanByWin) return undefined;
    const dealerCharacter = CHARACTERS[round.characterIds[round.dealerSeat]];
    if (!dealerCharacter || typeof dealerCharacter.skill.hooks.onDealHand !== "function") return undefined;
    keyRef.current += 1;
    setActive({ characterId: dealerCharacter.id, key: keyRef.current });
    const timer = setTimeout(() => setActive(null), DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [roundKey, round.dealerRenchanByWin, round.dealerSeat, round.characterIds]);

  // トモヒロの「手牌が一枚しかいない人」用の演出。こちらもゲージを使わない
  // パッシブ（かつナオキと違い配牌時ではなく任意のツモ直前に不定期発動する）
  // ため、上のどちらの検知にも乗らない。実際にすり替えが起きるたびgameEngine.ts
  // 側が単調増加させるround.tomohiroGuardCountの増分だけを見て発動とみなす。
  const tomohiroGuardCount = round.tomohiroGuardCount;
  const prevTomohiroGuardCountRef = useRef(tomohiroGuardCount);
  useEffect(() => {
    const prev = prevTomohiroGuardCountRef.current;
    prevTomohiroGuardCountRef.current = tomohiroGuardCount;
    if (tomohiroGuardCount <= prev) return undefined;
    const seat = round.characterIds.indexOf("tomohiro");
    if (seat === -1) return undefined;
    keyRef.current += 1;
    setActive({ characterId: "tomohiro", key: keyRef.current });
    const timer = setTimeout(() => setActive(null), DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [tomohiroGuardCount, round.characterIds]);

  if (!active) return null;
  const character = CHARACTERS[active.characterId];
  if (!character) return null;

  return (
    <div className="skill-activation-overlay" key={active.key}>
      <div className="skill-activation-overlay__flash" />
      <div className="skill-activation-overlay__burst" />
      <div className="skill-activation-overlay__cutin-wrap">
        <div className="skill-activation-overlay__panel" />
        <img className="skill-activation-overlay__cutin" src={character.cutin ?? character.avatar} alt="" />
      </div>
      <div className="skill-activation-overlay__text">
        <div className="skill-activation-overlay__name">{character.name}</div>
        <div className="skill-activation-overlay__skill">{character.skill.name}</div>
      </div>
    </div>
  );
}
