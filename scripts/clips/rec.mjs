// usage: node rec.mjs <characterId> <outDir>
// ゲームのストアを直接操作し、必殺技カットインを時刻つきフレームで保存する。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [id, outDir, mode] = process.argv.slice(2);
const URL = `http://localhost:5199/?lang=${process.env.CLIP_LANG ?? "en"}`;
fs.mkdirSync(outDir, { recursive: true });
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "majyan-pp-"));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  userDataDir: prof,
  headless: "new",
  args: ["--window-size=1392,748", "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1392, height: 748 },
});
let result = { ok: false };
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("majyan.autoTsumogiri", "0");
    localStorage.setItem("majyan.settingsDefaultsRevision", "2026-09-27");
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 4000));
  const frames = [];
  const cdp = await page.createCDPSession();
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await page.evaluate(async (cid, RIICHI) => {
    const m = await import("/src/store/gameStore.ts");
    window.__s = m.useGameStore;
    m.useGameStore.getState().startMatch("tonpuusen", false, undefined, cid);
    window.__riichiMode = RIICHI;
    { const g = m.useGameStore; const f = g.getState().fullMatch; g.setState({ fullMatch: { ...f, round: { ...f.round, cardIds: [null, null, null, null], cardIds2: [null, null, null, null] } } }); }
  }, id, mode === "riichi");
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
  let tries = 0, success = false, callAt = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && !success) {
    const st = await page.evaluate(() => {
      const s = window.__s.getState();
      return { turn: !!s.humanOptions?.turn && s.humanOptions.turn !== null, hold: s.cutinHold, has: !!s.fullMatch, call: !!s.humanCallOptions };
    });
    if (st.call && !st.hold) { await page.evaluate(() => window.__s.getState().humanSkip()); await new Promise((r) => setTimeout(r, 300)); continue; }
    if (st.has && st.turn && !st.hold) {
      tries++;
      const prep = await page.evaluate(async () => {
        const g = window.__s;
        let full = g.getState().fullMatch;
        const mk = (players, extra = {}) => ({ ...full, round: { ...full.round, players, ...extra } });
        const drawn = full.round.lastDrawnTile;
        let players = full.round.players.map((p, i) => (i === 0 ? { ...p, skillGauge: 999 } : p));
        if (window.__riichiMode) {
          const codes = ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","1p","2p","3p"];
          let k = 0;
          const concealed = players[0].hand.concealed.map((t) => t.id === drawn.id ? { ...t, code: "7z", isRed: false } : { ...t, code: codes[k++] ?? "9s", isRed: false });
          players = players.map((p, i) => i === 0 ? { ...p, hand: { ...p.hand, concealed } } : p);
          g.setState({ fullMatch: mk(players, { lastDrawnTile: { ...drawn, code: "7z", isRed: false } }) });
        } else g.setState({ fullMatch: mk(players) });
        { const mt = g.getState().match; if (mt) g.setState({ match: { ...mt, round: { ...mt.round, players: mt.round.players.map((p, i) => (i === 0 ? { ...p, skillGauge: 999 } : p)) } } }); }
        return { drawnId: drawn.id };
      });
      await new Promise((r2) => setTimeout(r2, 700));
      const r = await page.evaluate(async (drawnId) => {
        const g = window.__s;
        const callAt = Date.now() / 1000;
        try {
          if (window.__riichiMode) g.getState().humanRiichi(drawnId); else g.getState().humanUseSkill();
        } catch (e) { window.__err = String(e); }
        await new Promise((r) => setTimeout(r, 400));
        const after = g.getState().fullMatch?.round.players[0].skillGauge;
        return { callAt, after };
      }, prep.drawnId);
      console.log("try", tries, JSON.stringify(r));
      if (r.after === 0) { success = true; callAt = r.callAt; await new Promise((r2) => setTimeout(r2, 6500)); break; }
      // 不発: 打牌して次の手番へ
      await page.evaluate(() => {
        const s = window.__s.getState();
        const rr = s.match?.round;
        const t = rr?.lastDrawnTile ?? rr?.players[0].hand.concealed[0];
        if (t) s.humanDiscard(t.id);
      });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await cdp.send("Page.stopScreencast");
  const holdAt = callAt; console.log("err", await page.evaluate(() => window.__err));
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({ id, holdAt, n: frames.length, t0: frames[0]?.t, tEnd: frames.at(-1)?.t }));
  frames.forEach((f, i) => fs.writeFileSync(path.join(outDir, `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64")));
  fs.writeFileSync(path.join(outDir, "times.txt"), frames.map((f) => f.t).join("\n"));
  result = { ok: !!holdAt, holdAt, n: frames.length };
} catch (e) {
  result = { ok: false, error: String(e) };
} finally {
  await browser.close();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(JSON.stringify(result));
