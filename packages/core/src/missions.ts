/**
 * デイリーミッション（日本時間の0時に毎日リセット）。達成したら画面で受け取って雀玉をもらう。
 *
 * 対象は段位戦だけ（友人戦はCPUだけの卓で好きなだけ回せてしまうため）。進み具合はサーバーが
 * 段位戦の記録から数えるので、ミッションを足す時はkindに数え方を足す。数値は仮の値。
 */
export type MissionKind =
  /** 段位戦をtarget回打つ */
  | "ranked-games"
  /** 段位戦で2位以上にtarget回入る */
  | "ranked-top2";

export interface MissionDef {
  id: string;
  label: string;
  kind: MissionKind;
  target: number;
  /** 報酬の無償の雀玉。 */
  jade: number;
}

export const DAILY_MISSIONS: readonly MissionDef[] = [
  { id: "daily-ranked-1", label: "段位戦を1回打つ", kind: "ranked-games", target: 1, jade: 30 },
  { id: "daily-top2-1", label: "段位戦で2位以上に入る", kind: "ranked-top2", target: 1, jade: 30 },
  { id: "daily-ranked-3", label: "段位戦を3回打つ", kind: "ranked-games", target: 3, jade: 50 },
];

/** 画面に出す1件。 */
export interface MissionView {
  id: string;
  label: string;
  progress: number;
  target: number;
  jade: number;
  claimed: boolean;
}
