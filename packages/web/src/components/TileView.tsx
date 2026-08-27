import { forwardRef, useEffect, useRef, type CSSProperties } from "react";
import type { TileCode } from "@majyan/core";
import { tileImageSrc, TILE_BACK_SRC, TILE_FRONT_SRC } from "../tileGlyph.js";
import { useHoverStore } from "../store/hoverStore.js";
import { useDoraCodes } from "../doraContext.js";

export interface TileViewProps {
  code: TileCode;
  faceDown?: boolean;
  selected?: boolean;
  rotated?: boolean;
  dimmed?: boolean;
  small?: boolean;
  tiny?: boolean;
  drawn?: boolean;
  /** 赤ドラ牌かどうか（表向きの牌にのみ意味を持つ） */
  red?: boolean;
  /** ホバーハイライトの対象にするか（自分の手牌は常に見えているため
      光らせる意味が薄い、という指摘を受けfalseにできるようにした）。
      未指定時はtrue。 */
  highlightable?: boolean;
  /** styleの--enter-x/--enter-yを起点に静止位置へ滑り込むアニメーションを再生する。
      "default"はそのまま滑り込むだけ、"tsumogiri"は起点でいったん静止して
      間を置いてから運ばれる2段階演出（河のツモ切り牌専用）。 */
  slideIn?: "default" | "tsumogiri";
  /** このインスタンス自身（=盤面上の同じcodeの他の牌ではなく）へのホバー開始/終了を
      個別に知りたい呼び出し元向けのコールバック（例：リーチ選択中の待ちプレビューは
      自分の手牌の候補牌そのものにカーソルを合わせた時だけ発動させたく、
      たまたま河等に同じ牌が見えているのを拾ってしまってはいけないため、
      盤面全体で共有されるhoveredCode（同一牌ハイライト用）とは別に使う）。 */
  onHoverChange?: (hovering: boolean) => void;
  style?: CSSProperties;
  onClick?: () => void;
}

export const TileView = forwardRef<HTMLButtonElement, TileViewProps>(function TileView(
  { code, faceDown, selected, rotated, dimmed, small, tiny, drawn, red, highlightable = true, slideIn, onHoverChange, style, onClick },
  ref,
) {
  // じゃんたま風に、同じ牌にカーソルを合わせたら河・副露など盤面上の
  // 同一牌が一斉に光る演出。伏せ牌（自分から見た他家の手牌の裏）は実際の
  // 牌が何かプレイヤーには分からないため、ホバー起点にも光る対象にもしない
  // （codeが意味を持たないプレースホルダーのため）。自分の手牌は常に
  // 見えている情報なので光らせても意味がなく、highlightable=falseで除外する
  // （手牌からホバーを開始すること自体は可能＝河・副露側は光る）。
  const hoveredCode = useHoverStore((s) => s.hoveredCode);
  const setHoveredCode = useHoverStore((s) => s.setHoveredCode);
  const highlighted = highlightable && !faceDown && hoveredCode === code;

  // 現在のドラ表示牌から求まる「実際にドラの牌」なら点滅させ、計算しなくても
  // 一目でドラだとわかるようにする。自分の手牌も含め、表向きの牌ならどこでも
  // 対象にする（ホバーハイライトと違い、自分の手牌でこそ意味がある演出）。
  const doraCodes = useDoraCodes();
  const isDora = !faceDown && doraCodes.has(code);

  // ホバー中の牌がクリックで手牌から消える（打牌・鳴き等でDOMごと
  // 差し替わる）場合、要素が消えるとmouseleaveが発火しないことがあり
  // ホバー状態が残ったままになる。アンマウント時に自分がまだホバー対象
  // なら明示的に解除する。
  // 「codeが一致するかどうか」だけで判定すると、別の理由（例えば待ち牌
  // 表示の中身が変わって、たまたま同じcodeのプレビュー牌が入れ替わる等）
  // で同じcodeの別インスタンスが入れ替わっただけでも誤って解除してしまい、
  // 直前に自分がセットしたホバーまで巻き添えで消してしまう不具合があった
  // （リーチ選択中の待ちプレビューで発覚）。「このインスタンス自身が
  // 現在ホバー中かどうか」をローカルなrefで持ち、自分がホバー中のまま
  // 消える場合だけ解除するようにする。
  const isHoveredRef = useRef(false);
  useEffect(() => {
    return () => {
      if (isHoveredRef.current) {
        useHoverStore.getState().setHoveredCode(null);
      }
    };
  }, []);

  const classes = ["tile"];
  if (selected) classes.push("tile--selected");
  if (rotated) classes.push("tile--rotated");
  if (dimmed) classes.push("tile--dimmed");
  if (tiny) classes.push("tile--tiny");
  else if (small) classes.push("tile--small");
  if (drawn) classes.push("tile--drawn");
  if (highlighted) classes.push("tile--highlighted");
  if (isDora) classes.push("tile--dora");
  if (slideIn === "tsumogiri") classes.push("tile--slide-in-tsumogiri");
  else if (slideIn) classes.push("tile--slide-in");
  if (onClick) classes.push("tile--clickable");

  return (
    <button
      ref={ref}
      type="button"
      className={classes.join(" ")}
      style={style}
      onClick={onClick}
      // 元はdisabled={!onClick}で非操作牌をクリック不可にしていたが、
      // disabled属性が付いたボタンはブラウザがmouseenter/mouseleaveを
      // 一切発火させなくなり、河や副露（クリック不可）でのホバー検知が
      // 丸ごと死んでしまう。onClick未指定時はそもそも何も起きないので、
      // クリック抑止のためのdisabledは不要。フォーカス移動（Tabキー）
      // からだけ装飾牌を除外する。
      tabIndex={onClick ? 0 : -1}
      onMouseEnter={
        faceDown
          ? undefined
          : () => {
              isHoveredRef.current = true;
              setHoveredCode(code);
              onHoverChange?.(true);
            }
      }
      onMouseLeave={
        faceDown
          ? undefined
          : () => {
              isHoveredRef.current = false;
              setHoveredCode(null);
              onHoverChange?.(false);
            }
      }
    >
      {faceDown ? (
        <img className="tile__img" src={TILE_BACK_SRC} alt="" draggable={false} />
      ) : (
        <>
          <img className="tile__img tile__img--base" src={TILE_FRONT_SRC} alt="" draggable={false} />
          <img className="tile__img tile__img--face" src={tileImageSrc(code, red)} alt="" draggable={false} />
        </>
      )}
    </button>
  );
});
