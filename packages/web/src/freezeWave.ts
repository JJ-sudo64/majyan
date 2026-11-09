import { useSyncExternalStore, type CSSProperties } from "react";
import type { RoundState } from "@majyan/core";

/**
 * 必殺技「時間停止」のグレーアウトを、発動者の席から外へ順に広げるための遅れ（秒）。
 * 発動者本人の席はグレーにならないので、隣の席（下家・上家）→ 向かいの席の順に遅れる。
 * 卓の中央（点数表示など）は発動者のすぐ外側なので、隣の席より少し早く灰色になる。
 * 本人（source）が同じ席・または発動者がいない時は遅れ無し。
 */
export const FREEZE_WAVE_CENTER_S = 0.25;

export function freezeDelaySeconds(source: number | undefined, seat: number | "center"): number {
  if (source === undefined) return 0;
  if (seat === "center") return FREEZE_WAVE_CENTER_S;
  const rel = (seat - source + 4) % 4;
  if (rel === 0) return 0;
  return rel === 2 ? 0.9 : 0.5;
}

/** グレーアウト用のクラスが付く要素に渡すstyle（styles.cssの--freeze-delay・--thaw-delay参照）。 */
export function freezeDelayStyle(source: number | undefined, seat: number | "center"): CSSProperties {
  return {
    ["--freeze-delay" as string]: `${freezeDelaySeconds(source, seat)}s`,
    ["--thaw-delay" as string]: `${thawDelaySeconds(source, seat)}s`,
  } as CSSProperties;
}

/**
 * 灰色が戻る時の遅れ（秒）。広がる時と逆に、発動者の席から遠い所から先に色が戻り、
 * 発動者の席に向かって灰色が縮んでいく。広がる時の逆順（向かいの席 → 隣の席 → 卓の中央）。
 */
export function thawDelaySeconds(source: number | undefined, seat: number | "center"): number {
  if (source === undefined) return 0;
  if (seat === "center") return 0.5;
  const rel = (seat - source + 4) % 4;
  return rel === 2 || rel === 0 ? 0 : 0.25;
}

/** 色が戻る演出を始めてから、灰色のクラスを外すまでの時間（最後の遅れ0.5s＋transition0.5s＋余裕）。 */
export const THAW_TOTAL_MS = 1200;

/** 色が戻る演出の開始・終了。実体はhtmlのdata-freeze-thaw属性で、styles.cssが灰色を外す。 */
export function setFreezeThaw(on: boolean) {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.setAttribute("data-freeze-thaw", "1");
  else document.documentElement.removeAttribute("data-freeze-thaw");
}

/**
 * 時間停止が解けた後も、終了ボイスが鳴り終わるまで灰色を保つための「居残り」。
 * 実際の効果（timeStopTurnsRemaining）は先に0になるので、見た目だけここで遅らせる。
 */
let heldSource: number | undefined;
const listeners = new Set<() => void>();
export function holdFreezeSource(source: number | undefined) {
  if (heldSource === source) return;
  heldSource = source;
  listeners.forEach((l) => l());
}
function subscribeHeld(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 灰色の演出に使う「時間停止の発動者」。実際の発動者がいなければ、居残り中の発動者。 */
export function useFreezeSource(round: RoundState | undefined): 0 | 1 | 2 | 3 | undefined {
  const held = useSyncExternalStore(subscribeHeld, () => heldSource);
  const real = round ? ([0, 1, 2, 3] as const).find((seat) => round.players[seat]!.timeStopTurnsRemaining > 0) : undefined;
  return real ?? (held as 0 | 1 | 2 | 3 | undefined);
}
