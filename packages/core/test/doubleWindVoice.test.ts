import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CHARACTERS } from "../src/characters.js";

const PUBLIC = join(__dirname, "../../web/public");

describe("ダブ風ボイス", () => {
  it("windVoiceClipsを持つ全キャラが、4風ぶんの実在するダブ音源を指す", () => {
    let n = 0;
    for (const c of Object.values(CHARACTERS)) {
      if (!c.windVoiceClips) continue;
      for (const w of [1, 2, 3, 4] as const) {
        const p = c.doubleWindVoiceClips?.[w];
        expect(p, `${c.id} wind ${w}`).toBeTruthy();
        expect(p).toMatch(/\/yaku\/ダブ[東南西北]\.mp3$/);
        expect(existsSync(join(PUBLIC, p!)), `${c.id}: ${p}`).toBe(true);
        n++;
      }
    }
    expect(n).toBe(27 * 4);
  });
});

import { doubleWindVoiceClip } from "../src/characters.js";

describe("doubleWindVoiceClip", () => {
  const c = CHARACTERS.kagami!;
  it("自風=場風で両方の役があればダブを返す", () => {
    expect(doubleWindVoiceClip(c, ["自風牌", "場風牌"], 1, 1)).toBe("/voices/kagami/yaku/ダブ東.mp3");
    expect(doubleWindVoiceClip(c, ["ドラ", "場風牌", "自風牌"], 2, 2)).toBe("/voices/kagami/yaku/ダブ南.mp3");
  });
  it("風が違う・片方だけなら返さない", () => {
    expect(doubleWindVoiceClip(c, ["自風牌", "場風牌"], 1, 2)).toBeUndefined();
    expect(doubleWindVoiceClip(c, ["自風牌"], 1, 1)).toBeUndefined();
  });
});
