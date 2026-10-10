import { useEffect, useState } from "react";
import {
  ADMIN_TOKEN_HEADER,
  CARDS,
  CHARACTERS,
  ONLINE_API_PREFIX,
  characterRarity,
  REPORT_REASONS,
  type AdminReport,
  type AdminAnnouncement,
  type AdminGift,
  type AdminStats,
  type AdminUser,
} from "@majyan/core";

/**
 * 運営用の管理画面（/?admin）。サーバーの ADMIN_TOKEN を入れて使う。合言葉はこのタブを
 * 閉じるまでだけ覚える（sessionStorage）。ゲーム本体とは別のページで、本体の状態には触らない。
 */
const TOKEN_KEY = "majyan.admin.token";
type Tab = "stats" | "news" | "gifts" | "users" | "reports";

function loadToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveToken(token: string) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // 保存できなくても、このページを開いている間は使える。
  }
}

class AdminAuthError extends Error {}

async function adminApi<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ONLINE_API_PREFIX}/admin${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", [ADMIN_TOKEN_HEADER]: token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 401 || res.status === 429) throw new AdminAuthError(json?.error ?? "合言葉が違います");
  if (!res.ok || !json) throw new Error(json?.error ?? `失敗しました（${res.status}）`);
  return json;
}

const fmt = (ms: number | null) =>
  ms === null ? "無期限" : new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" });

