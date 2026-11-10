import { useState } from "react";
import { SHOP_RETURN_PARAM } from "@majyan/core";
import { useGameStore } from "./store/gameStore.js";
import { TitleScreen } from "./components/TitleScreen.js";
import { MatchSetup } from "./components/MatchSetup.js";
import { ModeSelect } from "./components/ModeSelect.js";
import { OnlineLobby } from "./components/OnlineLobby.js";
import { OnlineConnectionOverlay } from "./components/OnlineConnectionOverlay.js";
import { OnlineTurnTimer } from "./components/OnlineTurnTimer.js";
import { OnlineStampBubbles, OnlineStamps } from "./components/OnlineStamps.js";
import { ReplayControls } from "./components/ReplayControls.js";
import { SpectatorBanner } from "./components/SpectatorBanner.js";
import { Table } from "./components/Table.js";
import { Stage } from "./components/Stage.js";
import { UpdateNotice } from "./components/UpdateNotice.js";
import { useTitleBgm } from "./hooks/useTitleBgm.js";

/** title→mode（オンラインかCPU戦かを選ぶ）→online（オンライン）／setup（CPU戦の設定）。 */
type Screen = "title" | "mode" | "setup" | "online";

export default function App() {
  return (
    <>
      <AppBody />
      <UpdateNotice />
    </>
  );
}

function AppBody() {
  const match = useGameStore((s) => s.match);
  const online = useGameStore((s) => s.online);
  const replaying = useGameStore((s) => s.replay !== null);
  const spectating = useGameStore((s) => s.spectating);
  // 支払いのページから戻ってきた時（?shop=…）は、雀玉を買う画面のあるオンラインの入口から始める。
  const [screen, setScreen] = useState<Screen>(() => (new URLSearchParams(window.location.search).has(SHOP_RETURN_PARAM) ? "online" : "title"));
  // タイトル画面～キャラクター選択画面（対局開始前）の間だけ流すBGM。
  // 対局が始まる（match有り→Table.tsx側のuseBgmに切り替わる）と自然に止まる。
  useTitleBgm(!match);

  if (match) {
    return (
      <>
        <Stage>
          <Table />
          <OnlineStampBubbles />
          {/* 秒読みとスタンプのボタンも卓のキャンバスの中に置く（ウィンドウの隅に固定すると、
              画面の大きさ・比率によって卓との位置関係が変わり、大きさも縮まない）。 */}
          {online && !spectating && <OnlineTurnTimer />}
          {!replaying && <OnlineStamps canSend={!spectating} />}
        </Stage>
        {online && !spectating && <OnlineConnectionOverlay />}
        {spectating && <SpectatorBanner />}
        {replaying && <ReplayControls />}
      </>
    );
  }
  if (screen === "title") {
    return (
      <>
        <TitleScreen onPlay={() => setScreen("mode")} />
      </>
    );
  }
  // メニューも卓と同じ比率のキャンバスに描く（PCでも横向きスマホでも同じ配置になる）。
  return (
    <>
      <Stage menu>
        {screen === "mode" ? (
          <ModeSelect onBack={() => setScreen("title")} onOnline={() => setScreen("online")} onCpu={() => setScreen("setup")} />
        ) : screen === "online" ? (
          <OnlineLobby onBack={() => setScreen("mode")} />
        ) : (
          <MatchSetup onBack={() => setScreen("mode")} />
        )}
      </Stage>
    </>
  );
}
