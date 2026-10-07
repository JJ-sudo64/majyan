/**
 * CPUの思考を受け持つワーカー（cpuPool.tsが立てる）。サーバー本体のイベントループで
 * 思考すると、重い局面（まれに100ms超）の間すべての卓が止まるため、別スレッドで行う。
 */
import { parentPort } from "node:worker_threads";
import { decideCpuCallResponse, decideCpuTurnAction } from "@majyan/core";
import type { CpuRequest, CpuResponse } from "./cpuPool.js";

parentPort!.on("message", (req: CpuRequest) => {
  let res: CpuResponse;
  try {
    const action =
      req.kind === "turn" ? decideCpuTurnAction(req.round, req.seat, req.difficulty) : decideCpuCallResponse(req.round, req.seat, req.difficulty);
    res = { id: req.id, action };
  } catch (err) {
    res = { id: req.id, error: String(err) };
  }
  parentPort!.postMessage(res);
});