export function AdminPage() {
  const [token, setToken] = useState(loadToken);
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("stats");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>, done?: string): Promise<T | null> {
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (done) setNotice(done);
      return result;
    } catch (err) {
      if (err instanceof AdminAuthError) {
        setAuthed(false);
        saveToken("");
      }
      setError((err as Error).message);
      return null;
    }
  }

  async function login(t: string) {
    const ok = await run(() => adminApi<AdminStats>(t, "/stats"));
    if (!ok) return;
    saveToken(t);
    setToken(t);
    setAuthed(true);
  }

  useEffect(() => {
    if (token) void login(token);
  }, []);

  if (!authed) {
    return (
      <div className="admin-page">
        <h1>雀神 管理画面</h1>
        <p>サーバーの ADMIN_TOKEN を入れてください。</p>
        <form
          className="admin-row"
          onSubmit={(e) => {
            e.preventDefault();
            void login(input.trim());
          }}
        >
          <input type="password" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" />
          <button type="submit" disabled={!input.trim()}>
            入る
          </button>
        </form>
        {error && <p className="admin-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-row admin-header">
        <h1>雀神 管理画面</h1>
        <button
          type="button"
          onClick={() => {
            saveToken("");
            setAuthed(false);
          }}
        >
          出る
        </button>
      </div>
      <nav className="admin-tabs">
        {(
          [
            ["stats", "概要"],
            ["news", "お知らせ"],
            ["gifts", "プレゼント"],
            ["users", "アカウント検索"],
            ["reports", "通報"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} type="button" className={tab === t ? "is-active" : ""} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>
      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-notice">{notice}</p>}
      {tab === "stats" && <StatsTab token={token} run={run} />}
      {tab === "news" && <NewsTab token={token} run={run} />}
      {tab === "gifts" && <GiftsTab token={token} run={run} />}
      {tab === "users" && <UsersTab token={token} run={run} />}
      {tab === "reports" && <ReportsTab token={token} run={run} />}
    </div>
  );
}

type Run = <T>(fn: () => Promise<T>, done?: string) => Promise<T | null>;

function StatsTab({ token, run }: { token: string; run: Run }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const load = () => void run(() => adminApi<AdminStats>(token, "/stats")).then((s) => s && setStats(s));
  useEffect(load, []);
  if (!stats) return <p>読み込んでいます…</p>;
  const rows: [string, number][] = [
    ["アカウント数", stats.users],
    ["今日作られたアカウント", stats.newUsersToday],
    ["今日ログインした人", stats.activeToday],
    ["7日以内にログインした人", stats.activeWeek],
    ["今日の段位戦（終わった対局）", stats.rankedMatchesToday],
    ["今日のガチャ（回数）", stats.gachaRollsToday],
    ["今日配った無償の雀玉", stats.jadeGrantedToday],
    ["今日使われた雀玉", stats.jadeSpentToday],
    ["今日の売上（円）", stats.salesYenToday],
    ["今月の売上（円）", stats.salesYenMonth],
    ["残っている有償の雀玉", stats.paidJadeOutstanding],
    ["対応していない通報", stats.openReports],
    ["今ある部屋", stats.liveRooms],
    ["対局中の卓", stats.liveMatches],
  ];
  return (
    <>
      <table className="admin-table">
        <tbody>
          {rows.map(([label, n]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{n.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={load}>
        読み直す
      </button>
      <p className="admin-note">「今日」は日本時間の0時から。</p>
    </>
  );
}

function NewsTab({ token, run }: { token: string; run: Run }) {
  const [list, setList] = useState<AdminAnnouncement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [endsOn, setEndsOn] = useState("");
  useEffect(() => void run(() => adminApi<AdminAnnouncement[]>(token, "/news")).then((l) => l && setList(l)), []);
  const now = Date.now();

  async function post() {
    const l = await run(() => adminApi<AdminAnnouncement[]>(token, "/news", { title, body, endsOn }), "お知らせを出しました");
    if (!l) return;
    setList(l);
    setTitle("");
    setBody("");
    setEndsOn("");
  }

  return (
    <>
      <section className="admin-form">
        <h2>お知らせを出す</h2>
        <label>
          題
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          本文
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label>
          この日の終わりで下げる（空なら出し続ける）
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </label>
        <button type="button" disabled={!title.trim() || !body.trim()} onClick={() => void post()}>
          出す
        </button>
      </section>
      <h2>これまでのお知らせ</h2>
      <table className="admin-table">
        <tbody>
          {list.map((a) => {
            const live = a.endsAt === null || a.endsAt > now;
            return (
              <tr key={a.id}>
                <td>#{a.id}</td>
                <td>{live ? "掲載中" : "下げた"}</td>
                <td>
                  <strong>{a.title}</strong>
                  <div className="admin-pre">{a.body}</div>
                </td>
                <td>
                  {fmt(a.publishedAt)}〜{a.endsAt === null ? "" : fmt(a.endsAt)}
                </td>
                <td>
                  {live && (
                    <button
                      type="button"
                      onClick={() =>
                        void run(() => adminApi<AdminAnnouncement[]>(token, "/news/end", { id: a.id }), "下げました").then((l) => l && setList(l))
                      }
                    >
                      下げる
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function GiftsTab({ token, run }: { token: string; run: Run }) {
  const [list, setList] = useState<AdminGift[]>([]);
  const [form, setForm] = useState({ title: "", message: "", jade: "", characters: [] as string[], cards: [] as string[], to: "", includeNewAccounts: false, days: "30" });
  const [confirming, setConfirming] = useState(false);
  useEffect(() => void run(() => adminApi<AdminGift[]>(token, "/gifts")).then((l) => l && setList(l)), []);
  const now = Date.now();
  const toggle = (key: "characters" | "cards", id: string) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  async function send() {
    const l = await run(
      () =>
        adminApi<AdminGift[]>(token, "/gifts", {
          ...form,
          characters: form.characters.join(","),
          cards: form.cards.join(","),
          days: form.days === "" ? 0 : Number(form.days),
        }),
      "プレゼントを送りました",
    );
    setConfirming(false);
    if (!l) return;
    setList(l);
    setForm({ title: "", message: "", jade: "", characters: [], cards: [], to: "", includeNewAccounts: false, days: "30" });
  }

  const summary = [
    form.jade ? `雀玉 ${form.jade}` : "",
    ...form.characters.map((id) => CHARACTERS[id]?.name ?? id),
    ...form.cards.map((id) => `カード「${CARDS[id]?.name ?? id}」`),
  ]
    .filter(Boolean)
    .join("、");

  return (
    <>
      <section className="admin-form">
        <h2>プレゼントを送る</h2>
        <label>
          題
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label>
          メッセージ
          <textarea rows={2} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        </label>
        <label>
          雀玉（無償）
          <input inputMode="numeric" value={form.jade} onChange={(e) => setForm({ ...form, jade: e.target.value })} />
        </label>
        <details>
          <summary>キャラ（{form.characters.length}）</summary>
          <div className="admin-checks">
            {Object.entries(CHARACTERS).map(([id, c]) => (
              <label key={id}>
                <input type="checkbox" checked={form.characters.includes(id)} onChange={() => toggle("characters", id)} />
                {"★".repeat(characterRarity(id))} {c.name}
              </label>
            ))}
          </div>
        </details>
        <details>
          <summary>カード（{form.cards.length}）</summary>
          <div className="admin-checks">
            {Object.entries(CARDS).map(([id, c]) => (
              <label key={id}>
                <input type="checkbox" checked={form.cards.includes(id)} onChange={() => toggle("cards", id)} />
                {c.name}
              </label>
            ))}
          </div>
        </details>
        <label>
          宛先のアカウントID（先頭8文字以上。空なら全員）
          <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </label>
        {!form.to.trim() && (
          <label className="admin-inline">
            <input type="checkbox" checked={form.includeNewAccounts} onChange={(e) => setForm({ ...form, includeNewAccounts: e.target.checked })} />
            これから作られるアカウントにも渡す（記念の配布など。お詫びには付けない）
          </label>
        )}
        <label>
          受け取り期限（日。0か空なら無期限）
          <input inputMode="numeric" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
        </label>
        {!confirming ? (
          <button type="button" disabled={!form.title.trim() || !summary} onClick={() => setConfirming(true)}>
            確認する
          </button>
        ) : (
          <div className="admin-confirm">
            <p>
              <strong>{form.to.trim() ? `アカウント ${form.to.trim()} 宛て` : form.includeNewAccounts ? "全員（これから作られる人も）" : "全員（今あるアカウント）"}</strong>
              に「{form.title}」（{summary}）を送ります。送った後は取り消せますが、受け取った分は戻りません。
            </p>
            <button type="button" onClick={() => void send()}>
              送る
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              やめる
            </button>
          </div>
        )}
      </section>
      <h2>送ったプレゼント</h2>
      <table className="admin-table">
        <tbody>
          {list.map((g) => {
            const state = g.cancelled ? "取り消し" : g.expiresAt !== null && g.expiresAt <= now ? "期限切れ" : "受付中";
            return (
              <tr key={g.id}>
                <td>#{g.id}</td>
                <td>{state}</td>
                <td>
                  <strong>{g.title}</strong>
                  <div>
                    {[g.jade ? `雀玉${g.jade}` : "", ...g.items.map((i) => (i.kind === "character" ? CHARACTERS[i.id]?.name : `カード「${CARDS[i.id]?.name}」`))]
                      .filter(Boolean)
                      .join("・")}
                  </div>
                </td>
                <td>{g.targetUserId ? g.targetUserId.slice(0, 8) : g.includeNewAccounts ? "全員（新規も）" : "全員"}</td>
                <td>期限 {fmt(g.expiresAt)}</td>
                <td>受け取り {g.claimedCount}人</td>
                <td>
                  {state === "受付中" && (
                    <button
                      type="button"
                      onClick={() => void run(() => adminApi<AdminGift[]>(token, "/gifts/cancel", { id: g.id }), "取り消しました").then((l) => l && setList(l))}
                    >
                      取り消す
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function UsersTab({ token, run }: { token: string; run: Run }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  async function search() {
    const u = await run(() => adminApi<AdminUser[]>(token, `/users?q=${encodeURIComponent(q.trim())}`));
    if (u) setUsers(u);
  }
  /** 利用停止（日数。0で解除、-1で無期限）。 */
  async function suspend(user: AdminUser) {
    const input = window.prompt(`${user.displayName} さんを何日間利用停止にしますか？（0で解除、-1で無期限）`, user.suspendedUntil ? "0" : "7");
    if (input === null) return;
    const days = Number(input);
    const changed = await run(() => adminApi<AdminUser[]>(token, "/users/suspend", { id: user.id, days }), days === 0 ? "利用停止を解きました" : "利用停止にしました");
    if (changed?.[0]) setUsers((list) => list?.map((u) => (u.id === user.id ? changed[0]! : u)) ?? null);
  }
  /** 名前を変える。空欄なら当たり障りのない名前（プレイヤー1234）になる。 */
  async function rename(user: AdminUser) {
    const name = window.prompt(`${user.displayName} さんの新しい名前（空欄なら「プレイヤー1234」のような名前にします）`, "");
    if (name === null) return;
    const changed = await run(() => adminApi<AdminUser[]>(token, "/users/rename", { id: user.id, name }), "名前を変えました");
    if (changed?.[0]) setUsers((list) => list?.map((u) => (u.id === user.id ? changed[0]! : u)) ?? null);
  }
  return (
    <>
      <form
        className="admin-row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input placeholder="名前・アカウントID（先頭8文字以上）・フレンドコード" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" disabled={!q.trim()}>
          探す
        </button>
      </form>
      {users && users.length === 0 && <p>見つかりませんでした。</p>}
      {users && users.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>アカウントID</th>
              <th>名前</th>
              <th>段位</th>
              <th>雀玉（無償/有償）</th>
              <th>作成</th>
              <th>最終ログイン</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.deleted ? "admin-deleted" : undefined}>
                <td className="admin-mono">{u.id}</td>
                <td>
                  {u.displayName}
                  {u.suspendedUntil !== null && <div className="admin-error">利用停止中（{fmt(u.suspendedUntil)} まで）</div>}
                </td>
                <td>
                  {u.rankLabel}（{u.gamesPlayed}戦）
                </td>
                <td>
                  {u.jade.free.toLocaleString()} / {u.jade.paid.toLocaleString()}
                </td>
                <td>{fmt(u.createdAt)}</td>
                <td>{fmt(u.lastLoginAt)}</td>
                <td>
                  {!u.deleted && (
                    <>
                      <button type="button" onClick={() => void rename(u)}>
                        名前を変える
                      </button>{" "}
                      <button type="button" onClick={() => void suspend(u)}>
                        {u.suspendedUntil !== null ? "利用停止を変える" : "利用停止"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** 対戦相手の通報。見て、必要なら名前を変えるなどしてから「対応済み」にする。 */
function ReportsTab({ token, run }: { token: string; run: Run }) {
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    void run(() => adminApi<AdminReport[]>(token, `/reports${all ? "?all=1" : ""}`)).then((r) => r && setReports(r));
  }, [token, all]);

  async function done(id: number) {
    const open = await run(() => adminApi<AdminReport[]>(token, "/reports/done", { id }), "対応済みにしました");
    if (!open) return;
    setReports((list) => (all ? (list?.map((r) => (r.id === id ? { ...r, handled: true } : r)) ?? null) : open));
  }
  async function suspend(report: AdminReport) {
    const input = window.prompt(`${report.targetNameNow} さんを何日間利用停止にしますか？（0で解除、-1で無期限）`, "7");
    if (input === null) return;
    const days = Number(input);
    await run(() => adminApi<AdminUser[]>(token, "/users/suspend", { id: report.targetId, days }), days === 0 ? "利用停止を解きました" : "利用停止にしました");
  }
  async function resetName(report: AdminReport) {
    if (!window.confirm(`${report.targetNameNow} さんの名前を「プレイヤー1234」のような名前に変えますか？`)) return;
    const changed = await run(() => adminApi<AdminUser[]>(token, "/users/rename", { id: report.targetId }), "名前を変えました");
    const name = changed?.[0]?.displayName;
    if (name) setReports((list) => list?.map((r) => (r.targetId === report.targetId ? { ...r, targetNameNow: name } : r)) ?? null);
  }

  return (
    <>
      <label className="admin-row">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        対応済みも出す
      </label>
      <p className="admin-note">通報は記録されるだけで、自動では何も起きません。内容を見て対応してください。</p>
      {reports && reports.length === 0 && <p>{all ? "通報はまだありません。" : "対応していない通報はありません。"}</p>}
      {reports && reports.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>日時</th>
              <th>理由</th>
              <th>通報された人</th>
              <th>通報した人</th>
              <th>対局</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className={r.handled ? "admin-deleted" : undefined}>
                <td>{r.id}</td>
                <td>{fmt(r.createdAt)}</td>
                <td>{REPORT_REASONS[r.reason] ?? r.reason}</td>
                <td>
                  {r.targetNameThen}
                  {r.targetNameNow !== r.targetNameThen && `（今: ${r.targetNameNow}）`}
                  <div className="admin-mono">{r.targetId}</div>
                  <div className="admin-note">これまでに通報した人: {r.targetReporters}人</div>
                </td>
                <td className="admin-mono">{r.reporterId.slice(0, 8)}</td>
                <td className="admin-mono">{r.matchId}</td>
                <td>
                  <button type="button" onClick={() => void resetName(r)}>
                    名前を変える
                  </button>{" "}
                  <button type="button" onClick={() => void suspend(r)}>
                    利用停止
                  </button>{" "}
                  {!r.handled && (
                    <button type="button" onClick={() => void done(r.id)}>
                      対応済みにする
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
