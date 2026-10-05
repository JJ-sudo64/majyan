import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CHARACTERS, CUTIN_DISPLAY_MS, type DeclarationArt, type RoundState } from "@majyan/core";
import { useDeclarationCutinStore } from "../store/declarationCutinStore.js";

export type Declaration = "riichi" | "tsumo" | "ron";

/** リーチは対局が止まらないので短め、ツモ・ロンは点数画面の前にじっくり見せる。 */
// リーチの長さはネット対戦でサーバーが制限時間を止める長さと揃える（turnClock.tsのcutinHoldMs）。
const DISPLAY_MS: Record<Declaration, number> = { riichi: CUTIN_DISPLAY_MS.riichi, tsumo: 2200, ron: 2200 };

const WORDS: Record<Declaration, string> = { riichi: "リーチ", tsumo: "ツモ", ron: "ロン" };

/** 1枚絵の縦横比。生成した絵はどれも16:9(1671x941)。cropの帯の縦横比はこれから求める。 */
const ART_ASPECT = 16 / 9;

/** Character.declarationAccent未指定時の色。 */
const DEFAULT_ACCENT = "#a866ff";

interface ActiveCutin {
  kind: Declaration;
  src: string;
  /** 絵に文字が描き込まれていない時だけtrue（演出側で文字を重ねる）。 */
  addWord: boolean;
  crop: DeclarationArt["crop"];
  keepEdge: DeclarationArt["keepEdge"];
  accent: string;
  /** 同じ宣言が続いた時もCSSアニメーションを最初からやり直させるための一意キー。 */
  key: number;
}

function cutinFor(round: RoundState, seat: number, kind: Declaration): Omit<ActiveCutin, "key"> | null {
  return characterCutin(round.characterIds[seat]!, kind);
}

/** キャラIDと宣言から、カットインの表示内容を作る。1枚絵が無ければnull。 */
export function characterCutin(characterId: string, kind: Declaration): Omit<ActiveCutin, "key"> | null {
  const character = CHARACTERS[characterId];
  const art = character?.declarationArt?.[kind];
  if (!art) return null;
  return { kind, src: art.src, addWord: art.addWord ?? false, crop: art.crop, keepEdge: art.keepEdge, accent: character.declarationAccent ?? DEFAULT_ACCENT };
}

/** ダブロン・トリロンで、1枚絵の無いキャラの番に置く間（カットインは出さず掛け声だけ鳴らす）。 */
const WIN_SLOT_WITHOUT_ART_MS = 900;

export interface WinDeclarationStep {
  seat: number;
  kind: "tsumo" | "ron";
  /** 和了が決まってから、この人のカットイン・掛け声を始めるまでの時間。 */
  startMs: number;
  cutin: Omit<ActiveCutin, "key"> | null;
}

/**
 * 和了の宣言を出す順番と時刻。ダブロン・トリロンでは和了者全員を、精算と同じ
 * 放銃者に近い順（result.winnersの順）に1人ずつ出す。カットインの表示
 * （DeclarationCutinOverlay）と掛け声（useGameSounds）の両方がこれに合わせる。
 */
