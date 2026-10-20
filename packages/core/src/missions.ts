/**
 * デイリーミッション（日本時間の0時に毎日リセット）とウィークリーミッション（月曜0時にリセット）。
 * 達成したら画面で受け取って雀玉をもらう。段位戦の対局そのものには雀玉の報酬は無く（10-21に廃止）、
 * 雀玉はログインボーナスとこのミッションで貯める。
 *
 * 対象は段位戦だけ（友人戦はCPUだけの卓で好きなだけ回せてしまうため）。進み具合はサーバーが
 * 段位戦の記録から数えるので、ミッションを足す時はkindに数え方を足す。数値は仮の値。
 */
export type MissionKind =
  /** 段位戦をtarget回打つ */
  | "ranked-games"
  /** 段位戦で2位以上にtarget回入る */
  | "ranked-top2"
  /** 段位戦で1位にtarget回なる */
  | "ranked-first";

/** 毎日リセット（日本時間の0時）か、毎週リセット（月曜0時）か。 */
export type MissionPeriod = "daily" | "weekly";

export interface MissionDef {
  id: string;
  label: string;
  period: MissionPeriod;
  kind: MissionKind;
  target: number;
  /** 報酬の無償の雀玉。 */
  jade: number;
}

export const DAILY_MISSIONS: readonly MissionDef[] = [
  { id: "daily-ranked-1", label: "段位戦を1回打つ", period: "daily", kind: "ranked-games", target: 1, jade: 30 },
  { id: "daily-top2-1", label: "段位戦で2位以上に入る", period: "daily", kind: "ranked-top2", target: 1, jade: 30 },
  { id: "daily-ranked-3", label: "段位戦を3回打つ", period: "daily", kind: "ranked-games", target: 3, jade: 50 },
];

/** ウィークリー（仮の値。1週間で合計350雀玉）。 */
export const WEEKLY_MISSIONS: readonly MissionDef[] = [
  { id: "weekly-ranked-10", label: "段位戦を10回打つ", period: "weekly", kind: "ranked-games", target: 10, jade: 100 },
  { id: "weekly-top2-5", label: "段位戦で2位以上に5回入る", period: "weekly", kind: "ranked-top2", target: 5, jade: 100 },
  { id: "weekly-first-2", label: "段位戦で1位になる（2回）", period: "weekly", kind: "ranked-first", target: 2, jade: 150 },
];

export const ALL_MISSIONS: readonly MissionDef[] = [...DAILY_MISSIONS, ...WEEKLY_MISSIONS];

/** 画面に出す1件。 */
export interface MissionView {
  id: string;
  label: string;
  period: MissionPeriod;
  progress: number;
  target: number;
  jade: number;
  claimed: boolean;
}
