import { useState } from "react";
import { scoreWin, type WinAnalysis } from "@majyan/core";
import { GUIDE_GROUP_LABELS, GUIDE_PAGES, YAKU_GROUPS, type GuideGroup } from "./rulesGuideData.js";
import { useT, type MessageKey, type Translate } from "../i18n/index.js";

type Tab = "guide" | "yaku" | "points";

const TABS: [Tab, MessageKey][] = [
  ["guide", "rules.tabGuide"],
  ["yaku", "rules.tabYaku"],
  ["points", "rules.tabPoints"],
];

/** 符の一覧（点数表の行）。 */
const FU_ROWS = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110] as const;
const HAN_COLUMNS = [1, 2, 3, 4] as const;
/** 満貫以上の行（翻数と名前）。 */
const LIMIT_ROWS: { han: number; label: MessageKey; yakuman?: boolean }[] = [
  { han: 5, label: "rules.limit5" },
  { han: 6, label: "rules.limit6" },
  { han: 8, label: "rules.limit8" },
  { han: 11, label: "rules.limit11" },
  { han: 13, label: "rules.limit13", yakuman: true },
];

/** 点数表の1マス。scoreWinをそのまま使うので、実際の対局の計算と必ず一致する。 */
function pointCell(t: Translate, han: number, fu: number, isDealer: boolean, isTsumo: boolean, yakuman = false): string {
  // 20符はツモだけ（平和ツモ）、25符は七対子（2翻から）。ありえない組み合わせは出さない。
  if (!yakuman && ((fu === 20 && (!isTsumo || han < 2)) || (fu === 25 && han < 2))) return "-";
  const analysis = { han, fu, isYakuman: yakuman, yakumanMultiplier: 1 } as unknown as WinAnalysis;
  const { payments } = scoreWin(analysis, isDealer, isTsumo);
  if (!isTsumo) return String(payments.fromDiscarder);
  return isDealer ? t("rules.all", { n: payments.fromEachNonDealer ?? 0 }) : `${payments.fromEachNonDealer}/${payments.fromDealer}`;
}

