import { useEffect, useState } from "react";
import { CARDS, CHARACTERS, characterRarity, type GachaItem, type InboxResponse } from "@majyan/core";
import { claimGifts, fetchInbox, markAnnouncementsSeen, useAccountStore } from "../online/account.js";

export type InboxTab = "news" | "gifts";

function itemLabel(item: GachaItem): string {
  if (item.kind === "character") return `${"★".repeat(characterRarity(item.id))} ${CHARACTERS[item.id]?.name ?? item.id}`;
  return `カード「${CARDS[item.id]?.name ?? item.id}」`;
}

function contentsLabel(jade: number, items: GachaItem[]): string {
  return [jade ? `雀玉 ${jade.toLocaleString()}` : "", ...items.map(itemLabel)].filter(Boolean).join("、");
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 受け取り期限の表示（「あと3日」「あと5時間」）。 */
function remaining(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return "期限なし";
  const hours = Math.max(0, Math.floor((expiresAt - now) / 3_600_000));
  // 2日を切ったら時間で出す（「あと1日」が実は47時間、のような食い違いを避ける）。
  return hours >= 48 ? `あと${Math.floor(hours / 24)}日` : `あと${Math.max(1, hours)}時間`;
}

/** お知らせとプレゼントボックス。 */
export function InboxScreen({ initialTab, onClose }: { initialTab: InboxTab; onClose: () => void }) {
  const [tab, setTab] = useState<InboxTab>(initialTab);
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openNewsId, setOpenNewsId] = useState<number | null>(null);
  const seenAnnouncementId = useAccountStore((s) => s.seenAnnouncementId);
  /** 開いた時点で未読だったお知らせ（開いている間は「新着」の印を残す）。 */
  const [unreadFrom] = useState(seenAnnouncementId);

  useEffect(() => {
    fetchInbox()
      .then((res) => {
        setInbox(res);
        setOpenNewsId(res.announcements[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (tab === "news" && inbox) markAnnouncementsSeen(inbox.announcements[0]?.id ?? null);
  }, [tab, inbox]);

  async function claim(giftId: number | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await claimGifts(giftId);
      setNotice(`${contentsLabel(res.jade, res.items)} を受け取りました`);
      setInbox(await fetchInbox());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();
  const gifts = inbox?.gifts ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="inbox-screen__tabs">
            <button type="button" className={`inbox-screen__tab${tab === "news" ? " is-active" : ""}`} onClick={() => setTab("news")}>
              お知らせ
            </button>
            <button type="button" className={`inbox-screen__tab${tab === "gifts" ? " is-active" : ""}`} onClick={() => setTab("gifts")}>
              プレゼント{gifts.length > 0 && `（${gifts.length}）`}
            </button>
          </div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {!inbox && !error && <p className="setup-lead">読み込んでいます…</p>}
        {error && <p className="online-lobby__error">{error}</p>}
        {notice && (
          <div className="online-lobby__notice" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}

        {inbox && tab === "news" && (
          <>
            {inbox.announcements.length === 0 && <p className="setup-lead">お知らせはありません。</p>}
            <ul className="inbox-screen__list">
              {inbox.announcements.map((a) => (
                <li key={a.id} className="inbox-screen__news">
                  <button type="button" className="inbox-screen__news-head" onClick={() => setOpenNewsId(openNewsId === a.id ? null : a.id)}>
                    {a.id > unreadFrom && <span className="inbox-screen__new">NEW</span>}
                    <span className="inbox-screen__news-title">{a.title}</span>
                    <span className="inbox-screen__date">{formatDate(a.publishedAt)}</span>
                  </button>
                  {openNewsId === a.id && <p className="inbox-screen__body">{a.body}</p>}
                </li>
              ))}
            </ul>
          </>
        )}

        {inbox && tab === "gifts" && (
          <>
            {gifts.length === 0 && <p className="setup-lead">受け取れるプレゼントはありません。</p>}
            {gifts.length > 1 && (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void claim(null)}>
                まとめて受け取る
              </button>
            )}
            <ul className="inbox-screen__list">
              {gifts.map((g) => (
                <li key={g.id} className="inbox-screen__gift">
                  <div className="inbox-screen__gift-main">
                    <div className="inbox-screen__news-title">{g.title}</div>
                    {g.message && <p className="inbox-screen__body">{g.message}</p>}
                    <div className="inbox-screen__contents">{contentsLabel(g.jade, g.items)}</div>
                    <div className="inbox-screen__date">
                      {formatDate(g.createdAt)}・{remaining(g.expiresAt, now)}
                    </div>
                  </div>
                  <button type="button" className="btn" disabled={busy} onClick={() => void claim(g.id)}>
                    受け取る
                  </button>
                </li>
              ))}
            </ul>
            <p className="gacha-screen__rate-note">受け取り期限を過ぎたプレゼントは消えます。</p>
          </>
        )}
      </div>
    </div>
  );
}
