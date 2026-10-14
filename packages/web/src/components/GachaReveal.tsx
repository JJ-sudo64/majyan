import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CARDS, CHARACTERS, rarityOf, type GachaItem, type Rarity } from "@majyan/core";
import { playGachaSound, type SampleHandle } from "../sound.js";
import { RARITY_STARS } from "./GachaCard.js";
import { portalRoot } from "../orientation.js";

/** 光の玉が溜まる時間（その回で一番高いレア度ごと）。高いほど長く引っ張る。 */
const CHARGE_MS: Record<Rarity, number> = { 1: 1300, 2: 1800, 3: 2600 };
/** 玉の色が上がる時刻（白→青→金）。金に上がるのは★3が入っている時だけ。 */
const UPGRADE_AT_MS: Record<2 | 3, number> = { 2: 600, 3: 1500 };
/** 玉がはじけて画面が光る時間。 */
const BURST_MS = 520;
/** ★3の1枚絵を、押されなくても次へ送るまでの時間。 */
const SPOT_AUTO_MS = 3600;
/** はじける時に飛ばす光の粒の数。 */
const SPARKS = 18;

type Phase = "charge" | "burst" | "spot";

/**
 * ガチャを引いた直後の演出（GachaScreen / FirstGacha 共通）。光の玉が溜まり、その回で一番高い
 * レア度に合わせて色が上がり、はじけた後に★3を1つずつ大きく見せてから onDone で結果の一覧へ渡す。
 * 抽選はサーバーで済んでいて、ここは見せ方だけ。画面のどこを押しても先へ進み、「スキップ」で全部飛ばせる。
 * OSで「動きを減らす」設定にしている時は何も出さずにすぐ onDone を呼ぶ。
 */
export function GachaReveal({ items, onDone }: { items: GachaItem[]; onDone: () => void }) {
  const top = items.reduce<Rarity>((best, item) => (rarityOf(item) > best ? rarityOf(item) : best), 1);
  const stars = items.filter((item) => rarityOf(item) === 3);
  const [phase, setPhase] = useState<Phase>("charge");
  const [tier, setTier] = useState<Rarity>(1);
  const [spot, setSpot] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  // 開発時のStrictModeはeffectを2回走らせるので、同じ場面の音を重ねて鳴らさないようにする。
  const soundedRef = useRef("");
  // 溜めの音は、はじけた時（タップで飛ばした時も）と「スキップ」した時に止める。
  const chargeSoundRef = useRef<SampleHandle | null>(null);
  const soundOnce = (key: string, play: () => void) => {
    if (soundedRef.current === key) return;
    soundedRef.current = key;
    play();
  };

  const afterBurst = () => (stars.length > 0 ? setPhase("spot") : doneRef.current());

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) doneRef.current();
  }, []);

  useEffect(() => {
    if (phase === "charge") {
      soundOnce("charge", () => {
        chargeSoundRef.current = playGachaSound("charge", top);
      });
      const timers = [window.setTimeout(() => setPhase("burst"), CHARGE_MS[top])];
      for (const r of [2, 3] as const) {
        if (top < r) continue;
        timers.push(
          window.setTimeout(() => {
            setTier(r);
            playGachaSound("upgrade", r);
          }, UPGRADE_AT_MS[r]),
        );
      }
      return () => timers.forEach((id) => window.clearTimeout(id));
    }
    if (phase === "burst") {
      // 溜めを飛ばして来た時も、はじける色はその回の一番高いレア度にする。
      setTier(top);
      chargeSoundRef.current?.stop(0.04);
      soundOnce("burst", () => playGachaSound("burst", top));
      const id = window.setTimeout(afterBurst, BURST_MS);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [phase]);

  useEffect(() => {
    if (phase !== "spot") return;
    soundOnce(`spot${spot}`, () => playGachaSound("rare"));
    const id = window.setTimeout(nextSpot, SPOT_AUTO_MS);
    return () => window.clearTimeout(id);
  }, [phase, spot]);

  function nextSpot() {
    if (spot + 1 < stars.length) setSpot(spot + 1);
    else doneRef.current();
  }

  function advance() {
    if (phase === "charge") setPhase("burst");
    else if (phase === "burst") afterBurst();
    else nextSpot();
  }

  const item = phase === "spot" ? stars[spot] : undefined;
  const character = item?.kind === "character" ? CHARACTERS[item.id] : undefined;
  const card = item?.kind === "card" ? CARDS[item.id] : undefined;

  return createPortal(
    <div className={`gacha-reveal gacha-reveal--${phase} gacha-reveal--tier${tier}`} onClick={advance}>
      {phase !== "spot" && (
        <div className="gacha-reveal__stage">
          <div className="gacha-reveal__rays" />
          <div className="gacha-reveal__ring" />
          <div className="gacha-reveal__ring gacha-reveal__ring--outer" />
          <div className="gacha-reveal__orb" />
          {phase === "burst" &&
            Array.from({ length: SPARKS }, (_, i) => (
              <span
                key={i}
                className="gacha-reveal__spark"
                style={{ "--angle": `${(360 / SPARKS) * i + (i % 2) * 7}deg`, "--reach": `${34 + (i % 3) * 9}vmin` } as CSSProperties}
              />
            ))}
        </div>
      )}
      {phase === "burst" && <div className="gacha-reveal__flash" />}
      {item && (
        // keyを変えて、★3が続く時も1つずつ登場の動きをやり直す。
        <div key={spot} className="gacha-reveal__spot">
          <div className="gacha-reveal__spot-rays" />
          {character && <img className="gacha-reveal__art" src={character.cutin ?? character.avatar} alt="" />}
          {card && <div className="gacha-reveal__card">{card.kind === "passive" ? "常時" : "消費"}</div>}
          <div className="gacha-reveal__plate">
            <div className="gacha-reveal__stars">{RARITY_STARS[3]}</div>
            {character && <div className="gacha-reveal__title">{character.name.split("・")[0]}</div>}
            <div className="gacha-reveal__name">{character ? character.name.split("・").at(-1) : card?.name}</div>
            <div className="gacha-reveal__skill">{character ? `必殺技「${character.skill.name}」` : "カード"}</div>
          </div>
          {stars.length > 1 && (
            <div className="gacha-reveal__count">
              {spot + 1} / {stars.length}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="gacha-reveal__skip"
        onClick={(e) => {
          e.stopPropagation();
          chargeSoundRef.current?.stop();
          doneRef.current();
        }}
      >
        スキップ
      </button>
      <div className="gacha-reveal__hint">{phase === "spot" ? "タップで次へ" : ""}</div>
    </div>,
    portalRoot(),
  );
}
