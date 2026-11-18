import { useEffect, useState } from "react";
import type { MissionsResponse } from "@majyan/core";
import { claimMissions, fetchMissions } from "../online/account.js";
import { playUiSuccess } from "../sound.js";
import { useT } from "../i18n/index.js";

/** リセットまでの残り（「あと5時間」「あと30分」）。 */
function untilReset(resetsAt: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((resetsAt - now) / 60_000));
  return minutes >= 60 ? `あと${Math.floor(minutes / 60)}時間` : `あと${minutes}分`;
}

/** デイリー・ウィークリーミッション。段位戦を打つと進み、達成したら受け取ると雀玉がもらえる。 */
export function MissionsScreen({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState<MissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMissions()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function claim(missionId: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await claimMissions(missionId);
      setData((d) => (d ? { ...d, missions: res.missions } : d));
      setNotice(t("missionsScreen.t4", { jade: res.jade }));
      playUiSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = data?.missions.filter((m) => !m.claimed && m.progress >= m.target) ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">{t("missionsScreen.t1")}</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        {!data && !error && <p className="setup-lead">{t("friendsScreen.t2")}</p>}
        {error && <p className="online-lobby__error">{error}</p>}
        {notice && (
          <div className="online-lobby__notice" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
        {data && (
          <>
            <p className="setup-lead">{t("missionsScreen.t5", { v1: untilReset(data.resetsAt, Date.now()), v2: untilReset(data.weeklyResetsAt, Date.now()) })}</p>
            {ready.length > 1 && (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void claim(null)}>
                {t("inboxScreen.t4")}
              </button>
            )}
            {(["daily", "weekly"] as const).map((period) => (
            <div key={period}>
            <div className="setup-character-select__label">{period === "daily" ? t("missionsScreen.t6") : t("missionsScreen.t7")}</div>
            <ul className="inbox-screen__list">
              {data.missions.filter((m) => m.period === period).map((m) => {
                const done = m.progress >= m.target;
                return (
                  <li key={m.id} className={`inbox-screen__gift missions-screen__mission${m.claimed ? " is-claimed" : ""}`}>
                    <div className="inbox-screen__gift-main">
                      <div className="inbox-screen__news-title">{m.label}</div>
                      <div className="missions-screen__bar">
                        <div className="missions-screen__bar-fill" style={{ width: `${(m.progress / m.target) * 100}%` }} />
                      </div>
                      <div className="inbox-screen__date">{t("missionsScreen.t8", { progress: m.progress, target: m.target, jade: m.jade })}</div>
                    </div>
                    {m.claimed ? (
                      <span className="missions-screen__claimed">{t("missionsScreen.t2")}</span>
                    ) : (
                      <button type="button" className="btn" disabled={!done || busy} onClick={() => void claim(m.id)}>
                        {done ? t("inboxScreen.t5") : t("missionsScreen.t9")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            </div>
            ))}
            <p className="gacha-screen__rate-note">{t("missionsScreen.t3")}</p>
          </>
        )}
      </div>
    </div>
  );
}
