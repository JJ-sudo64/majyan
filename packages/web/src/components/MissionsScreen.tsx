import { useEffect, useState } from "react";
import type { MissionsResponse } from "@majyan/core";
import { claimMissions, fetchMissions } from "../online/account.js";

/** リセットまでの残り（「あと5時間」「あと30分」）。 */
function untilReset(resetsAt: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((resetsAt - now) / 60_000));
  return minutes >= 60 ? `あと${Math.floor(minutes / 60)}時間` : `あと${minutes}分`;
}

/** デイリーミッション。段位戦を打つと進み、達成したら受け取ると雀玉がもらえる。 */
export function MissionsScreen({ onClose }: { onClose: () => void }) {
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
      setNotice(`雀玉 ${res.jade} を受け取りました`);
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
          <div className="setup-character-select__label">デイリーミッション</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        {!data && !error && <p className="setup-lead">読み込んでいます…</p>}
        {error && <p className="online-lobby__error">{error}</p>}
        {notice && (
          <div className="online-lobby__notice" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
        {data && (
          <>
            <p className="setup-lead">毎日0時（日本時間）に新しくなります（{untilReset(data.resetsAt, Date.now())}）。</p>
            {ready.length > 1 && (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void claim(null)}>
                まとめて受け取る
              </button>
            )}
            <ul className="inbox-screen__list">
              {data.missions.map((m) => {
                const done = m.progress >= m.target;
                return (
                  <li key={m.id} className={`inbox-screen__gift missions-screen__mission${m.claimed ? " is-claimed" : ""}`}>
                    <div className="inbox-screen__gift-main">
                      <div className="inbox-screen__news-title">{m.label}</div>
                      <div className="missions-screen__bar">
                        <div className="missions-screen__bar-fill" style={{ width: `${(m.progress / m.target) * 100}%` }} />
                      </div>
                      <div className="inbox-screen__date">
                        {m.progress} / {m.target}・報酬 雀玉 {m.jade}
                      </div>
                    </div>
                    {m.claimed ? (
                      <span className="missions-screen__claimed">受け取り済み</span>
                    ) : (
                      <button type="button" className="btn" disabled={!done || busy} onClick={() => void claim(m.id)}>
                        {done ? "受け取る" : "未達成"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="gacha-screen__rate-note">ミッションは段位戦だけが対象です（友人戦は数えません）。</p>
          </>
        )}
      </div>
    </div>
  );
}
