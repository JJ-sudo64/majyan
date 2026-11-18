import { useEffect, useState } from "react";
import { CARDS, CHARACTERS, GACHA_KIND_LABELS, JADE_REASON_LABELS, rarityOf, type GachaItem, type RecordsResponse } from "@majyan/core";
import { fetchRecords } from "../online/account.js";
import { RARITY_STARS } from "./GachaCard.js";
import { useT , type Translate } from "../i18n/index.js";

type Tab = "jade" | "gacha";

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

function itemName(item: GachaItem, t: Translate): string {
  const name = (item.kind === "character" ? CHARACTERS[item.id]?.name : CARDS[item.id]?.name) ?? item.id;
  return item.kind === "card" ? t("item.card", { name }) : name;
}

/** 雀玉の増減とガチャの結果の履歴（それぞれ新しい順に100件まで）。 */
export function RecordsScreen({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("jade");
  const [records, setRecords] = useState<RecordsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecords()
      .then(setRecords)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="inbox-screen__tabs">
            <button type="button" className={`inbox-screen__tab${tab === "jade" ? " is-active" : ""}`} onClick={() => setTab("jade")}>
              {t("recordsScreen.t1")}
            </button>
            <button type="button" className={`inbox-screen__tab${tab === "gacha" ? " is-active" : ""}`} onClick={() => setTab("gacha")}>
              {t("recordsScreen.t2")}
            </button>
          </div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {!records && !error && <p className="setup-lead">{t("friendsScreen.t2")}</p>}
        {error && <p className="online-lobby__error">{error}</p>}

        {records && tab === "jade" && (
          <>
            {records.jade.length === 0 && <p className="setup-lead">{t("recordsScreen.t3")}</p>}
            <table className="history-screen__stats records-screen__table">
              <thead>
                <tr>
                  <th>{t("recordsScreen.t4")}</th>
                  <th>{t("recordsScreen.t5")}</th>
                  <th>{t("recordsScreen.t6")}</th>
                  <th>{t("recordsScreen.t7")}</th>
                </tr>
              </thead>
              <tbody>
                {records.jade.map((e, i) => {
                  const delta = e.freeDelta + e.paidDelta;
                  return (
                    <tr key={i}>
                      <td className="records-screen__date">{formatDateTime(e.at)}</td>
                      <td>{JADE_REASON_LABELS[e.reason] ?? e.reason}</td>
                      <td className={delta >= 0 ? "history-screen__delta--up" : "history-screen__delta--down"}>
                        {signed(delta)}
                        {e.paidDelta !== 0 && <small>{t("recordsScreen.t9", { v1: signed(e.paidDelta) })}</small>}
                      </td>
                      <td>{(e.freeAfter + e.paidAfter).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {records && tab === "gacha" && (
          <>
            {records.gacha.length === 0 && <p className="setup-lead">{t("recordsScreen.t3")}</p>}
            <ul className="inbox-screen__list">
              {records.gacha.map((e, i) => (
                <li key={i} className="inbox-screen__gift records-screen__gacha">
                  <div className="inbox-screen__gift-main">
                    <div className="records-screen__gacha-head">
                      <span className="inbox-screen__news-title">{GACHA_KIND_LABELS[e.kind] ?? e.kind}</span>
                      <span className="inbox-screen__date">{formatDateTime(e.at)}</span>
                    </div>
                    <div className="records-screen__items">
                      {e.results.map((item, j) => (
                        <span key={j} className={`records-screen__item records-screen__item--r${rarityOf(item)}`}>
                          {RARITY_STARS[rarityOf(item)]} {itemName(item, t)}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="gacha-screen__rate-note">{t("recordsScreen.t8")}</p>
      </div>
    </div>
  );
}
