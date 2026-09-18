import { useState } from "react";
import type { PlayerIndex } from "@majyan/core";
import { useTile3DDebugStore, usePlayerTile3DParam } from "../store/tile3dDebugStore.js";
import { Tile3D } from "./Tile3D.js";

// localStorageへの永続化(persist)は、ポート番号が変わる（＝ブラウザ
// から見て別オリジンになる）とlocalStorageごと切り替わってしまい、
// 「調整済みの値が初期値に見える」事故につながることが実際に起きた。
// これはvite.config.tsのserver.strictPortでポート変動自体は防いだが、
// それとは別に「localStorage自体がどんな理由であれ失われても、調整値
// だけは絶対に取り戻せる」ようにするため、ストアの中身をテキストで
// 手元にコピー/復元できる機能を用意する——localStorageの状態に一切
// 依存しない独立したバックアップ手段。下家・上家の両方の値をまとめて
// 1つのテキストにコピー/復元する（座席を分けて個別にバックアップする
// 必要は今のところない）。
function exportSettingsJson(): string {
  const state = useTile3DDebugStore.getState() as unknown as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    // setter関数(setRx等)を除き、値フィールドだけを取り出す。フィールドを
    // 今後追加してもこの判定は自動的に対応できる（ハードコードの
    // フィールド名リストを毎回更新する必要がない）。
    if (typeof state[key] !== "function") {
      data[key] = state[key];
    }
  }
  return JSON.stringify(data);
}

function importSettingsJson(json: string): void {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") throw new Error("not an object");
  const state = useTile3DDebugStore.getState() as unknown as Record<string, unknown>;
  // setter関数を上書きしないよう、貼り付けデータ側に実際にstate上に
  // 存在する値フィールドだけを反映する（不明なキーや壊れた構造で
  // setterを消してしまう事故を防ぐ）。
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) {
    if (key in state && typeof state[key] !== "function") {
      patch[key] = parsed[key];
    }
  }
  useTile3DDebugStore.setState(patch);
}

/**
 * 下家・上家の立体牌(Tile3D)の角度・拡大率・厚み・並べ方を、実際の対局
 * 画面を見ながらその場で調整するためのデバッグパネル。プロトタイプ
 * (Artifact)にあったスライダー・プリセット・手前奥切り替えと同じ役割を、
 * 実機の卓の上でそのまま果たす——文章でのやり取りだけでは向きや並びが
 * 合っているか確認しづらかったための対応。値が決まったら不要になる
 * 想定の一時的な部品。
 *
 * 以前は常時左下に固定表示していたが、(1)左下だと上家側の手牌が隠れる、
 * (2)スライダーの数が多く常時表示は画面の邪魔になる、という指摘のため、
 * SettingsPanel(歯車)の「下家の調整」「上家の調整」から開くモーダルに
 * 変更した。`player`propで下家(1)/上家(3)のどちらの調整パネルかを指定し、
 * usePlayerTile3DParamで対応するストアフィールド一式に自動的に切り替わる。
 */
