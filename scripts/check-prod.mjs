// 本番の疎通確認: 各ドメインで 画面(HTTP) と オンライン対戦(WebSocket) が通るか見る。
// デプロイ・ドメイン変更・環境変数(ALLOWED_ORIGINS等)の変更のあとに必ず実行する。
//   node scripts/check-prod.mjs
// 1つでも失敗したら終了コード1。
const HOSTS = ["play-janhai.maxplantlabs.com", "majyan-jansin.fly.dev"];
const OFFICIAL = "https://janhai.maxplantlabs.com/";

let failed = false;
const report = (ok, label, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "OK  " : "NG  "} ${label}${detail ? "  " + detail : ""}`);
};

async function checkHttp(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    report(res.status === 200, `画面 ${url}`, `HTTP ${res.status}`);
  } catch (e) {
    report(false, `画面 ${url}`, String(e.message ?? e));
  }
}

function checkWs(host) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://${host}/ws`, { headers: { Origin: `https://${host}` } });
    const timer = setTimeout(() => {
      report(false, `対戦接続 wss://${host}/ws`, "タイムアウト");
      try { ws.close(); } catch {}
      resolve();
    }, 8000);
    ws.onopen = () => {
      clearTimeout(timer);
      report(true, `対戦接続 wss://${host}/ws`);
      ws.close();
      resolve();
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      report(false, `対戦接続 wss://${host}/ws`, "拒否またはエラー（ALLOWED_ORIGINSを確認）");
      resolve();
    };
  });
}

await checkHttp(OFFICIAL);
for (const h of HOSTS) {
  await checkHttp(`https://${h}/`);
  await checkWs(h);
}
console.log(failed ? "\n失敗あり" : "\nすべて正常");
process.exit(failed ? 1 : 0);
