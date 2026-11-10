import { playUiClickFor } from "../sound.js";

/**
 * タイトルの「プレイ」を押した後の、最初の選択画面。オンライン（段位戦・友人戦・ガチャ・手持ち）と
 * CPU戦（アカウント不要で、CPU3人と対局）のどちらで遊ぶかを選ぶ。見た目はオンラインのホーム画面
 * （OnlineLobby.tsx）・CPU戦の設定画面（MatchSetup.tsx）と共通の .online-home / .oh-top を使う。
 */
export function ModeSelect({ onBack, onOnline, onCpu }: { onBack: () => void; onOnline: () => void; onCpu: () => void }) {
  return (
    <div className="online-home mode-select" onClickCapture={playUiClickFor}>
      <header className="oh-top">
        <button type="button" className="oh-back" onClick={onBack}>
          ← タイトルへ
        </button>
        <div className="oh-top__title">PLAY</div>
        <div className="oh-top__spacer" />
      </header>
      <main className="mode-select__main">
        <h2 className="mode-select__heading">どちらで遊びますか？</h2>
        <div className="mode-select__cards">
          <button type="button" className="mode-select__card mode-select__card--online" onClick={onOnline}>
            <span className="mode-select__en">ONLINE</span>
            <span className="mode-select__title">オンライン</span>
            <span className="mode-select__lead">段位戦・友人戦・ガチャ・手持ちのキャラやカード。ほかの人と打つならこちら。</span>
            <span className="mode-select__note">はじめてでも、名前を決めるだけで始められます</span>
            <span className="mode-select__arrow">›</span>
          </button>
          <button type="button" className="mode-select__card mode-select__card--cpu" onClick={onCpu}>
            <span className="mode-select__en">VS CPU</span>
            <span className="mode-select__title">CPU戦</span>
            <span className="mode-select__lead">CPU3人と対局します。アカウントなしで、全キャラ・全カードを自由に使えます。</span>
            <span className="mode-select__note">チュートリアルも、ここから体験できます</span>
            <span className="mode-select__arrow">›</span>
          </button>
        </div>
      </main>
    </div>
  );
}
