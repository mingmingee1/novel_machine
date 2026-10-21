import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  Branch,
  Candidate,
  Job,
  Source,
  Excerpt,
} from "../shared/domain.ts";
import { AppError } from "./db.ts";
import { NovelService } from "./service.ts";
import { Worker } from "./jobs.ts";
import { providerStatus } from "./providers.ts";

const same = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function createApp(
  service: NovelService,
  worker: Worker,
  options: {
    accessToken?: string;
    localOnly?: boolean;
    publicOrigin?: string;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  const external = options.publicOrigin
    ? new URL(options.publicOrigin)
    : undefined;
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const sessions = new Map<string, { expires: number; csrf: string }>(),
    attempts = new Map<string, { count: number; until: number }>();
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    // Requests from another origin cannot read data or trigger CLI execution, even on localhost.
    let requestHost: URL;
    try {
      requestHost = new URL("http://" + req.headers.host);
    } catch {
      return res.status(403).json({ error: "접속 주소를 확인하세요." });
    }
    if (
      external &&
      requestHost.host !== external.host &&
      !localHosts.has(requestHost.hostname)
    )
      return res
        .status(403)
        .json({ error: "설정된 개인망 주소로 접속하세요." });
    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (parsed.host !== req.headers.host) throw new Error();
        if (
          external &&
          requestHost.host === external.host &&
          parsed.origin !== external.origin
        )
          throw new Error();
      } catch {
        return res
          .status(403)
          .json({ error: "다른 사이트에서 보낸 요청은 허용하지 않습니다." });
      }
    }
    if (options.localOnly !== false) {
      if (!localHosts.has(requestHost.hostname))
        return res.status(403).json({ error: "로컬 접근만 허용합니다." });
    }
    next();
  });
  app.use(express.json({ limit: "30mb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "novel-machine", schema: 1 }),
  );
  app.post("/api/session", (req, res) => {
    const key = req.ip ?? "unknown",
      attempt = attempts.get(key),
      time = Date.now();
    if (attempt && attempt.until > time && attempt.count >= 8)
      return res.status(429).json({ error: "잠시 후 다시 시도하세요." });
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (options.accessToken && !same(password, options.accessToken)) {
      attempts.set(key, {
        count: attempt && attempt.until > time ? attempt.count + 1 : 1,
        until: time + 60000,
      });
      return res
        .status(401)
        .json({ error: "접속 암호를 확인하세요.", needsPassword: true });
    }
    if (!options.accessToken && options.localOnly === false)
      return res
        .status(503)
        .json({ error: "개인망 접속 암호를 먼저 설정하세요." });
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    sessions.set(token, { expires: time + 7 * 86400000, csrf });
    res.cookie("novel_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: !!external || req.secure,
      maxAge: 7 * 86400000,
      path: "/",
    });
    res.json({ csrf, localOnly: options.localOnly !== false });
  });
  app.use("/api", (req, res, next) => {
    const token = (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("novel_session="))
      ?.slice(14);
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expires < Date.now())
      return res.status(401).json({
        error: "접속을 다시 연결하세요.",
        needsPassword: !!options.accessToken,
      });
    if (req.method !== "GET" && req.headers["x-csrf-token"] !== session.csrf)
      return res.status(403).json({
        error: "요청 인증이 만료됐습니다. 새로고침 후 다시 시도하세요.",
      });
    next();
  });
  app.get("/api/projects", (_req, res) => res.json(service.projects()));
  app.post("/api/projects", (req, res) =>
    res.status(201).json(service.createProject(req.body)),
  );
  app.get("/api/projects/:projectId/branches", (req, res) =>
    res.json(
      service.store.list<Branch>("branch", String(req.params.projectId)),
    ),
  );
  app.get("/api/branches/:id", (req, res) =>
    res.json(service.workspace(String(req.params.id))),
  );
  app.post("/api/branches/:id/fork", (req, res) =>
    res.status(201).json(service.fork(String(req.params.id), req.body)),
  );
  app.post("/api/branches/:id/settings", (req, res) =>
    res.status(201).json(service.setting(String(req.params.id), req.body)),
  );
  app.post("/api/branches/:id/settings-import", (req, res) => {
    const data = z
      .object({
        baseRevision: z.number().int(),
        items: z
          .array(
            z.object({
              kind: z.enum(["character", "world", "relationship", "rule"]),
              name: z.string().min(1),
              text: z.string().min(1),
              aliases: z.array(z.string()).default([]),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(req.body);
    const saved = service.store.transaction(() =>
      data.items.map((item) =>
        service.setting(String(req.params.id), {
          ...item,
          baseRevision: data.baseRevision,
          scope: "branch",
          status: "proposed",
        }),
      ),
    );
    res.status(201).json(saved);
  });
  app.get("/api/branches/:id/search", (req, res) =>
    res.json(service.search(String(req.params.id), String(req.query.q ?? ""))),
  );
  app.post("/api/branches/:id/import", (req, res) =>
    res.status(201).json(service.importText(String(req.params.id), req.body)),
  );
  app.post("/api/import/preview", (req, res) =>
    res.json(
      service.importPreview(
        z.string().min(1).max(2_000_000).parse(req.body.text),
      ),
    ),
  );
  app.post("/api/candidates/:id/edit", (req, res) =>
    res.json(service.editCandidate(String(req.params.id), req.body)),
  );
  app.post("/api/candidates/:id/review", (req, res) =>
    res.json(service.review(String(req.params.id))),
  );
  app.post("/api/candidates/:id/discard", (req, res) =>
    res.json(service.discard(String(req.params.id))),
  );
  app.post("/api/candidates/:id/restore", (req, res) =>
    res.json(service.restoreCandidate(String(req.params.id))),
  );
  app.post("/api/candidates/:id/commit", (req, res) =>
    res.json(
      service.commit(
        String(req.params.id),
        z.number().int().parse(req.body.baseRevision),
      ),
    ),
  );
  app.get("/api/candidates/:id/impacts", (req, res) =>
    res.json(service.impacts(String(req.params.id))),
  );
  app.post("/api/candidates/:id/import-lab", (req, res) =>
    res.json(service.importLab(String(req.params.id))),
  );
  app.post("/api/jobs", (req, res) =>
    res.status(202).json(service.createJob(req.body)),
  );
  app.get("/api/jobs/:id", (req, res) =>
    res.json(service.store.require<Job>("job", String(req.params.id))),
  );
  app.post("/api/jobs/:id/cancel", (req, res) =>
    res.json(worker.cancel(String(req.params.id))),
  );
  app.post("/api/jobs/:id/retry", (req, res) =>
    res.status(202).json(service.retry(String(req.params.id))),
  );
  app.get("/api/jobs/:id/events", (req, res) => {
    const jobId = String(req.params.id);
    service.store.require("job", jobId);
    let after = Number(req.headers["last-event-id"] ?? req.query.after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) after = 0;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const send = () => {
      const events = service.store.events(jobId, after) as {
        seq: number;
        type: string;
        data: string;
      }[];
      for (const event of events) {
        res.write(
          "id: " +
            event.seq +
            "\nevent: " +
            event.type +
            "\ndata: " +
            event.data +
            "\n\n",
        );
        after = event.seq;
      }
      const job = service.store.require<Job>("job", jobId);
      if (!["running", "queued"].includes(job.status) && events.length < 200) {
        res.write("event: done\ndata: {}\n\n");
        res.end();
      }
    };
    send();
    const interval = setInterval(send, 300),
      heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    res.on("close", () => {
      clearInterval(interval);
      clearInterval(heartbeat);
    });
  });
  app.get("/api/providers", async (_req, res) =>
    res.json(await providerStatus()),
  );
  app.post("/api/projects/:id/sources", (req, res) =>
    res
      .status(201)
      .json(service.library.source(String(req.params.id), req.body)),
  );
  app.post("/api/projects/:id/excerpts", (req, res) =>
    res
      .status(201)
      .json(service.library.excerpt(String(req.params.id), req.body)),
  );
  app.post("/api/projects/:id/profiles", (req, res) =>
    res
      .status(201)
      .json(service.library.profile(String(req.params.id), req.body)),
  );
  app.post("/api/projects/:id/style-bindings", (req, res) =>
    res
      .status(201)
      .json(service.library.binding(String(req.params.id), req.body)),
  );
  app.post("/api/profiles/:id/restore", (req, res) =>
    res.json(service.library.restore(String(req.params.id))),
  );
  app.post("/api/projects/:id/feedback", (req, res) =>
    res
      .status(201)
      .json(service.library.feedback(String(req.params.id), req.body)),
  );
  app.post("/api/feedback/:id/apply", (req, res) =>
    res.json(service.library.applyFeedback(String(req.params.id))),
  );
  app.post("/api/sources/:id/exclude", (req, res) => {
    const source = service.store.require<Source>(
      "source",
      String(req.params.id),
    );
    source.excluded = z.boolean().parse(req.body.excluded);
    service.store.put("source", source);
    res.json(source);
  });
  app.post("/api/excerpts/:id/edit", (req, res) => {
    const e = service.store.require<Excerpt>("excerpt", String(req.params.id));
    const data = z
      .object({
        tags: z.array(z.string()).optional(),
        sceneTags: z.array(z.string()).optional(),
        preference: z.enum(["like", "avoid"]).optional(),
        note: z.string().optional(),
        excluded: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(service.store.put("excerpt", { ...e, ...data }));
  });
  app.get("/api/projects/:id/backup", (req, res) =>
    res.json(service.backup(String(req.params.id))),
  );
  app.post("/api/backup/restore", (req, res) =>
    res.status(201).json(service.restoreBackup(req.body)),
  );
  app.get("/api/branches/:id/export", (req, res) => {
    res
      .type("text/plain")
      .send(
        service.exportText(
          String(req.params.id),
          req.query.candidate === "true",
          req.query.full === "true",
        ),
      );
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: "입력 형식을 확인하세요.",
          issues: error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        });
      if (error instanceof AppError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof SyntaxError)
        return res
          .status(400)
          .json({ error: "JSON 형식이 올바르지 않습니다." });
      res.status(500).json({
        error:
          "저장 또는 처리 중 오류가 발생했습니다. 원문은 삭제하지 않았습니다.",
      });
    },
  );
  return app;
}
