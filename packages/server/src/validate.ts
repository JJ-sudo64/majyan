/**
 * 画面から届いたメッセージの形のチェック。中身の正しさ（その牌を本当に
 * 持っているか、今その操作ができるか等）はcoreのapplyActionが判定するので、
 * ここでは「想定した形のJSONか」だけを見て、変な値でcore側が想定外の
 * 例外を起こさないようにする。
 */
import type { ClientMessage, GameAction } from "@majyan/core";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const isSeat = (v: unknown) => v === 0 || v === 1 || v === 2 || v === 3;
const isNullableStr = (v: unknown) => v === null || isStr(v);
const isStrArray = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every((x) => isStr(x));
const TILE_CODE = /^[1-9][mps]$|^[1-7]z$/;
const isTileCode = (v: unknown) => typeof v === "string" && TILE_CODE.test(v);

function isValidAction(a: unknown): a is GameAction {
  if (!isObj(a) || !isStr(a.type, 30) || !isSeat(a.player)) return false;
  switch (a.type) {
    case "discard":
      return isStr(a.tileId) && typeof a.tsumogiri === "boolean";
    case "riichi":
    case "kakan":
      return isStr(a.tileId);
    case "ankan":
      return isTileCode(a.tileCode);
    case "chi":
      return (
        Array.isArray(a.tileCodes) && a.tileCodes.length === 3 && a.tileCodes.every(isTileCode) &&
        isStrArray(a.usedHandTileIds, 2) && (a.usedHandTileIds as unknown[]).length === 2
      );
    case "pon":
      return isStrArray(a.usedHandTileIds, 2) && (a.usedHandTileIds as unknown[]).length === 2;
    case "minkan":
      return isStrArray(a.usedHandTileIds, 3) && (a.usedHandTileIds as unknown[]).length === 3;
    case "tsumo":
    case "ron":
    case "skip":
    case "kyushukyuhai":
    case "useSkill":
    case "useCard":
      return true;
    case "borrowSkill":
      return isSeat(a.target);
    case "retrieveDiscard":
      return isStr(a.reclaimTileId) && isStr(a.replacementTileId);
    case "swapTiles":
      return isStrArray(a.tileIds, 14);
    default:
      // drawは画面から送れない。知らない種類も受け付けない。
      return false;
  }
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || !isStr(m.t, 20)) return null;
  switch (m.t) {
    case "join":
      if (!isStr(m.room) || !isStr(m.authToken) || !isNullableStr(m.unitId)) return null;
      return m as ClientMessage;
    case "queueRanked":
      return isStr(m.authToken) && (m.format === "hanchan" || m.format === "tonpuusen") && isNullableStr(m.unitId)
        ? (m as ClientMessage)
        : null;
    case "cancelQueue":
      return m as ClientMessage;
    case "setLoadout":
      return isNullableStr(m.unitId) ? (m as ClientMessage) : null;
    case "start":
      return (m.format === "hanchan" || m.format === "tonpuusen") && typeof m.continueBelowZero === "boolean"
        ? (m as ClientMessage)
        : null;
    case "action":
      return isValidAction(m.action) ? (m as ClientMessage) : null;
    case "spectate":
      return isStr(m.authToken) && isStr(m.friendCode, 30) ? (m as ClientMessage) : null;
    case "nextRound":
    case "leave":
      return m as ClientMessage;
    default:
      return null;
  }
}
