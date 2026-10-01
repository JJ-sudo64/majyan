import { describe, expect, it } from "vitest";
import { createMatch } from "../src/matchFormat.js";
import { advanceToNextRound, applyMatchAction, pendingDecision, settleRound } from "../src/matchController.js";
import { decideCpuCallResponse, decideCpuTurnAction } from "../src/ai/cpuPlayer.js";
import { randomCharacterIds } from "../src/characters.js";
import { buildWall, doraIndicators } from "../src/wall.js";
import { compareTileCode } from "../src/tiles.js";
import { seatWindOf, type MatchState, type RoundState } from "../src/gameState.js";
import type { GameAction, PlayerIndex } from "../src/actions.js";
import {
  actionFromViewer,
  fromViewerSeat,
  redactMatchForSeat,
  redactRoundForSeat,
  rotateMatchForViewer,
  toViewerSeat,
} from "../src/seatView.js";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const SEATS: PlayerIndex[] = [0, 1, 2, 3];

/** 全席CPUで対局を進め、途中の局面（MatchState）をすべて集める。 */
function collectStates(seed: number, maxStates: number): MatchState[] {
  const rng = makeRng(seed);
  let match = createMatch("tonpuusen", rng, randomCharacterIds(rng));
  const states: MatchState[] = [match];
  while (!match.finished && states.length < maxStates) {
    const decision = pendingDecision(match.round);
    let action: GameAction;
    switch (decision.kind) {
      case "round-over":
        match = settleRound(match).match;
        states.push(match);
        match = advanceToNextRound(match, rng, SEATS);
        states.push(match);
        continue;
      case "draw":
        action = { type: "draw", player: decision.seat };
        break;
      case "turn":
        action = decideCpuTurnAction(match.round, decision.seat);
        break;
      case "call":
        action = decideCpuCallResponse(match.round, decision.seat);
        break;
      case "none":
        throw new Error("unexpected");
    }
    match = applyMatchAction(match, action).match;
    states.push(match);
  }
  return states;
}

/** その座席から中身が見えてはいけない牌のID（本物の状態から計算）。 */
function secretTileIds(round: RoundState, seat: PlayerIndex): Set<string> {
  const ids = new Set<string>();
  const shownAtEnd =
    round.phase === "round-over" && round.result ? [...round.result.winners, ...(round.result.tenpaiPlayers ?? [])] : [];
  round.players.forEach((p, i) => {
    if (i === seat || round.handsRevealedTo === seat || p.openRiichi || shownAtEnd.includes(i as PlayerIndex)) return;
    for (const t of p.hand.concealed) ids.add(t.id);
  });
  for (const t of round.wall.liveTiles) ids.add(t.id);
  round.wall.deadWall.forEach((t, i) => {
    // 引かれた嶺上牌は王牌の配列に残ったまま誰かの手牌・河にもあるため、
    // 見えてよいかはそちらの置き場所で決まる。
    if (i < round.wall.rinshanDrawn) return;
    if (i < 4) {
      ids.add(t.id);
      return;
    }
    const offset = i - 4;
    const revealed = offset % 2 === 0 && offset / 2 < round.wall.revealedDoraCount;
    if (!revealed && round.phase !== "round-over") ids.add(t.id);
  });
  return ids;
}

/** オブジェクトを再帰的にたどり、id/codeを持つ牌らしき値をすべて列挙する。 */
function* walkTiles(value: unknown): Generator<{ id: string; code: string; hidden?: boolean }> {
  if (Array.isArray(value)) {
    for (const v of value) yield* walkTiles(v);
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.code === "string") yield o as { id: string; code: string; hidden?: boolean };
    for (const v of Object.values(o)) yield* walkTiles(v);
  }
}

const STATES = [...collectStates(2024, 900), ...collectStates(77, 900)];

