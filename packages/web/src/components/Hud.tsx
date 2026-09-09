import type { MatchFormat, RoundState } from "@majyan/core";
import { doraIndicators } from "@majyan/core";
import { TileView } from "./TileView.js";

const FORMAT_LABEL: Record<MatchFormat, string> = { tonpuusen: "東風戦", hanchan: "半荘戦" };

/** 点棒の画像素材は未用意のため、雀魂等でよく見る「縦長カプセル型の点棒
    アイコン」をSVGで再現する（ユーザー提供の参考画像を実測して作図）。
    供託(リーチ棒)＝白いカプセルの中央に赤い点が1つ、本場＝白いカプセルの
    中に黒い点が2列に並ぶ、という組み合わせが正しい（指摘により訂正。
    見た目の名前(Single/Grid)と実際に紐付くラベルは下のJSX側で決める）。 */
function StickIconSingleDot() {
  return (
    <svg width="14" height="26" viewBox="0 0 14 26" aria-hidden="true">
      <rect x="1" y="1" width="12" height="24" rx="6" fill="#f2ead8" stroke="#8a7f68" strokeWidth="0.75" />
      <circle cx="7" cy="13" r="2.6" fill="#c8382c" />
    </svg>
  );
}
function StickIconDotGrid() {
  return (
    <svg width="14" height="26" viewBox="0 0 14 26" aria-hidden="true">
      <rect x="1" y="1" width="12" height="24" rx="6" fill="#e4e1d8" stroke="#8a7f68" strokeWidth="0.75" />
      {[7, 11, 15, 19].map((cy) => (
        <g key={cy}>
          <circle cx="4.8" cy={cy} r="1.1" fill="#2a2620" />
          <circle cx="9.2" cy={cy} r="1.1" fill="#2a2620" />
        </g>
      ))}
    </svg>
  );
}

export function Hud({ round, format }: { round: RoundState; format: MatchFormat }) {
  const dora = doraIndicators(round.wall);

  return (
    <div className="hud">
      <div className="hud__row">
        <div className="hud__label">{FORMAT_LABEL[format]}</div>
      </div>
      <div className="hud__row">
        <span className="hud__dora-label">ドラ表示</span>
        <div className="hud__dora">
          {dora.map((d, i) => (
            <TileView key={i} code={d} tiny />
          ))}
        </div>
      </div>
      {/* 本場・供託を雀魂等を参考に、棒のアイコン+×N本の形でHUD左上に
          常時表示する（0本の時も含めて隠さない）。以前はhonbaのみ0本場の
          時は非表示のテキストで、供託はcenter-boardにしか出ていなかった。
          アイコンだけだと100点棒/1000点棒の区別が付きにくいとの指摘のため、
          本場/供託の文字ラベルも併記する。指摘により供託を左・本場を右の
          順に並べ、アイコンの組み合わせも訂正した。 */}
      <div className="hud__row hud__sticks">
        <StickIconSingleDot />
        <span className="hud__sticks-label">供託</span>
        <span className="hud__sticks-count">× {round.kyotaku}</span>
        <StickIconDotGrid />
        <span className="hud__sticks-label">本場</span>
        <span className="hud__sticks-count">× {round.honba}</span>
      </div>
    </div>
  );
}
