import assert from "node:assert/strict";
import "dotenv/config";
const base =
  process.env.NOVEL_SMOKE_ORIGIN ||
  "http://127.0.0.1:" + (process.env.NOVEL_PORT || "4317");
const health = await fetch(base + "/api/health");
assert.equal(health.status, 200);
assert.equal((await health.json()).service, "novel-machine");
const session = await fetch(base + "/api/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: process.env.NOVEL_ACCESS_TOKEN || "" }),
});
assert.equal(session.status, 200, "session authentication");
const cookie = session.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
const projects = await fetch(base + "/api/projects", {
  headers: { Cookie: cookie },
});
assert.equal(projects.status, 200);
assert.ok(Array.isArray(await projects.json()));
const page = await fetch(base);
assert.equal(page.status, 200);
const html = await page.text();
assert.ok(html.includes("여백"));
const script = html.match(/<script[^>]*src="([^"]+)"/);
assert.ok(script);
const asset = await fetch(new URL(script[1], base));
assert.equal(asset.status, 200);
assert.ok((asset.headers.get("content-type") || "").includes("javascript"));
console.log(
  "PASS: health, session authentication, project API, HTML, JavaScript asset. No story data changed.",
);
