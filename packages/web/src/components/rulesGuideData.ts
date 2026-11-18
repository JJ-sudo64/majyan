/**
 * 「ルール＆ガイド」の中身（遊び方のページ・役の一覧）。点数表は計算で作る（RulesGuide.tsx）。
 * 役の翻数はcoreの役判定（core/src/yaku/index.ts）と同じ数字を手で写している。判定の数字を
 * 変えたら、ここも直すこと（自動のテストは無いので、役の追加・変更の時に目で見て合わせる）。
 */

import type { MessageKey } from "../i18n/index.js";
import { DAILY_LOGIN_JADE, EXCHANGE_COST, EXCHANGE_RARITY, GACHA_PRICE, TEN_PULL_GUARANTEE } from "@majyan/core";

/** basic=麻雀そのものの説明、game=このゲームならではの要素（必殺技・カード・ガチャなど）。 */
export type GuideGroup = "basic" | "game";

export const GUIDE_GROUP_LABELS: Record<GuideGroup, MessageKey> = { basic: "guide.group.basic", game: "guide.group.game" };

export interface GuidePage {
  group: GuideGroup;
  title: MessageKey;
  lines: MessageKey[];
}

/** 「遊び方」のページ。1ページは画面に収まる分量にする。 */
export const GUIDE_PAGES: GuidePage[] = [
  {
    group: "basic",
    title: "guide.p0.title",
    lines: [
      "guide.p0.l0",
      "guide.p0.l1",
      "guide.p0.l2",
      "guide.p0.l3",
      "guide.p0.l4",
    ],
  },
  {
    group: "basic",
    title: "guide.p1.title",
    lines: [
      "guide.p1.l0",
      "guide.p1.l1",
      "guide.p1.l2",
      "guide.p1.l3",
    ],
  },
  {
    group: "basic",
    title: "guide.p2.title",
    lines: [
      "guide.p2.l0",
      "guide.p2.l1",
      "guide.p2.l2",
      "guide.p2.l3",
    ],
  },
  {
    group: "basic",
    title: "guide.p3.title",
    lines: [
      "guide.p3.l0",
      "guide.p3.l1",
      "guide.p3.l2",
      "guide.p3.l3",
    ],
  },
  {
    group: "basic",
    title: "guide.p4.title",
    lines: [
      "guide.p4.l0",
      "guide.p4.l1",
      "guide.p4.l2",
      "guide.p4.l3",
    ],
  },
  {
    group: "basic",
    title: "guide.p5.title",
    lines: [
      "guide.p5.l0",
      "guide.p5.l1",
      "guide.p5.l2",
      "guide.p5.l3",
    ],
  },
  {
    group: "game",
    title: "guide.p6.title",
    lines: [
      "guide.p6.l0",
      "guide.p6.l1",
      "guide.p6.l2",
      "guide.p6.l3",
    ],
  },
  {
    group: "game",
    title: "guide.p7.title",
    lines: [
      "guide.p7.l0",
      "guide.p7.l1",
      "guide.p7.l2",
      "guide.p7.l3",
    ],
  },
  {
    group: "game",
    title: "guide.p8.title",
    lines: [
      "guide.p8.l0",
      "guide.p8.l1",
      "guide.p8.l2",
      "guide.p8.l3",
    ],
  },
  {
    group: "game",
    title: "guide.p9.title",
    lines: [
      "guide.p9.l0",
      "guide.p9.l1",
      "guide.p9.l2",
      "guide.p9.l3",
    ],
  },
];

export interface YakuEntry {
  name: MessageKey;
  /** 門前の翻数。役満は「役満」「ダブル役満」。 */
  han: string;
  /** 鳴いた時の翻数。鳴けない役は"-"、変わらない役はhanと同じ。 */
  openHan: string;
  description: MessageKey;
}

export interface YakuGroup {
  id: string;
  label: MessageKey;
  yaku: YakuEntry[];
}

const y = (name: MessageKey, han: string, openHan: string, description: MessageKey): YakuEntry => ({ name, han, openHan, description });