export function Tile3DDebugPanel({ player, onClose }: { player: PlayerIndex; onClose: () => void }) {
  const isKamicha = player === 3;
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const rx = usePlayerTile3DParam((s) => s.rx, (s) => s.kamichaRx, isKamicha);
  const ry = usePlayerTile3DParam((s) => s.ry, (s) => s.kamichaRy, isKamicha);
  const scale = usePlayerTile3DParam((s) => s.scale, (s) => s.kamichaScale, isKamicha);
  const thickness = usePlayerTile3DParam((s) => s.thickness, (s) => s.kamichaThickness, isKamicha);
  const whiteWidth = usePlayerTile3DParam((s) => s.whiteWidth, (s) => s.kamichaWhiteWidth, isKamicha);
  const aspectX = usePlayerTile3DParam((s) => s.aspectX, (s) => s.kamichaAspectX, isKamicha);
  const aspectY = usePlayerTile3DParam((s) => s.aspectY, (s) => s.kamichaAspectY, isKamicha);
  const spacing = usePlayerTile3DParam((s) => s.spacing, (s) => s.kamichaSpacing, isKamicha);
  const fanOffsetX = usePlayerTile3DParam((s) => s.fanOffsetX, (s) => s.kamichaFanOffsetX, isKamicha);
  const frontIsLast = usePlayerTile3DParam((s) => s.frontIsLast, (s) => s.kamichaFrontIsLast, isKamicha);
  const drawnOffsetX = usePlayerTile3DParam((s) => s.drawnOffsetX, (s) => s.kamichaDrawnOffsetX, isKamicha);
  const drawnOffsetY = usePlayerTile3DParam((s) => s.drawnOffsetY, (s) => s.kamichaDrawnOffsetY, isKamicha);
  // 上家専用（下家は常にfalse扱い、OpponentArea.tsx側もisKamicha=falseなら
  // 参照しない）。副露で手牌が短くなる時、縮む側の端を反転する。
  const kamichaShrinkReversed = useTile3DDebugStore((s) => s.kamichaShrinkReversed);
  const setKamichaShrinkReversed = useTile3DDebugStore((s) => s.setKamichaShrinkReversed);

  // setterは値と違い呼び出すたびに変わらない安定した関数なので、
  // 下家用・上家用の両方を取得してisKamichaで選ぶだけでよい
  // （usePlayerTile3DParamのように再選択のためのフック分離は不要）。
  const setRxShimocha = useTile3DDebugStore((s) => s.setRx);
  const setRxKamicha = useTile3DDebugStore((s) => s.setKamichaRx);
  const setRx = isKamicha ? setRxKamicha : setRxShimocha;
  const setRyShimocha = useTile3DDebugStore((s) => s.setRy);
  const setRyKamicha = useTile3DDebugStore((s) => s.setKamichaRy);
  const setRy = isKamicha ? setRyKamicha : setRyShimocha;
  const setScaleShimocha = useTile3DDebugStore((s) => s.setScale);
  const setScaleKamicha = useTile3DDebugStore((s) => s.setKamichaScale);
  const setScale = isKamicha ? setScaleKamicha : setScaleShimocha;
  const setThicknessShimocha = useTile3DDebugStore((s) => s.setThickness);
  const setThicknessKamicha = useTile3DDebugStore((s) => s.setKamichaThickness);
  const setThickness = isKamicha ? setThicknessKamicha : setThicknessShimocha;
  const setWhiteWidthShimocha = useTile3DDebugStore((s) => s.setWhiteWidth);
  const setWhiteWidthKamicha = useTile3DDebugStore((s) => s.setKamichaWhiteWidth);
  const setWhiteWidth = isKamicha ? setWhiteWidthKamicha : setWhiteWidthShimocha;
  const setAspectXShimocha = useTile3DDebugStore((s) => s.setAspectX);
  const setAspectXKamicha = useTile3DDebugStore((s) => s.setKamichaAspectX);
  const setAspectX = isKamicha ? setAspectXKamicha : setAspectXShimocha;
  const setAspectYShimocha = useTile3DDebugStore((s) => s.setAspectY);
  const setAspectYKamicha = useTile3DDebugStore((s) => s.setKamichaAspectY);
  const setAspectY = isKamicha ? setAspectYKamicha : setAspectYShimocha;
  const setSpacingShimocha = useTile3DDebugStore((s) => s.setSpacing);
  const setSpacingKamicha = useTile3DDebugStore((s) => s.setKamichaSpacing);
  const setSpacing = isKamicha ? setSpacingKamicha : setSpacingShimocha;
  const setFanOffsetXShimocha = useTile3DDebugStore((s) => s.setFanOffsetX);
  const setFanOffsetXKamicha = useTile3DDebugStore((s) => s.setKamichaFanOffsetX);
  const setFanOffsetX = isKamicha ? setFanOffsetXKamicha : setFanOffsetXShimocha;
  const setFrontIsLastShimocha = useTile3DDebugStore((s) => s.setFrontIsLast);
  const setFrontIsLastKamicha = useTile3DDebugStore((s) => s.setKamichaFrontIsLast);
  const setFrontIsLast = isKamicha ? setFrontIsLastKamicha : setFrontIsLastShimocha;
  const setDrawnOffsetXShimocha = useTile3DDebugStore((s) => s.setDrawnOffsetX);
  const setDrawnOffsetXKamicha = useTile3DDebugStore((s) => s.setKamichaDrawnOffsetX);
  const setDrawnOffsetX = isKamicha ? setDrawnOffsetXKamicha : setDrawnOffsetXShimocha;
  const setDrawnOffsetYShimocha = useTile3DDebugStore((s) => s.setDrawnOffsetY);
  const setDrawnOffsetYKamicha = useTile3DDebugStore((s) => s.setKamichaDrawnOffsetY);
  const setDrawnOffsetY = isKamicha ? setDrawnOffsetYKamicha : setDrawnOffsetYShimocha;

  // プレビュー欄(.tile3d-debug-panel__preview)は固定サイズの箱だが、
  // 中の牌は「拡大率」「牌の横幅/縦幅」スライダーをそのまま反映する
  // (scale*3, aspectX, aspectY)ため、これらを大きくすると牌が箱を
  // 超えて下のスライダー列に重なり、操作できなくなる不具合が実機で
  // 発覚した。牌本体のscale/aspectX/aspectYはそのまま(角度・厚み等の
  // 見え方をそのまま確認したいため)、prewiewラッパー全体に追加の
  // 縮小scaleを掛けて、常に箱に収まるようにする（拡大方向には効かせず
  // min(...,1)で頭打ちにし、通常時の見た目は変えない）。
  const PREVIEW_BOX = 100; // px、箱の実際の余裕(高さ110px・paddingから逆算)
  const previewTileW = 32 * scale * aspectX;
  const previewTileH = 43 * scale * aspectY;
  const previewFitScale = Math.min(1, PREVIEW_BOX / previewTileW, PREVIEW_BOX / previewTileH);

  // プロトタイプの「並べ方プリセット」と同じ考え方。牌の実寸(43px×拡大率)
  // に対する割合でspacingを決めるので、拡大率を変えても比率は保たれる。
  const tileH = 43 * scale;
  const presets: { label: string; spacing: number; fanOffsetX: number }[] = [
    { label: "半分重ねる", spacing: -tileH * 0.5, fanOffsetX: 0 },
    { label: "隙間なく並べる", spacing: 2, fanOffsetX: 0 },
    { label: "ほぼ重ねる", spacing: -tileH * 0.85, fanOffsetX: 0 },
    { label: "重ねて少し斜めに", spacing: -tileH * 0.7, fanOffsetX: 4 },
  ];

  // localStorageの状態に一切依存しない独立したバックアップ手段。
  // 「コピー」でクリップボードに調整値一式（下家・上家両方まとめて）を
  // テキストとして保存でき、「貼り付け」でそのテキストから復元できる
  // ——ポート変更やlocalStorageクリア等、何が起きても手元にコピーさえ
  // あれば必ず戻せる。
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportSettingsJson());
      setBackupStatus("コピーしました（メモ帳等に保存してください）");
    } catch {
      setBackupStatus("コピーに失敗しました（ブラウザの権限を確認してください）");
    }
    setTimeout(() => setBackupStatus(null), 4000);
  };
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      importSettingsJson(text);
      setBackupStatus("復元しました");
    } catch {
      setBackupStatus("復元に失敗しました（コピーした文字列がクリップボードにあるか確認してください）");
    }
    setTimeout(() => setBackupStatus(null), 4000);
  };

  return (
    <div className="tile3d-debug-overlay" onClick={onClose}>
      <div className="tile3d-debug-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tile3d-debug-panel__header">
          <div className="tile3d-debug-panel__title">{isKamicha ? "上家の立体牌 調整" : "下家の立体牌 調整"}</div>
          <button type="button" className="tile3d-debug-panel__close" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        {/* 実際の手牌(13枚以上が重なった状態)だと、1枚の縦横比を変えた時に
            周りの牌との重なりや卓の傾きで見え方が紛らわしいため、まず牌
            1枚だけを大きく単独表示してここで比率を確認できるようにする。
            値は下のスライダー群と完全に同じストアを見ているので、ここでの
            見え方＝実際の手牌の牌1枚あたりの見え方と一致する。 */}
        <div className="tile3d-debug-panel__preview">
          <div className="tile3d-debug-panel__preview-fit" style={{ transform: `scale(${previewFitScale})` }}>
            <Tile3D code="1m" faceDown rx={rx} ry={ry} scale={scale * 3} thickness={thickness} whiteWidth={whiteWidth} aspectX={aspectX} aspectY={aspectY} />
          </div>
        </div>

        {/* 副露の位置・角度は、別画面の縮小プレビューではなく実際の卓の
            上で直接ドラッグして決める方式に変更した(MeldEditToolbar.tsx
            ＋OpponentArea.tsxのドラッグ機能、SettingsPanelの「副露編集
            モード」から起動)。ここでは触れない。 */}

        {/* 上家だけ、副露で手牌が短くなる時にどちら側の端から縮んでいく
            かを反転できる（project-tile3d-prototypeメモの「上家が副露して
            手牌が短くなる方向を逆にしろ」の要望に対応。過去に一度、
            アンカーサイズやsync方式ごと変える実装でツモ牌位置まで巻き込み
            壊した反省から、影響範囲を描画順序の反転だけに絞っている）。 */}
        {isKamicha && (
          <div className="tile3d-debug-panel__group" role="group" aria-label="手牌が縮む方向">
            <button
              type="button"
              className={`tile3d-debug-panel__btn${!kamichaShrinkReversed ? " tile3d-debug-panel__btn--active" : ""}`}
              onClick={() => setKamichaShrinkReversed(false)}
            >
              上を固定(下から縮む)
            </button>
            <button
              type="button"
              className={`tile3d-debug-panel__btn${kamichaShrinkReversed ? " tile3d-debug-panel__btn--active" : ""}`}
              onClick={() => setKamichaShrinkReversed(true)}
            >
              下を固定(上から縮む)
            </button>
          </div>
        )}

        <label className="tile3d-debug-panel__row">
          <span>縦の角度</span>
          <input type="range" min={-180} max={180} value={rx} onChange={(e) => setRx(Number(e.target.value))} />
          <output>{rx}°</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>横の角度</span>
          <input type="range" min={-180} max={180} value={ry} onChange={(e) => setRy(Number(e.target.value))} />
          <output>{ry}°</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>拡大率</span>
          <input type="range" min={0.5} max={5} step={0.1} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
          <output>{scale.toFixed(1)}x</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>厚み</span>
          <input type="range" min={0} max={16} step={1} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} />
          <output>{thickness}px</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>白の幅(残りが緑)</span>
          <input
            type="range"
            min={0}
            max={32}
            step={0.1}
            value={whiteWidth}
            onChange={(e) => setWhiteWidth(Number(e.target.value))}
          />
          <output>{whiteWidth}px</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>牌の横幅</span>
          <input
            type="range"
            min={0.3}
            max={3}
            step={0.05}
            value={aspectX}
            onChange={(e) => setAspectX(Number(e.target.value))}
          />
          <output>{aspectX.toFixed(2)}x</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>牌の縦幅</span>
          <input
            type="range"
            min={0.3}
            max={3}
            step={0.05}
            value={aspectY}
            onChange={(e) => setAspectY(Number(e.target.value))}
          />
          <output>{aspectY.toFixed(2)}x</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>縦位置</span>
          <input type="range" min={-80} max={20} step={1} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} />
          <output>{Math.round(spacing)}px</output>
        </label>
        <label className="tile3d-debug-panel__row">
          <span>横位置</span>
          <input type="range" min={-20} max={20} step={1} value={fanOffsetX} onChange={(e) => setFanOffsetX(Number(e.target.value))} />
          <output>{fanOffsetX}px</output>
        </label>

        <div className="tile3d-debug-panel__group" role="group" aria-label="重なり順">
          <button
            type="button"
            className={`tile3d-debug-panel__btn${!frontIsLast ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => setFrontIsLast(false)}
          >
            先頭が手前
          </button>
          <button
            type="button"
            className={`tile3d-debug-panel__btn${frontIsLast ? " tile3d-debug-panel__btn--active" : ""}`}
            onClick={() => setFrontIsLast(true)}
          >
            末尾が手前
          </button>
        </div>

        <div className="tile3d-debug-panel__group tile3d-debug-panel__group--wrap" role="group" aria-label="並べ方プリセット">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="tile3d-debug-panel__btn"
              onClick={() => {
                setSpacing(Math.round(p.spacing));
                setFanOffsetX(p.fanOffsetX);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 手牌の列全体をどこに置くかは、以前は鳴いた副露の数に関わらず
            一律の「全体・横/縦/傾き」スライダーだったが、手牌が短くなる
            たびに位置が変わって見えるとの指摘のため廃止した。手牌配置
            編集モード（SettingsPanelの「手牌配置編集モード」→卓上で
            直接ドラッグ）で、鳴いた副露の数(0〜4)ごとに個別に固定する。 */}

        {/* ツモ牌だけは本体の並び方の計算式に一切頼らず、ここで直接位置を
            指定する。どこにツモ牌が来ているか計算だけでは分かりづらいとの
            指摘のため、見ながら自由に動かせるようにした。 */}
        <label className="tile3d-debug-panel__row tile3d-debug-panel__row--drawn-offset">
          <span>ツモ牌・横</span>
          <input
            type="range"
            min={-150}
            max={150}
            step={1}
            value={drawnOffsetX}
            onChange={(e) => setDrawnOffsetX(Number(e.target.value))}
          />
          <output>{drawnOffsetX}px</output>
        </label>
        <label className="tile3d-debug-panel__row tile3d-debug-panel__row--drawn-offset">
          <span>ツモ牌・縦</span>
          <input
            type="range"
            min={-150}
            max={150}
            step={1}
            value={drawnOffsetY}
            onChange={(e) => setDrawnOffsetY(Number(e.target.value))}
          />
          <output>{drawnOffsetY}px</output>
        </label>

        {/* 副露(.opponent-melds、ポン/チー/カン)の位置は、以前は「塊全体」
            を動かすグループ単位のスライダーだったが、「1個動かすと全部
            動くように見えて分かりにくい、各副露を完全に独立させて置き
            たい」との指摘のため廃止した。副露編集モード
            （SettingsPanelの「副露編集モード」→卓上で直接ドラッグ）で
            1〜4番目それぞれを個別に配置する。 */}

        {/* localStorageが何らかの理由（ポート変更、ブラウザのキャッシュ
            クリア等）で失われても調整値だけは絶対に取り戻せるよう、独立
            したテキストバックアップを手元に持てるようにする。「コピー」
            で調整値一式をクリップボードへ、メモ帳等に貼り付けて保管して
            おけば、「貼り付け」でいつでも復元できる。 */}
        <div className="tile3d-debug-panel__group" role="group" aria-label="バックアップ">
          <button type="button" className="tile3d-debug-panel__btn" onClick={handleCopy}>
            設定をコピー
          </button>
          <button type="button" className="tile3d-debug-panel__btn" onClick={handlePaste}>
            設定を貼り付け
          </button>
        </div>
        {backupStatus && <div className="tile3d-debug-panel__backup-status">{backupStatus}</div>}
      </div>
    </div>
  );
}