export function winDeclarationSchedule(round: RoundState): WinDeclarationStep[] {
  const result = round.phase === "round-over" ? round.result : null;
  if (!result || (result.type !== "tsumo" && result.type !== "ron")) return [];
  const kind = result.type;
  const steps: WinDeclarationStep[] = [];
  let t = 0;
  for (const seat of result.winners) {
    const cutin = cutinFor(round, seat, kind);
    steps.push({ seat, kind, startMs: t, cutin });
    t += cutin ? DISPLAY_MS[kind] : WIN_SLOT_WITHOUT_ART_MS;
  }
  return steps;
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
  /** 和了のカットインを順に流している間（点数画面を待たせる）。 */
  const [winSequencePlaying, setWinSequencePlaying] = useState(false);
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

  // ツモ・ロン: 局が和了で終わった瞬間を検知する。ダブロン・トリロンでは和了者全員の
  // カットインを順に流す（winDeclarationSchedule）。点数画面より先に出すため、描画前
  // (useLayoutEffect)に検知する。
  const result = round.phase === "round-over" ? round.result : null;
  const winKey = result && (result.type === "tsumo" || result.type === "ron") ? `${round.roundWind}-${round.roundNumber}-${round.honba}-${result.type}-${result.winners.join(",")}` : null;
  const prevWinKeyRef = useRef(winKey);
  const winTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useLayoutEffect(() => {
    const prev = prevWinKeyRef.current;
    prevWinKeyRef.current = winKey;
    if (!winKey || winKey === prev) return;
    const steps = winDeclarationSchedule(round);
    const withArt = steps.filter((s) => s.cutin);
    if (withArt.length === 0) return;
    for (const t of winTimersRef.current) clearTimeout(t);
    const show = (cutin: Omit<ActiveCutin, "key">) => {
      keyRef.current += 1;
      setActive({ ...cutin, key: keyRef.current });
    };
    const last = withArt[withArt.length - 1]!;
    const endMs = last.startMs + DISPLAY_MS[last.kind];
    setWinSequencePlaying(true);
    winTimersRef.current = [
      ...withArt.map((s) => (s.startMs === 0 ? (show(s.cutin!), null) : setTimeout(() => show(s.cutin!), s.startMs))),
      setTimeout(() => {
        setActive(null);
        setWinSequencePlaying(false);
      }, endMs),
    ].filter((t): t is ReturnType<typeof setTimeout> => t !== null);
  }, [winKey]);
  useEffect(() => () => winTimersRef.current.forEach(clearTimeout), []);

  // リーチのカットインは表示時間が過ぎたら消す（和了のカットインは上の予定で消す）。
  useEffect(() => {
    if (!active || active.kind !== "riichi") return undefined;
    const timer = setTimeout(() => setActive(null), DISPLAY_MS[active.kind]);
    return () => clearTimeout(timer);
  }, [active]);

  // 点数画面を待たせるフラグは、和了のカットインを流している間（ダブロンで次の人へ
  // 切り替わる間も含む）立てておく。描画前に反映し、点数画面が一瞬でも先に見えないようにする。
  const winCutinPlaying = winSequencePlaying;
  useLayoutEffect(() => {
    setWinCutinPlaying(winCutinPlaying);
  }, [winCutinPlaying, setWinCutinPlaying]);

  // 画面を離れた(対局終了等)時に点数画面が待たされたままにならないよう戻す。
  useEffect(() => () => setWinCutinPlaying(false), [setWinCutinPlaying]);

  if (!active) return null;
  return <DeclarationCutinView cutin={active} key={active.key} />;
}

/**
 * 宣言カットインの見た目だけ（検知やタイマーは持たない）。対局中の
 * DeclarationCutinOverlayと、全キャラ一覧(CutinGallery.tsx)の両方で使う。
 */
export function DeclarationCutinView({ cutin }: { cutin: Omit<ActiveCutin, "key"> }) {
  const { crop } = cutin;
  // cropがあれば、帯をその範囲の縦横比にし、絵を拡大・ずらして範囲だけを帯に写す。
  const bandStyle = crop ? ({ "--band-aspect": (crop.w / crop.h) * ART_ASPECT } as CSSProperties) : undefined;
  const artStyle: CSSProperties | undefined = crop
    ? {
        position: "absolute",
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
        left: `${(-100 * crop.x) / crop.w}%`,
        top: `${(-100 * crop.y) / crop.h}%`,
        maxWidth: "none",
      }
    : undefined;
  return (
    <div
      className={`declaration-cutin declaration-cutin--${cutin.kind}${cutin.keepEdge ? ` declaration-cutin--keep-${cutin.keepEdge}` : ""}`}
      style={{ "--accent": cutin.accent } as CSSProperties}
    >
      <div className="declaration-cutin__flash" />
      <div className="declaration-cutin__band" style={bandStyle}>
        <img className="declaration-cutin__art" src={cutin.src} alt="" style={artStyle} />
        <div className="declaration-cutin__sweep" />
      </div>
      {cutin.addWord && <div className="declaration-cutin__word">{WORDS[cutin.kind]}</div>}
    </div>
  );
}
