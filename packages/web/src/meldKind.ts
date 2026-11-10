/**
 * 配置編集モードの仮表示の副露の種類（ポン・暗槓・加槓）。
 * 暗槓と加槓は別々のフラグ配列で持っているので、ボタンで「ポン→暗槓→加槓→ポン」と
 * 順に切り替える時の読み替えをここにまとめる。加槓は見え方の確認だけで、位置はポンのまま。
 */
export type MeldKind = "pon" | "ankan" | "kakan";

export const MELD_KIND_LABEL: Record<MeldKind, string> = { pon: "ポン", ankan: "暗槓", kakan: "加槓" };

export function meldKindOf(ankan: boolean | undefined, kakan: boolean | undefined): MeldKind {
  return ankan ? "ankan" : kakan ? "kakan" : "pon";
}

/** 次の種類（ポン→暗槓→加槓→ポン）。 */
export function nextMeldKind(kind: MeldKind): MeldKind {
  return kind === "pon" ? "ankan" : kind === "ankan" ? "kakan" : "pon";
}

/** 種類を2つのフラグ（暗槓・加槓）に反映する。 */
export function applyMeldKind(kind: MeldKind, slot: number, setAnkan: (slot: number, v: boolean) => void, setKakan: (slot: number, v: boolean) => void) {
  setAnkan(slot, kind === "ankan");
  setKakan(slot, kind === "kakan");
}
