import { describe, expect, it } from "vitest";
import type { GameAction } from "../src/actions.js";
import type { MatchState } from "../src/gameState.js";
import { applyMatchAction, pendingDecision, settleRound } from "../src/matchController.js";
import { canDeclareTsumo } from "../src/gameEngine.js";
import { TUTORIAL_SCENARIOS, tutorialAllows, tutorialCpuAction, type TutorialAllow, type TutorialStep } from "../src/tutorial.js";

/** 台本のとおりに人間が操作する時の、その操作（allowから作る）。 */
function humanActionFor(allow: TutorialAllow, match: MatchState): GameAction {
  const round = match.round;
  const hand = round.players[0]!.hand.concealed;
  switch (allow.kind) {
    case "discard": {
      const tile = hand.find((t) => t.code === allow.code)!;
      return { type: "discard", player: 0, tileId: tile.id, tsumogiri: tile.id === round.lastDrawnTile?.id };
    }
    case "riichi":
      return { type: "riichi", player: 0, tileId: hand.find((t) => t.code === allow.code)!.id };
    case "tsumo":
      return { type: "tsumo", player: 0 };
    case "ron":
      return { type: "ron", player: 0 };
    case "skill":
      return { type: "useSkill", player: 0 };
    case "pon": {
      const code = round.pendingCallWindow!.discardTile.code;
      return { type: "pon", player: 0, usedHandTileIds: hand.filter((t) => t.code === code).slice(0, 2).map((t) => t.id) };
    }
  }
}

describe("tutorial scenarios", () => {
  for (const scenario of TUTORIAL_SCENARIOS) {
    it(`${scenario.id}: the scripted game runs step by step and ends in the human's win`, () => {
      let match = scenario.build();
      // 配牌: 全員13枚、牌は136枚ぜんぶそろっていて、同じ牌が5枚以上は無い。
      const dealt = match.round.players.flatMap((p) => p.hand.concealed);
      expect(match.round.players.every((p) => p.hand.concealed.length === 13)).toBe(true);
      const total = dealt.length + match.round.wall.liveTiles.length + match.round.wall.deadWall.length;
      expect(total).toBe(136);
      expect(new Set([...dealt, ...match.round.wall.liveTiles, ...match.round.wall.deadWall].map((t) => t.id)).size).toBe(136);

      const shown: string[] = [];
      let stepIndex = 0;
      for (let guard = 0; guard < 400; guard++) {
        const round = match.round;
        const step: TutorialStep | undefined = scenario.steps[stepIndex];
        // 台本の案内が出る局面になったら、その案内を出す。
        if (step && step.when(round)) {
          if (step.advance === "next") {
            shown.push(step.id);
            stepIndex++;
            continue;
          }
          if (step.advance === "result") {
            shown.push(step.id);
            stepIndex++;
            continue;
          }
          // action: 台本が許す操作だけが通る。それ以外は通らない。
          const action = humanActionFor(step.allow!, match);
          expect(tutorialAllows(step.allow, action, round)).toBe(true);
          const wrong: GameAction = { type: "skip", player: 0 };
          expect(tutorialAllows(step.allow, wrong, round)).toBe(false);
          shown.push(step.id);
          match = applyMatchAction(match, action).match;
          stepIndex++;
          continue;
        }
        const d = pendingDecision(round);
        if (d.kind === "round-over") break;
        if (d.kind === "draw") match = applyMatchAction(match, { type: "draw", player: d.seat }).match;
        else if (d.kind === "turn" || d.kind === "call") {
          if (d.seat === 0) {
            // 台本の案内が無い鳴きの確認は、選べる鳴きが無いので自動で見送られる（ストアのtickと同じ）。
            if (d.kind === "call") {
              match = applyMatchAction(match, { type: "skip", player: 0 }).match;
              continue;
            }
            throw new Error(`人間の番なのに台本の案内がありません（step ${stepIndex}: ${step?.id}）`);
          }
          match = applyMatchAction(match, tutorialCpuAction(round, d.seat)).match;
        } else throw new Error(`想定外の局面: ${d.kind}`);
      }
      // 局が終わり、最後の「結果」の案内まで出ている。
      expect(match.round.phase).toBe("round-over");
      const last = scenario.steps[scenario.steps.length - 1]!;
      expect(last.when(match.round)).toBe(true);
      // 最後の「結果」の案内まで、台本の案内がすべて順に出ている。
      expect(stepIndex).toBe(scenario.steps.length);
      // 人間の和了で終わる。
      const result = match.round.result!;
      expect(result.winners).toEqual([0]);
      const settled = settleRound(match);
      expect(settled.outcome.scoreDeltas[0]).toBeGreaterThan(0);
      expect(settled.outcome.winAnalyses[0]!.analysis.yaku.length).toBeGreaterThan(0);
      expect(shown).toEqual(scenario.steps.map((x) => x.id));
    });
  }

  it("riichi scenario: the human's win is a riichi tsumo, the pon scenario's is a ron with the yakuhai", () => {
    const [riichi, pon] = TUTORIAL_SCENARIOS;
    // 3局目: 「開花」で2枚目の表示牌がめくれ、ドラが5筒になる。
    const skill = TUTORIAL_SCENARIOS[2]!.build().round;
    expect(skill.characterIds[0]).toBe("hiiragi");
    expect(skill.players[0]!.skillGauge).toBe(100);
    expect(skill.wall.deadWall.length).toBe(14);
    expect(skill.wall.deadWall[6]!.code).toBe("4p");
    expect(riichi!.build().round.players[0]!.hand.concealed.map((t) => t.code).sort()).toEqual(
      ["2m", "3m", "4m", "4p", "5p", "6p", "6s", "7s", "8s", "3p", "3p", "9m", "4z"].sort(),
    );
    expect(pon!.build().round.dealerSeat).toBe(0);
    expect(canDeclareTsumo(riichi!.build().round, 0)).toBeNull();
  });
});
