/**
 * 「今日の最大の同時人数」を覚える。メモリだけで持つので、サーバーを再起動すると数え直す。
 * 日付は日本時間で区切る（管理画面の他の「今日」と同じ）。
 */
export class LivePeak {
  private day = "";
  private players = 0;
  private connections = 0;

  constructor(private readonly dayOf: (ms: number) => string) {}

  /** 今の人数を渡して最大値を更新する。日付が変わっていたら数え直す。 */
  record(nowMs: number, players: number, connections: number): void {
    const day = this.dayOf(nowMs);
    if (day !== this.day) {
      this.day = day;
      this.players = 0;
      this.connections = 0;
    }
    this.players = Math.max(this.players, players);
    this.connections = Math.max(this.connections, connections);
  }

  /** 今日の最大値（今日まだ記録が無ければ0）。 */
  peaks(nowMs: number): { peakPlayersToday: number; peakConnectionsToday: number } {
    if (this.dayOf(nowMs) !== this.day) return { peakPlayersToday: 0, peakConnectionsToday: 0 };
    return { peakPlayersToday: this.players, peakConnectionsToday: this.connections };
  }
}
