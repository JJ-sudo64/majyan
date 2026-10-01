/**
 * 段位戦の待ち行列（マッチング）。
 *
 * 東風戦・半荘戦ごとに並んでもらい、1秒ごとに卓を組む:
 * 1. 段位の近い人（通し番号の差がmaxRankGap以内）が4人そろえば、その4人で卓を立てる
 * 2. そろわないまま cpuFillMs 以上待った人がいれば、近い段位の人をできるだけ集め、
 *    残りの席をCPUで埋めて卓を立てる（人が少ない間でも待ち続けずに遊べるように）
 * 卓を立てるのはrooms.tsのstartRankedMatch。
 */
import {
  CARDS,
  CHARACTERS,
  rankOrdinal,
  type AccountProfile,
  type ClientMessage,
  type MatchFormat,
} from "@majyan/core";
import type { Client, RoomManager } from "./rooms.js";
import type { RankService } from "./ranks.js";

export interface MatchmakerOptions {
  rooms: RoomManager;
  ranks: RankService;
  authenticate: (token: string) => AccountProfile | null;
  /** 人がそろわない時、この時間待ったら空席をCPUで埋めて始める。 */
  cpuFillMs?: number;
  /** 同じ卓に入れる段位の差（通し番号。3なら下雀1と中雀1まで）。 */
  maxRankGap?: number;
  now?: () => number;
}

interface Entry {
  client: Client;
  account: AccountProfile;
  format: MatchFormat;
  ordinal: number;
  characterId: string | null;
  cardId: string | null;
  queuedAt: number;
}

export const DEFAULT_CPU_FILL_MS = 20_000;
const TICK_MS = 1000;

export class Matchmaker {
  private queue: Entry[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly cpuFillMs: number;
  private readonly maxRankGap: number;

  constructor(private readonly options: MatchmakerOptions) {
    this.now = options.now ?? Date.now;
    this.cpuFillMs = options.cpuFillMs ?? DEFAULT_CPU_FILL_MS;
    this.maxRankGap = options.maxRankGap ?? 3;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  get waitingCount(): number {
    return this.queue.length;
  }

  handleMessage(client: Client, message: Extract<ClientMessage, { t: "queueRanked" | "cancelQueue" }>): void {
    if (message.t === "cancelQueue") {
      if (this.remove(client)) client.send({ t: "queueCancelled" });
      return;
    }
    const account = this.options.authenticate(message.authToken);
    if (!account) {
      client.send({ t: "error", message: "ログインし直してください（アカウントが確認できませんでした）", fatal: true });
      return;
    }
    if (message.format !== "hanchan" && message.format !== "tonpuusen") return;
    // 段位戦の途中で抜けていた人は、並ぶ代わりにその卓へ戻ってもらう。
    const running = this.options.rooms.runningRankedRoomOf(account.id);
    if (running) {
      client.send({ t: "matchFound", room: running, format: message.format });
      return;
    }
    if (this.options.rooms.isInRoom(client)) {
      client.send({ t: "error", message: "部屋に入ったままでは段位戦に並べません" });
      return;
    }
    // 同じアカウントが別の画面で並んでいたら、新しい方に置き換える。
    for (const e of this.queue.filter((e) => e.account.id === account.id)) {
      this.remove(e.client);
      if (e.client.id !== client.id) e.client.send({ t: "queueCancelled" });
    }
    this.queue.push({
      client,
      account,
      format: message.format,
      ordinal: rankOrdinal(this.options.ranks.get(account.id)),
      characterId: typeof message.characterId === "string" && message.characterId in CHARACTERS ? message.characterId : null,
      cardId: typeof message.cardId === "string" && message.cardId in CARDS ? message.cardId : null,
      queuedAt: this.now(),
    });
    client.send({ t: "queued", format: message.format, cpuFillInMs: this.cpuFillMs });
    this.tick();
  }

  /** 接続が切れた・タイトルへ戻った。並んでいたら外す。 */
  remove(client: Client): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((e) => e.client.id !== client.id);
    return this.queue.length !== before;
  }

  /** 卓を組めるだけ組む。 */
  tick(): void {
    const now = this.now();
    for (const format of ["tonpuusen", "hanchan"] as MatchFormat[]) {
      // 段位順に並べ、近い段位の4人を順に探す。
      let waiting = this.queue.filter((e) => e.format === format).sort((a, b) => a.ordinal - b.ordinal || a.queuedAt - b.queuedAt);
      for (let i = 0; i + 4 <= waiting.length; ) {
        const group = waiting.slice(i, i + 4);
        if (group[3]!.ordinal - group[0]!.ordinal <= this.maxRankGap) {
          this.launch(group, format);
          waiting = waiting.filter((e) => !group.includes(e));
        } else {
          i++;
        }
      }
      // 待ちすぎた人から順に、近い段位の人を集めてCPUで埋める。
      for (const oldest of [...waiting].sort((a, b) => a.queuedAt - b.queuedAt)) {
        if (!waiting.includes(oldest) || now - oldest.queuedAt < this.cpuFillMs) continue;
        const group = [oldest, ...waiting.filter((e) => e !== oldest && Math.abs(e.ordinal - oldest.ordinal) <= this.maxRankGap)]
          .sort((a, b) => Math.abs(a.ordinal - oldest.ordinal) - Math.abs(b.ordinal - oldest.ordinal))
          .slice(0, 4);
        this.launch(group, format);
        waiting = waiting.filter((e) => !group.includes(e));
      }
    }
  }

  private launch(group: Entry[], format: MatchFormat): void {
    this.queue = this.queue.filter((e) => !group.includes(e));
    this.options.rooms.startRankedMatch(
      group.map((e) => ({ client: e.client, account: e.account, characterId: e.characterId, cardId: e.cardId })),
      format,
    );
  }
}
