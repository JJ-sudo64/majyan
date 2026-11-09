import { describe, expect, it } from "vitest";
import { LivePeak } from "../src/livePeak.js";

const dayOf = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const DAY = 24 * 3600_000;
// 日本時間 2026-11-09 12:00
const T0 = Date.parse("2026-11-09T12:00:00+09:00");

describe("LivePeak", () => {
  it("記録が無ければ0", () => {
    expect(new LivePeak(dayOf).peaks(T0)).toEqual({ peakPlayersToday: 0, peakConnectionsToday: 0 });
  });
  it("今日の最大値を覚え、下がっても保つ", () => {
    const p = new LivePeak(dayOf);
    p.record(T0, 5, 8);
    p.record(T0 + 1000, 12, 9);
    p.record(T0 + 2000, 3, 4);
    expect(p.peaks(T0 + 3000)).toEqual({ peakPlayersToday: 12, peakConnectionsToday: 9 });
  });
  it("日付（日本時間）が変わると数え直す", () => {
    const p = new LivePeak(dayOf);
    p.record(T0, 12, 12);
    expect(p.peaks(T0 + DAY)).toEqual({ peakPlayersToday: 0, peakConnectionsToday: 0 });
    p.record(T0 + DAY, 2, 3);
    expect(p.peaks(T0 + DAY)).toEqual({ peakPlayersToday: 2, peakConnectionsToday: 3 });
  });
});
