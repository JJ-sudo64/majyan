import { useState } from "react";
import { scoreWin, type WinAnalysis } from "@majyan/core";
import { GUIDE_PAGES, YAKU_GROUPS } from "./rulesGuideData.js";

type Tab = "guide" | "yaku" | "points";

const TABS: [Tab, string][] = [
  ["guide", "遊び方"],
  ["yaku", "役一覧"],
  ["points", "点数表"],
];

/** 符の一覧（点数表の行）。 */
const FU_ROWS = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110] as const;
const HAN_COLUMNS = [1, 2, 3, 4] as const;
/** 満貫以上の行（翻数と名前）。 */
const LIMIT_ROWS: { han: number; label: string; yakuman?: boolean }[] = [
  { han: 5, label: "満貫（5翻）" },
  { han: 6, label: "跳満（6〜7翻）" },
  { han: 8, label: "倍満（8〜10翻）" },
  { han: 11, label: "三倍満（11〜12翻）" },
  { han: 13, label: "役満（13翻〜）", yakuman: true },
];

/** 点数表の1マス。scoreWinをそのまま使うので、実際の対局の計算と必ず一致する。 */
function pointCell(han: number, fu: number, isDealer: boolean, isTsumo: boolean, yakuman = false): string {
  // 20符はツモだけ（平和ツモ）、25符は七対子（2翻から）。ありえない組み合わせは出さない。
  if (!yakuman && ((fu === 20 && (!isTsumo || han < 2)) || (fu === 25 && han < 2))) return "-";
  const analysis = { han, fu, isYakuman: yakuman, yakumanMultiplier: 1 } as unknown as WinAnalysis;
  const { payments } = scoreWin(analysis, isDealer, isTsumo);
  if (!isTsumo) return String(payments.fromDiscarder);
  return isDealer ? `${payments.fromEachNonDealer}オール` : `${payments.fromEachNonDealer}/${payments.fromDealer}`;
}

function GuideTab() {
  const [page, setPage] = useState(0);
  const current = GUIDE_PAGES[page]!;
  return (
    <div className="rules-guide__guide">
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
          ‹ 前へ
        </button>
        <span>
          {page + 1} / {GUIDE_PAGES.length}
        </span>
        <button type="button" className="btn" disabled={page === GUIDE_PAGES.length - 1} onClick={() => setPage(page + 1)}>
          次へ ›
        </button>
      </div>
    </div>
  );
}

function YakuTab() {
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
            <th>役</th>
            <th>門前</th>
            <th>鳴き</th>
            <th>内容</th>
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
      {group.id === "han1" && <p className="rules-guide__note">「鳴き」の「-」は、鳴いている（門前でない）手では成立しない役です。</p>}
    </div>
  );
}

function PointsTab() {
  const [isDealer, setIsDealer] = useState(false);
  const [isTsumo, setIsTsumo] = useState(false);
  return (
    <div className="rules-guide__points">
      <div className="rules-guide__chips">
        <button type="button" className={`rules-guide__chip${!isDealer ? " is-active" : ""}`} onClick={() => setIsDealer(false)}>
          子
        </button>
        <button type="button" className={`rules-guide__chip${isDealer ? " is-active" : ""}`} onClick={() => setIsDealer(true)}>
          親
        </button>
        <span className="rules-guide__chips-gap" />
        <button type="button" className={`rules-guide__chip${!isTsumo ? " is-active" : ""}`} onClick={() => setIsTsumo(false)}>
          ロン
        </button>
        <button type="button" className={`rules-guide__chip${isTsumo ? " is-active" : ""}`} onClick={() => setIsTsumo(true)}>
          ツモ
        </button>
      </div>
      <div className="rules-guide__points-cols">
        <table className="rules-guide__table rules-guide__table--points">
          <thead>
            <tr>
              <th>符＼翻</th>
              {HAN_COLUMNS.map((h) => (
                <th key={h}>{h}翻</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FU_ROWS.map((fu) => (
              <tr key={fu}>
                <th scope="row">{fu}符</th>
                {HAN_COLUMNS.map((h) => (
                  <td key={h}>{pointCell(h, fu, isDealer, isTsumo)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rules-guide__limits">
          <table className="rules-guide__table rules-guide__table--points">
            <thead>
              <tr>
                <th>満貫以上</th>
                <th>点数</th>
              </tr>
            </thead>
            <tbody>
              {LIMIT_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{pointCell(row.han, 30, isDealer, isTsumo, row.yakuman)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rules-guide__note">
            ツモは「{isDealer ? "全員が支払う額 オール" : "子が払う額／親が払う額"}」です。本場がつくと、ロンは1本場ごとに+300点、ツモは1本場ごとに各+100点です。5翻以上は符に関係なく決まります。
          </p>
        </div>
      </div>
    </div>
  );
}

/** ルール＆ガイド。遊び方・役一覧・点数表を、スクロールなしで1画面ずつ見せる。 */
export function RulesGuide({ onClose, initialTab = "guide" }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen rules-guide" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="inbox-screen__tabs">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={`inbox-screen__tab${tab === id ? " is-active" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        {tab === "guide" && <GuideTab />}
        {tab === "yaku" && <YakuTab />}
        {tab === "points" && <PointsTab />}
      </div>
    </div>
  );
}
