/**
 * CPUの思考を別スレッド（cpuWorker.ts）に任せる。数本のワーカーへ順に振り分け、
 * 結果をPromiseで返す。ワーカーが落ちた・返事が遅すぎる時は、その場（本体のスレッド）で
 * 考え直して必ず答えを返す（対局が止まらないように）。ワーカーが立ち上がってすぐ落ちる
 * ことが続く時は立て直しをやめ、以後は本体で考える（落ちては立て直すを繰り返さないように）。
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import {
  decideCpuCallResponse,
  decideCpuTurnAction,
  type AiDifficulty,
  type GameAction,
  type PlayerIndex,
  type RoundState,
} from "@majyan/core";

export type CpuDecisionKind = "turn" | "call";

export interface CpuRequest {
  id: number;
  kind: CpuDecisionKind;
  round: RoundState;
  seat: PlayerIndex;
  difficulty: AiDifficulty;
}

export type CpuResponse = { id: number; action: GameAction } | { id: number; error: string };

/** 1回の思考を待つ上限。超えたら本体で考え直す。 */
const DECISION_TIMEOUT_MS = 3000;
/** この時間内にこの回数ワーカーが落ちたら、立て直しをやめて本体で考える。 */
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES_IN_WINDOW = 5;

interface Pending {
  req: CpuRequest;
  worker: Worker;
  resolve: (action: GameAction) => void;
  timer: ReturnType<typeof setTimeout>;
}

function decideHere(req: Omit<CpuRequest, "id">): GameAction {
  return req.kind === "turn" ? decideCpuTurnAction(req.round, req.seat, req.difficulty) : decideCpuCallResponse(req.round, req.seat, req.difficulty);
}

/** ワーカーでもTypeScriptのまま読めるよう、tsxの読み込み設定を付ける（親がtsxで動いていれば引き継ぐ）。 */
function workerExecArgv(): string[] {
  return process.execArgv.some((a) => a.includes("tsx")) ? process.execArgv : [...process.execArgv, "--import", "tsx"];
}

export class CpuPool {
  private readonly workers: (Worker | null)[] = [];
  private readonly pending = new Map<number, Pending>();
  private readonly crashes: number[] = [];
  private nextId = 1;
  private nextWorker = 0;
  private closed = false;
  /** ワーカーが落ち続けたので本体で考えている。 */
  private degraded = false;

  /** sizeを省くと「コア数−1」本（最低1本、最大4本）。 */
  constructor(size = Math.min(4, Math.max(1, availableParallelism() - 1))) {
    for (let i = 0; i < size; i++) this.spawn(i);
  }

  private spawn(index: number): void {
    const worker = new Worker(new URL("./cpuWorker.ts", import.meta.url), { execArgv: workerExecArgv() });
    worker.unref();
    worker.on("message", (res: CpuResponse) => this.settle(res));
    worker.on("error", (err) => console.error("[majyan-server] CPUのワーカーでエラーが起きました:", err));
    worker.on("exit", () => {
      this.workers[index] = null;
      // このワーカーに頼んでいた分は、待たずに本体で考え直す。
      for (const [id, p] of this.pending) {
        if (p.worker !== worker) continue;
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.resolve(decideHere(p.req));
      }
      if (this.closed || this.degraded) return;
      const now = Date.now();
      this.crashes.push(now);
      while (this.crashes.length && now - this.crashes[0]! > CRASH_WINDOW_MS) this.crashes.shift();
      if (this.crashes.length >= MAX_CRASHES_IN_WINDOW) {
        this.degraded = true;
        console.error("[majyan-server] CPUのワーカーが落ち続けるため、CPUの思考を本体で行います");
        return;
      }
      this.spawn(index);
    });
    this.workers[index] = worker;
  }

  private settle(res: CpuResponse): void {
    const p = this.pending.get(res.id);
    if (!p) return;
    this.pending.delete(res.id);
    clearTimeout(p.timer);
    if ("action" in res) p.resolve(res.action);
    else {
      console.error("[majyan-server] CPUの思考に失敗したため本体で考え直します:", res.error);
      p.resolve(decideHere(p.req));
    }
  }

  private pickWorker(): Worker | null {
    for (let i = 0; i < this.workers.length; i++) {
      const w = this.workers[this.nextWorker++ % this.workers.length];
      if (w) return w;
    }
    return null;
  }

  decide(kind: CpuDecisionKind, round: RoundState, seat: PlayerIndex, difficulty: AiDifficulty): Promise<GameAction> {
    const req: CpuRequest = { id: this.nextId++, kind, round, seat, difficulty };
    const worker = this.closed || this.degraded ? null : this.pickWorker();
    if (!worker) return Promise.resolve(decideHere(req));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(req.id)) return;
        console.error("[majyan-server] CPUの思考が遅すぎるため本体で考え直します");
        resolve(decideHere(req));
      }, DECISION_TIMEOUT_MS);
      this.pending.set(req.id, { req, worker, resolve, timer });
      worker.postMessage(req);
    });
  }

  /** ワーカーが落ち続けて本体で考えているか（テスト・監視用）。 */
  get isDegraded(): boolean {
    return this.degraded;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve(decideHere(p.req));
    }
    this.pending.clear();
    await Promise.all(this.workers.map((w) => w?.terminate()));
  }
}