export const YAKU_GROUPS: YakuGroup[] = [
  {
    id: "han1",
    label: "yaku.group.0",
    yaku: [
      y("yaku.0.n", "1", "-", "yaku.0.d"),
      y("yaku.1.n", "1", "-", "yaku.1.d"),
      y("yaku.2.n", "1", "-", "yaku.2.d"),
      y("yaku.3.n", "1", "-", "yaku.3.d"),
      y("yaku.4.n", "1", "1", "yaku.4.d"),
      y("yaku.5.n", "1", "1", "yaku.5.d"),
      y("yaku.6.n", "1", "-", "yaku.6.d"),
      y("yaku.7.n", "1", "1", "yaku.7.d"),
      y("yaku.8.n", "1", "1", "yaku.8.d"),
      y("yaku.9.n", "1", "1", "yaku.9.d"),
      y("yaku.10.n", "1", "1", "yaku.10.d"),
    ],
  },
  {
    id: "han2",
    label: "yaku.group.1",
    yaku: [
      y("yaku.11.n", "2", "-", "yaku.11.d"),
      y("yaku.12.n", "2", "-", "yaku.12.d"),
      y("yaku.13.n", "2", "1", "yaku.13.d"),
      y("yaku.14.n", "2", "2", "yaku.14.d"),
      y("yaku.15.n", "2", "1", "yaku.15.d"),
      y("yaku.16.n", "2", "1", "yaku.16.d"),
      y("yaku.17.n", "2", "2", "yaku.17.d"),
      y("yaku.18.n", "2", "2", "yaku.18.d"),
      y("yaku.19.n", "2", "2", "yaku.19.d"),
      y("yaku.20.n", "2", "2", "yaku.20.d"),
      y("yaku.21.n", "2", "2", "yaku.21.d"),
    ],
  },
  {
    id: "han3",
    label: "yaku.group.2",
    yaku: [
      y("yaku.22.n", "3", "-", "yaku.22.d"),
      y("yaku.23.n", "3", "2", "yaku.23.d"),
      y("yaku.24.n", "3", "2", "yaku.24.d"),
      y("yaku.25.n", "6", "5", "yaku.25.d"),
      y("yaku.26.n", "3", "-", "yaku.26.d"),
      y("yaku.27.n", "4", "-", "yaku.27.d"),
    ],
  },
  {
    id: "yakuman",
    label: "yaku.group.3",
    yaku: [
      y("yaku.28.n", "yaku.yakuman", "-", "yaku.28.d"),
      y("yaku.29.n", "yaku.yakuman", "-", "yaku.29.d"),
      y("yaku.30.n", "yaku.yakuman", "-", "yaku.30.d"),
      y("yaku.31.n", "yaku.yakuman", "yaku.yakuman", "yaku.31.d"),
      y("yaku.32.n", "yaku.yakuman", "yaku.yakuman", "yaku.32.d"),
      y("yaku.33.n", "yaku.double", "yaku.double", "yaku.33.d"),
      y("yaku.34.n", "yaku.yakuman", "yaku.yakuman", "yaku.34.d"),
      y("yaku.35.n", "yaku.yakuman", "yaku.yakuman", "yaku.35.d"),
      y("yaku.36.n", "yaku.yakuman", "yaku.yakuman", "yaku.36.d"),
      y("yaku.37.n", "yaku.yakuman", "yaku.yakuman", "yaku.37.d"),
      y("yaku.38.n", "yaku.yakuman", "-", "yaku.38.d"),
      y("yaku.39.n", "yaku.yakuman", "-", "yaku.39.d"),
    ],
  },
  {
    id: "extra",
    label: "yaku.group.4",
    yaku: [
      y("yaku.40.n", "1", "1", "yaku.40.d"),
      y("yaku.41.n", "1", "1", "yaku.41.d"),
      y("yaku.42.n", "1", "1", "yaku.42.d"),
      y("yaku.43.n", "-", "-", "yaku.43.d"),
    ],
  },
];


/** 説明文の {single} などに入れる数字（コアの設定値）。 */
export const GUIDE_PARAMS = {
  single: GACHA_PRICE.single,
  ten: GACHA_PRICE.ten.toLocaleString(),
  rarity: TEN_PULL_GUARANTEE.rarity,
  daily: DAILY_LOGIN_JADE,
  cost: EXCHANGE_COST,
  exRarity: EXCHANGE_RARITY,
};