function GuideTab({ initialGroup }: { initialGroup?: GuideGroup }) {
  const t = useT();
  const [page, setPage] = useState(() => (initialGroup ? Math.max(0, GUIDE_PAGES.findIndex((p) => p.group === initialGroup)) : 0));
  const current = GUIDE_PAGES[page]!;
  return (
    <div className="rules-guide__guide">
      {/* 麻雀の基本／このゲームの特徴（必殺技・カード・ガチャ）の先頭へ飛べる。知っている人は、後ろから読める。 */}
      <div className="rules-guide__chips" role="group" aria-label={t("rulesGuide.t1")}>
        {(Object.keys(GUIDE_GROUP_LABELS) as GuideGroup[]).map((g) => (
          <button
            key={g}
            type="button"
            className={`rules-guide__chip${current.group === g ? " is-active" : ""}`}
            onClick={() => setPage(Math.max(0, GUIDE_PAGES.findIndex((p) => p.group === g)))}
          >
            {GUIDE_GROUP_LABELS[g]}
          </button>
        ))}
      </div>
      <h3 className="rules-guide__page-title">
        {page + 1}. {current.title}
      </h3>
      <ul className="rules-guide__lines">
        {current.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="rules-guide__pager">
        <button type="button" className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
          {t("rulesGuide.t2")}
        </button>
        <span>
          {page + 1} / {GUIDE_PAGES.length}
        </span>
        <button type="button" className="btn" disabled={page === GUIDE_PAGES.length - 1} onClick={() => setPage(page + 1)}>
          {t("rulesGuide.t3")}
        </button>
      </div>
    </div>
  );
}

function YakuTab() {
  const t = useT();
  const [groupId, setGroupId] = useState(YAKU_GROUPS[0]!.id);
  const group = YAKU_GROUPS.find((g) => g.id === groupId)!;
  return (
    <div className="rules-guide__yaku">
      <div className="rules-guide__chips">
        {YAKU_GROUPS.map((g) => (
          <button key={g.id} type="button" className={`rules-guide__chip${g.id === groupId ? " is-active" : ""}`} onClick={() => setGroupId(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      <table className="rules-guide__table">
        <thead>
          <tr>
            <th>{t("rulesGuide.t4")}</th>
            <th>{t("rulesGuide.t5")}</th>
            <th>{t("rulesGuide.t6")}</th>
            <th>{t("recordsScreen.t5")}</th>
          </tr>
        </thead>
        <tbody>
          {group.yaku.map((entry) => (
            <tr key={entry.name}>
              <th scope="row">{entry.name}</th>
              <td>{entry.han}</td>
              <td>{entry.openHan}</td>
              <td className="rules-guide__desc">{entry.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {group.id === "han1" && <p className="rules-guide__note">{t("rulesGuide.t7")}</p>}
    </div>
  );
}

function PointsTab() {
  const t = useT();
  const [isDealer, setIsDealer] = useState(false);
  const [isTsumo, setIsTsumo] = useState(false);
  return (
    <div className="rules-guide__points">
      <div className="rules-guide__chips">
        <button type="button" className={`rules-guide__chip${!isDealer ? " is-active" : ""}`} onClick={() => setIsDealer(false)}>
          {t("rulesGuide.t8")}
        </button>
        <button type="button" className={`rules-guide__chip${isDealer ? " is-active" : ""}`} onClick={() => setIsDealer(true)}>
          {t("rulesGuide.t9")}
        </button>
        <span className="rules-guide__chips-gap" />
        <button type="button" className={`rules-guide__chip${!isTsumo ? " is-active" : ""}`} onClick={() => setIsTsumo(false)}>
          {t("call.ron")}
        </button>
        <button type="button" className={`rules-guide__chip${isTsumo ? " is-active" : ""}`} onClick={() => setIsTsumo(true)}>
          {t("rulesGuide.t10")}
        </button>
      </div>
      <div className="rules-guide__points-cols">
        <table className="rules-guide__table rules-guide__table--points">
          <thead>
            <tr>
              <th>{t("rulesGuide.t11")}</th>
              {HAN_COLUMNS.map((h) => (
                <th key={h}>{t("rulesGuide.t14", { h })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FU_ROWS.map((fu) => (
              <tr key={fu}>
                <th scope="row">{t("rulesGuide.t15", { fu })}</th>
                {HAN_COLUMNS.map((h) => (
                  <td key={h}>{pointCell(t, h, fu, isDealer, isTsumo)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rules-guide__limits">
          <table className="rules-guide__table rules-guide__table--points">
            <thead>
              <tr>
                <th>{t("rulesGuide.t12")}</th>
                <th>{t("rulesGuide.t13")}</th>
              </tr>
            </thead>
            <tbody>
              {LIMIT_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{t(row.label)}</th>
                  <td>{pointCell(t, row.han, 30, isDealer, isTsumo, row.yakuman)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rules-guide__note">{t("rulesGuide.t16", { v1: isDealer ? t("rulesGuide.t17") : t("rulesGuide.t18") })}</p>
        </div>
      </div>
    </div>
  );
}

/** ルール＆ガイド。遊び方・役一覧・点数表を、スクロールなしで1画面ずつ見せる。 */
export function RulesGuide({ onClose, initialTab = "guide", initialGroup }: { onClose: () => void; initialTab?: Tab; initialGroup?: GuideGroup }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen rules-guide" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="inbox-screen__tabs">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={`inbox-screen__tab${tab === id ? " is-active" : ""}`} onClick={() => setTab(id)}>
                {t(label)}
              </button>
            ))}
          </div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        {tab === "guide" && <GuideTab initialGroup={initialGroup} />}
        {tab === "yaku" && <YakuTab />}
        {tab === "points" && <PointsTab />}
      </div>
    </div>
  );
}