describe("redactRoundForSeat", () => {
  it("never exposes the contents of a tile the seat must not see (whole-object scan)", () => {
    let hiddenChecked = 0;
    for (const match of STATES) {
      for (const seat of SEATS) {
        const secrets = secretTileIds(match.round, seat);
        const view = redactMatchForSeat(match, seat);
        for (const t of walkTiles(view)) {
          if (secrets.has(t.id)) {
            expect(t.hidden, `tile ${t.id} leaked to seat ${seat}`).toBe(true);
            hiddenChecked++;
          }
        }
      }
    }
    expect(hiddenChecked).toBeGreaterThan(10000);
    // 嶺上牌が引かれたまま局が終わった局面（王牌の公開で漏れやすい）も検査対象に含まれていること。
    expect(STATES.some((m) => m.round.phase === "round-over" && m.round.wall.rinshanDrawn > 0)).toBe(true);
  }, 120000);

  it("keeps the seat's own information and all counts intact", () => {
    for (const match of STATES) {
      const round = match.round;
      for (const seat of SEATS) {
        const view = redactRoundForSeat(round, seat);
        expect(view.players[seat]).toBe(round.players[seat]);
        expect(view.wall.liveTiles.length).toBe(round.wall.liveTiles.length);
        expect(doraIndicators(view.wall)).toEqual(doraIndicators(round.wall));
        view.players.forEach((p, i) => {
          expect(p.hand.concealed.map((t) => t.id)).toEqual(round.players[i]!.hand.concealed.map((t) => t.id));
          expect(p.hand.melds).toBe(round.players[i]!.hand.melds);
          expect(p.discards).toBe(round.players[i]!.discards);
        });
        if (round.pendingCallWindow) {
          expect(view.pendingCallWindow!.declaredCalls.every((c) => c.player === seat)).toBe(true);
        }
      }
    }
  });

  it("shows winners' hands at the end of a round", () => {
    const ends = STATES.filter((m) => m.round.phase === "round-over" && m.round.result!.winners.length > 0);
    expect(ends.length).toBeGreaterThan(0);
    for (const match of ends) {
      for (const seat of SEATS) {
        const view = redactRoundForSeat(match.round, seat);
        for (const w of match.round.result!.winners) {
          expect(view.players[w].hand.concealed.some((t) => t.hidden)).toBe(false);
        }
      }
    }
  });

  it("lets a wall-reading seat see the live wall contents, but not their order", () => {
    const round = STATES.find((m) => m.round.phase === "awaiting-discard")!.round;
    const reading: RoundState = { ...round, wallReadRevealedTo: 1 };
    const view = redactRoundForSeat(reading, 1);
    const codes = (tiles: { code: string }[]) => tiles.map((t) => t.code).sort();
    expect(codes(view.wall.liveTiles)).toEqual(codes(round.wall.liveTiles));
    expect(view.wall.liveTiles.every((t) => !t.hidden)).toBe(true);
    const viewCodes = view.wall.liveTiles.map((t) => t.code);
    expect([...viewCodes].sort(compareTileCode)).toEqual(viewCodes);
    // 他の座席には見えない
    expect(redactRoundForSeat(reading, 2).wall.liveTiles.every((t) => t.hidden)).toBe(true);
  });
});

describe("buildWall tile ids", () => {
  it("do not follow tile-kind order (ids must not reveal a face-down tile)", () => {
    const wall = buildWall(makeRng(5));
    const all = [...wall.deadWall, ...wall.liveTiles];
    const byId = [...all].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const codesInIdOrder = byId.map((t) => t.code);
    expect([...codesInIdOrder].sort(compareTileCode)).not.toEqual(codesInIdOrder);
  });
});

describe("rotation for the viewer", () => {
  it("round-trips and puts the viewer at seat 0", () => {
    for (const match of STATES.filter((_, i) => i % 7 === 0)) {
      for (const viewer of SEATS) {
        const rotated = rotateMatchForViewer(match, viewer);
        expect(rotated.round.players[0]).toBe(match.round.players[viewer]);
        expect(rotated.scores[0]).toBe(match.scores[viewer]);
        expect(rotated.round.characterIds[0]).toBe(match.round.characterIds[viewer]);
        // 自分の風は回しても変わらない
        expect(seatWindOf(rotated.round.dealerSeat, 0)).toBe(seatWindOf(match.round.dealerSeat, viewer));
        // 次に動く座席も同じ人を指す
        const before = pendingDecision(match.round);
        const after = pendingDecision(rotated.round);
        expect(after.kind).toBe(before.kind);
        if ("seat" in before && "seat" in after) expect(fromViewerSeat(after.seat, viewer)).toBe(before.seat);
        // 逆回しで元に戻る
        const back = rotateMatchForViewer(rotated, ((4 - viewer) % 4) as PlayerIndex);
        expect(back).toEqual(match);
      }
    }
  });

  it("converts actions back to absolute seats", () => {
    for (const viewer of SEATS) {
      for (const rel of SEATS) {
        expect(toViewerSeat(fromViewerSeat(rel, viewer), viewer)).toBe(rel);
      }
      const action = actionFromViewer({ type: "borrowSkill", player: 0, target: 3 }, viewer);
      expect(action).toEqual({ type: "borrowSkill", player: viewer, target: (viewer + 3) % 4 });
    }
  });
});
