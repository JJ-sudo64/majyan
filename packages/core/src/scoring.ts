import type { WinAnalysis } from "./yaku/index.js";

export interface PaymentBreakdown {
  /** ロン: 放銃者が支払う額。ツモ: undefined */
  fromDiscarder?: number;
  /** ツモ: 親が支払う額（和了者が親の場合は使わない） */
  fromDealer?: number;
  /** ツモ: 子が各自支払う額（和了者が親の場合は3人が同額を支払う） */
  fromEachNonDealer?: number;
  total: number;
}

export interface ScoreResult {
  basePoints: number;
  payments: PaymentBreakdown;
  limitName?: string;
}

function ceil100(n: number): number {
  return Math.ceil(n / 100) * 100;
}

const LIMIT_NAMES = ["", "", "", "", "", "満貫", "跳満", "跳満", "倍満", "倍満", "倍満", "三倍満", "三倍満"];

export function calcBasePoints(han: number, fu: number): { base: number; limitName?: string } {
  if (han >= 13) return { base: 8000, limitName: "役満" };
  if (han >= 11) return { base: 6000, limitName: "三倍満" };
  if (han >= 8) return { base: 4000, limitName: "倍満" };
  if (han >= 6) return { base: 3000, limitName: "跳満" };
  if (han === 5) return { base: 2000, limitName: "満貫" };
  const raw = fu * Math.pow(2, 2 + han);
  if (raw > 2000) return { base: 2000, limitName: "満貫" };
  return { base: raw };
}

export function scoreWin(analysis: WinAnalysis, isDealer: boolean, isTsumo: boolean): ScoreResult {
  let base: number;
  let limitName: string | undefined;
  if (analysis.isYakuman) {
    base = 8000 * analysis.yakumanMultiplier;
    limitName = analysis.yakumanMultiplier >= 2 ? "double 役満" : "役満";
  } else {
    const r = calcBasePoints(analysis.han, analysis.fu);
    base = r.base;
    limitName = r.limitName ?? (LIMIT_NAMES[Math.min(analysis.han, 12)] || undefined);
  }

  if (isTsumo) {
    if (isDealer) {
      const each = ceil100(base * 2);
      return { basePoints: base, payments: { fromEachNonDealer: each, total: each * 3 }, limitName };
    }
    const fromDealer = ceil100(base * 2);
    const fromEachNonDealer = ceil100(base * 1);
    return {
      basePoints: base,
      payments: { fromDealer, fromEachNonDealer, total: fromDealer + fromEachNonDealer * 2 },
      limitName,
    };
  }

  const fromDiscarder = ceil100(base * (isDealer ? 6 : 4));
  return { basePoints: base, payments: { fromDiscarder, total: fromDiscarder }, limitName };
}

/** 積み棒(honba)による加算。ロンなら放銃者が全額、ツモなら全員で等分して支払う。 */
export function applyHonba(payments: PaymentBreakdown, honba: number, isTsumo: boolean): PaymentBreakdown {
  if (honba <= 0) return payments;
  if (isTsumo) {
    const perPlayer = honba * 100;
    return {
      ...payments,
      fromDealer: payments.fromDealer !== undefined ? payments.fromDealer + perPlayer : undefined,
      fromEachNonDealer: payments.fromEachNonDealer !== undefined ? payments.fromEachNonDealer + perPlayer : undefined,
      total: payments.total + perPlayer * 3,
    };
  }
  const bonus = honba * 300;
  return {
    ...payments,
    fromDiscarder: (payments.fromDiscarder ?? 0) + bonus,
    total: payments.total + bonus,
  };
}
