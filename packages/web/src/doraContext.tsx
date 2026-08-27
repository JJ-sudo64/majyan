import { createContext, useContext, type ReactNode } from "react";
import type { TileCode } from "@majyan/core";

/**
 * 現在のドラ牌コード一覧（表示牌そのものではなく、実際にドラとして
 * 加算される牌）。あちこちのTileView（手牌・副露・河）から参照したいが、
 * Hand/OpponentArea/DiscardPileの間をprops経由で延々バケツリレーするのは
 * 冗長なため、Table.tsxでroundから一度だけ計算してContextで配る。
 */
const DoraContext = createContext<ReadonlySet<TileCode>>(new Set());

export function DoraProvider({ doraCodes, children }: { doraCodes: ReadonlySet<TileCode>; children: ReactNode }) {
  return <DoraContext.Provider value={doraCodes}>{children}</DoraContext.Provider>;
}

export function useDoraCodes(): ReadonlySet<TileCode> {
  return useContext(DoraContext);
}
