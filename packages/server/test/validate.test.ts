import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/validate.js";

const action = (a: unknown) => JSON.stringify({ t: "action", action: a });

describe("parseClientMessage", () => {
  it("accepts well-formed messages", () => {
    expect(parseClientMessage(JSON.stringify({ t: "join", room: "r", authToken: "t", characterId: null, cardId: null }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "join", room: "r", authToken: "t", characterId: "x", cardId: null }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "start", format: "hanchan", continueBelowZero: false }))).not.toBeNull();
    expect(parseClientMessage(action({ type: "discard", player: 0, tileId: "t1", tsumogiri: false }))).not.toBeNull();
    expect(parseClientMessage(action({ type: "chi", player: 0, tileCodes: ["1m", "2m", "3m"], usedHandTileIds: ["a", "b"] }))).not.toBeNull();
    expect(parseClientMessage(action({ type: "ankan", player: 0, tileCode: "7z" }))).not.toBeNull();
    expect(parseClientMessage(action({ type: "borrowSkill", player: 0, target: 2 }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "nextRound" }))).not.toBeNull();
  });

  it("rejects broken or unexpected shapes", () => {
    for (const raw of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ t: "unknown" }),
      JSON.stringify({ t: "join", room: 1, authToken: "t", characterId: null, cardId: null }),
      JSON.stringify({ t: "join", room: "r", authToken: 5, characterId: null, cardId: null }),
      JSON.stringify({ t: "join", room: "r", characterId: null, cardId: null }),
      JSON.stringify({ t: "start", format: "sanma", continueBelowZero: false }),
      action(null),
      action({ type: "draw", player: 0 }),
      action({ type: "discard", player: 4, tileId: "t", tsumogiri: false }),
      action({ type: "discard", player: 0, tileId: { evil: true }, tsumogiri: false }),
      action({ type: "chi", player: 0, tileCodes: ["1m", "2m"], usedHandTileIds: ["a", "b"] }),
      action({ type: "pon", player: 0, usedHandTileIds: ["a"] }),
      action({ type: "ankan", player: 0, tileCode: "0m" }),
      action({ type: "swapTiles", player: 0, tileIds: "abc" }),
      action({ type: "borrowSkill", player: 0, target: "1" }),
    ]) {
      expect(parseClientMessage(raw), raw).toBeNull();
    }
  });
});
