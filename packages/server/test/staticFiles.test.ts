import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createStaticHandler } from "../src/staticFiles.js";

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "majyan-static-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<html>top</html>");
  writeFileSync(join(dir, "assets", "app-123.js"), "console.log(1)");
  writeFileSync(join(dir, "secret-sibling.txt"), "x");
  const handler = createStaticHandler(dir)!;
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe("createStaticHandler", () => {
  it("returns null when there is no build", () => {
    expect(createStaticHandler(join(dir, "missing"))).toBeNull();
  });

  it("serves files with content types and caching", async () => {
    const top = await fetch(`${base}/`);
    expect(top.status).toBe(200);
    expect(top.headers.get("content-type")).toContain("text/html");
    expect(top.headers.get("cache-control")).toBe("no-cache");
    const js = await fetch(`${base}/assets/app-123.js`);
    expect(await js.text()).toBe("console.log(1)");
    expect(js.headers.get("cache-control")).toContain("immutable");
  });

  it("falls back to index.html for extensionless paths and 404s missing files", async () => {
    expect(await (await fetch(`${base}/some/page`)).text()).toBe("<html>top</html>");
    expect((await fetch(`${base}/nope.png`)).status).toBe(404);
  });

  it("does not let paths escape the build directory", async () => {
    for (const p of ["/..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/windows/win.ini", "/assets/..%5c..%5c..%5cboot.ini"]) {
      const res = await fetch(`${base}${p}`);
      expect([403, 404, 200]).toContain(res.status);
      if (res.status === 200) expect(await res.text()).toBe("<html>top</html>");
    }
  });

  it("rejects non-GET methods", async () => {
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
  });
});
