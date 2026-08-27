import { useGameStore } from "./store/gameStore.js";
import { MatchSetup } from "./components/MatchSetup.js";
import { Table } from "./components/Table.js";
import { Stage } from "./components/Stage.js";

export default function App() {
  const match = useGameStore((s) => s.match);
  if (!match) return <MatchSetup />;
  return (
    <Stage>
      <Table />
    </Stage>
  );
}
