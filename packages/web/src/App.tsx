import { useState } from "react";
import { useGameStore } from "./store/gameStore.js";
import { TitleScreen } from "./components/TitleScreen.js";
import { MatchSetup } from "./components/MatchSetup.js";
import { OnlineLobby } from "./components/OnlineLobby.js";
import { OnlineConnectionOverlay } from "./components/OnlineConnectionOverlay.js";
import { OnlineTurnTimer } from "./components/OnlineTurnTimer.js";
import { ReplayControls } from "./components/ReplayControls.js";
import { SpectatorBanner } from "./components/SpectatorBanner.js";
import { Table } from "./components/Table.js";
import { Stage } from "./components/Stage.js";
import { useTitleBgm } from "./hooks/useTitleBgm.js";

type Screen = "title" | "setup" | "online";

export default function App() {
  const match = useGameStore((s) => s.match);
  const online = useGameStore((s) => s.online);
  const replaying = useGameStore((s) => s.replay !== null);
  const spectating = useGameStore((s) => s.spectating);
  const [screen, setScreen] = useState<Screen>("title");
  // タイトル画面～キャラクター選択画面（対局開始前）の間だけ流すBGM。
  // 対局が始まる（match有り→Table.tsx側のuseBgmに切り替わる）と自然に止まる。
  useTitleBgm(!match);

  if (match) {
    return (
      <>
        <Stage>
          <Table />
        </Stage>
        {online && !spectating && <OnlineTurnTimer />}
        {online && !spectating && <OnlineConnectionOverlay />}
        {spectating && <SpectatorBanner />}
        {replaying && <ReplayControls />}
      </>
    );
  }
  if (screen === "title") return <TitleScreen onPlay={() => setScreen("setup")} />;
  if (screen === "online") return <OnlineLobby onBack={() => setScreen("setup")} />;
  return <MatchSetup onBack={() => setScreen("title")} onOnline={() => setScreen("online")} />;
}
