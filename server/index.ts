import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "./db.ts";
import { NovelService } from "./service.ts";
import { Worker } from "./jobs.ts";
import { createApp } from "./api.ts";
import { networkConfig } from "./network.ts";
const { host, port, ...network } = networkConfig(process.env);
const store = new Store(
    resolve(process.env.NOVEL_DATA_DIR || "data", "novel.sqlite"),
  ),
  service = new NovelService(store),
  worker = new Worker(service);
const app = createApp(service, worker, network);
if (
  process.argv.includes("--dev") ||
  process.env.npm_lifecycle_event === "dev"
) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const dist = resolve("dist");
  if (!existsSync(resolve(dist, "index.html")))
    throw new Error("npm run build를 먼저 실행하세요.");
  app.use(express.static(dist, { index: false }));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
}
const server = app.listen(port, host, () => {
  console.log("여백 서버 시작: " + host + ":" + port + " · SQLite 준비 완료");
  worker.start();
});
async function shutdown() {
  await worker.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
