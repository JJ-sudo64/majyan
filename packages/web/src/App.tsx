import { useState } from "react";
import { useGameStore } from "./store/gameStore.js";
import { TitleScreen } from "./components/TitleScreen.js";
import { MatchSetup } from "./components/MatchSetup.js";
import { Table } from "./components/Table.js";
import { Stage } from "./components/Stage.js";
import { useTitleBgm } from "./hooks/useTitleBgm.js";

export default function App() {
  const match = useGameStore((s) => s.match);
  const [showSetup, setShowSetup] = useState(false);
  // タイトル画面～キャラクター選択画面（対局開始前）の間だけ流すBGM。
  // 対局が始まる（match有り→Table.tsx側のuseBgmに切り替わる）と自然に止まる。
  useTitleBgm(!match);

  if (match) {
    return (
      <Stage>
        <Table />
      </Stage>
    );
  }
  if (!showSetup) return <TitleScreen onPlay={() => setShowSetup(true)} />;
  return <MatchSetup onBack={() => setShowSetup(false)} />;
}
