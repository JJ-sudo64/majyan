import { describe, expect, it } from "vitest";
import { shareUnchanged } from "../src/shareUnchanged.js";

describe("shareUnchanged", () => {
  it("returns the previous object when nothing changed", () => {
    const prev = { a: 1, b: [{ id: "x" }, { id: "y" }], c: null };
    const next = JSON.parse(JSON.stringify(prev));
    expect(shareUnchanged(prev, next)).toBe(prev);
  });

  it("keeps unchanged branches and replaces only what changed", () => {
    const prev = { players: [{ discards: [{ id: "a" }] }, { discards: [{ id: "b" }] }], turn: 0 };
    const next = { players: [{ discards: [{ id: "a" }] }, { discards: [{ id: "b" }, { id: "c" }] }], turn: 1 };
    const out = shareUnchanged(prev, next);
    expect(out).toEqual(next);
    expect(out).not.toBe(prev);
    expect(out.players[0]).toBe(prev.players[0]);
    expect(out.players[1]).not.toBe(prev.players[1]);
    expect(out.players[1]!.discards[0]).toBe(prev.players[1]!.discards[0]);
  });

  it("notices removed keys, shorter arrays and type changes", () => {
    const prev = { a: 1, b: 2, list: [1, 2, 3], v: [1] as unknown };
    expect(shareUnchanged(prev, { a: 1 })).toEqual({ a: 1 });
    expect(shareUnchanged(prev, { a: 1, b: 2, list: [1, 2], v: [1] }).list).toEqual([1, 2]);
    expect(shareUnchanged(prev, { a: 1, b: 2, list: [1, 2, 3], v: { 0: 1 } }).v).toEqual({ 0: 1 });
    expect(shareUnchanged(null, { a: 1 })).toEqual({ a: 1 });
  });
});
