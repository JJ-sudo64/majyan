import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CHARACTERS, type RoundState } from "@majyan/core";
import { useDeclarationCutinStore } from "../store/declarationCutinStore.js";

type Declaration = "riichi" | "tsumo" | "ron";

/** リーチは対局が止まらないので短め、ツモ・ロンは点数画面の前にじっくり見せる。 */
const DISPLAY_MS: Record<Declaration, number> = { riichi: 1600, tsumo: 2200, ron: 2200 };

const WORDS: Record<Declaration, string> = { riichi: "リーチ", tsumo: "ツモ", ron: "ロン" };

/** Character.declarationAccent未指定時の色。 */
const DEFAULT_ACCENT = "#a866ff";

interface ActiveCutin {
  kind: Declaration;
  src: string;
  /** 絵に文字が描き込まれていない時だけtrue（演出側で文字を重ねる）。 */
  addWord: boolean;
  accent: string;
  /** 同じ宣言が続いた時もCSSアニメーションを最初からやり直させるための一意キー。 */
  key: number;
}

function cutinFor(round: RoundState, seat: number, kind: Declaration): Omit<ActiveCutin, "key"> | null {
  const character = CHARACTERS[round.characterIds[seat]!];
  const art = character?.declarationArt?.[kind];
  if (!art) return null;
  return { kind, src: art.src, addWord: art.addWord ?? false, accent: character.declarationAccent ?? DEFAULT_ACCENT };
}

/**
 * リーチ・ツモ・ロンを宣言した瞬間に、そのキャラの1枚絵(Character.declarationArt)
 * を画面いっぱいに出す演出。自分・CPUのどの座席でも、この1箇所で検知する
 * （SkillActivationOverlay.tsxと同じ考え方）。1枚絵を用意したキャラ・宣言だけ
 * 出し、無ければ何もしない。ツモ・ロンの間は点数画面を待たせる
 * （declarationCutinStore.ts参照）。
 */
export function DeclarationCutinOverlay({ round }: { round: RoundState }) {
  const keyRef = useRef(0);
  const [active, setActive] = useState<ActiveCutin | null>(null);
  const setWinCutinPlaying = useDeclarationCutinStore((s) => s.setWinCutinPlaying);

  // リーチ: riichiフラグがfalse→trueになった座席を検知する。新しい局の配牌で
  // 全員falseへ戻るのは「解除」なので演出の対象外。
  const riichiFlags = round.players.map((p) => p.riichi);
  const riichiSignature = riichiFlags.join(",");
  const prevRiichiRef = useRef(riichiFlags);
  useEffect(() => {
    const prev = prevRiichiRef.current;
    prevRiichiRef.current = riichiFlags;
    for (let seat = 0; seat < riichiFlags.length; seat++) {
      if (prev[seat] || !riichiFlags[seat]) continue;
      const cutin = cutinFor(round, seat, "riichi");
      if (!cutin) continue;
      keyRef.current += 1;
      setActive({ ...cutin, key: keyRef.current });
      return;
    }
  }, [riichiSignature]);

  // ツモ・ロン: 局が和了で終わった瞬間を検知する。ダブロン等で和了者が複数なら、
  // 1枚絵を持つ最初の和了者を出す。点数画面より先に出すため、描画前
  // (useLayoutEffect)に検知する。
  const result = round.phase === "round-over" ? round.result : null;
  const winKey = result && (result.type === "tsumo" || result.type === "ron") ? `${round.roundWind}-${round.roundNumber}-${round.honba}-${result.type}-${result.winners.join(",")}` : null;
  const prevWinKeyRef = useRef(winKey);
  useLayoutEffect(() => {
    const prev = prevWinKeyRef.current;
    prevWinKeyRef.current = winKey;
    if (!winKey || winKey === prev || !result) return;
    const kind = result.type as "tsumo" | "ron";
    for (const seat of result.winners) {
      const cutin = cutinFor(round, seat, kind);
      if (!cutin) continue;
      keyRef.current += 1;
      setActive({ ...cutin, key: keyRef.current });
      return;
    }
  }, [winKey]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setActive(null), DISPLAY_MS[active.kind]);
    return () => clearTimeout(timer);
  }, [active]);

  // 点数画面を待たせるフラグは、表示中のカットインから直接決める（別々に
  // 立て下ろしすると、途中で別のカットインに切り替わった時に立ちっぱなしに
  // なり得るため）。描画前に反映し、点数画面が一瞬でも先に見えないようにする。
  const winCutinPlaying = active !== null && active.kind !== "riichi";
  useLayoutEffect(() => {
    setWinCutinPlaying(winCutinPlaying);
  }, [winCutinPlaying, setWinCutinPlaying]);

  // 画面を離れた(対局終了等)時に点数画面が待たされたままにならないよう戻す。
  useEffect(() => () => setWinCutinPlaying(false), [setWinCutinPlaying]);

  if (!active) return null;
  return (
    <div
      className={`declaration-cutin declaration-cutin--${active.kind}`}
      key={active.key}
      style={{ "--accent": active.accent } as CSSProperties}
    >
      <div className="declaration-cutin__flash" />
      <div className="declaration-cutin__band">
        <img className="declaration-cutin__art" src={active.src} alt="" />
        <div className="declaration-cutin__sweep" />
      </div>
      {active.addWord && <div className="declaration-cutin__word">{WORDS[active.kind]}</div>}
    </div>
  );
}
