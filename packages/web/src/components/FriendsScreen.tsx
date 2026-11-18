import { useEffect, useState } from "react";
import { formatFriendCode, type FriendsResponse, type FriendView } from "@majyan/core";
import { fetchFriends, friendAction } from "../online/account.js";
import { useT, txRank, type Translate } from "../i18n/index.js";

/** 最終ログインの表示（「3分前」「2日前」）。 */
function ago(ms: number, now: number, t: Translate): string {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 60) return t("friends.agoMinutes", { n: Math.max(1, minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("friends.agoHours", { n: hours });
  return t("friends.agoDays", { n: Math.floor(hours / 24) });
}

function presenceLabel(f: FriendView, now: number, t: Translate): string {
  if (f.presence === "playing") return t("friends.playing");
  if (f.presence) return t("friends.waiting");
  return t("friends.lastLogin", { ago: ago(f.lastLoginAt, now, t) });
}

/**
 * フレンド。自分のフレンドコードを相手に伝えて申請してもらい、承認すると成立する。
 * フレンドが友人戦の待合室にいれば「参加する」でその部屋に入れる。
 */
export function FriendsScreen({
  onClose,
  onJoinRoom,
  onSpectate,
}: {
  onClose: () => void;
  onJoinRoom: (room: string) => void;
  onSpectate: (friendCode: string) => void;
}) {
  const t = useT();
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  /** 「フレンドをやめる」を確かめている相手のコード。 */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const reload = () =>
    fetchFriends()
      .then(setData)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void reload();
    // 開いている間は、フレンドが部屋に入ったのが分かるように時々読み直す。
    const id = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(id);
  }, []);

  async function act(fn: () => Promise<FriendsResponse>, done?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setData(await fn());
      if (done) setNotice(done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.myCode);
      setNotice(t("friends.copied"));
    } catch {
      setNotice(t("friends.copyFailed"));
    }
  }

  const now = Date.now();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen friends-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">{t("friendsScreen.t1")}</div>
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
            <div className="friends-screen__mine">
              <span>{t("friendsScreen.t3")}</span>
              <strong>{formatFriendCode(data.myCode)}</strong>
              <button type="button" className="btn online-lobby__gacha-btn" onClick={() => void copyCode()}>
                {t("friendsScreen.t4")}
              </button>
            </div>

            <div className="online-lobby__form">
              <label className="online-lobby__field">
                <span>{t("friendsScreen.t5")}</span>
                <input
                  value={code}
                  inputMode="numeric"
                  placeholder="12345-67890"
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && code.trim()) void act(() => friendAction("request", code), t("friends.requested"));
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!code.trim() || busy}
                onClick={() =>
                  void act(async () => {
                    const res = await friendAction("request", code);
                    setCode("");
                    return res;
                  }, t("friends.requestedPending"))
                }
              >
                {t("friendsScreen.t6")}
              </button>
            </div>

            {data.incoming.length > 0 && (
              <>
                <div className="online-lobby__section-title">{t("friendsScreen.t7")}</div>
                <ul className="inbox-screen__list">
                  {data.incoming.map((r) => (
                    <li key={r.code} className="inbox-screen__gift">
                      <div className="inbox-screen__gift-main">
                        <div className="inbox-screen__news-title">{r.displayName}</div>
                        <div className="inbox-screen__date">{txRank(r.rankLabel)}</div>
                      </div>
                      <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void act(() => friendAction("respond", r.code, true), t("friendsScreen.t17", { displayName: r.displayName }))}>
                        {t("friendsScreen.t8")}
                      </button>
                      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void act(() => friendAction("respond", r.code, false))}>
                        {t("friendsScreen.t9")}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="online-lobby__section-title">{t("friendsScreen.t18", { length: data.friends.length })}</div>
            {data.friends.length === 0 && <p className="setup-lead">{t("friendsScreen.t10")}</p>}
            <ul className="inbox-screen__list">
              {data.friends.map((f) => (
                <li key={f.code} className={`inbox-screen__gift${f.presence && f.presence !== "playing" ? " friends-screen__waiting" : ""}`}>
                  <div className="inbox-screen__gift-main">
                    <div className="inbox-screen__news-title">
                      {f.displayName} <span className="history-screen__rank">{txRank(f.rankLabel)}</span>
                    </div>
                    <div className="inbox-screen__date">{presenceLabel(f, now, t)}</div>
                  </div>
                  {f.presence && f.presence !== "playing" && (
                    <button type="button" className="btn btn--primary" onClick={() => onJoinRoom((f.presence as { room: string }).room)}>
                      {t("friendsScreen.t11")}
                    </button>
                  )}
                  {f.presence === "playing" && (
                    <button type="button" className="btn" onClick={() => onSpectate(f.code)}>
                      {t("friendsScreen.t12")}
                    </button>
                  )}
                  {confirmRemove === f.code ? (
                    <>
                      <button type="button" className="btn transfer-screen__delete" disabled={busy} onClick={() => void act(() => friendAction("remove", f.code))}>
                        {t("cardSlot.t7")}
                      </button>
                      <button type="button" className="btn btn--secondary" onClick={() => setConfirmRemove(null)}>
                        {t("friendsScreen.t13")}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--secondary friends-screen__remove" onClick={() => setConfirmRemove(f.code)}>
                      …
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {data.outgoing.length > 0 && (
              <>
                <div className="online-lobby__section-title">{t("friendsScreen.t14")}</div>
                <ul className="inbox-screen__list">
                  {data.outgoing.map((r) => (
                    <li key={r.code} className="inbox-screen__gift">
                      <div className="inbox-screen__gift-main">
                        <div className="inbox-screen__news-title">{r.displayName}</div>
                        <div className="inbox-screen__date">{txRank(r.rankLabel)}</div>
                      </div>
                      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void act(() => friendAction("remove", r.code))}>
                        {t("friendsScreen.t15")}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="gacha-screen__rate-note">{t("friendsScreen.t16")}</p>
          </>
        )}
      </div>
    </div>
  );
}
