import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { Store, id } from "../server/db.ts";
import { NovelService } from "../server/service.ts";
import { Worker } from "../server/jobs.ts";
import { createApp } from "../server/api.ts";
import { outputSchema } from "../shared/domain.ts";
// Fetch normalizes Host; use real HTTP headers to simulate the reverse proxy.
function proxyRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, options, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve(
          new Response(Buffer.concat(chunks).toString(), {
            status: incoming.statusCode,
            headers,
          }),
        );
      });
    });
    request.on("error", reject);
    request.end(options.body);
  });
}
async function setup(accessToken?: string, publicOrigin?: string) {
  const store = new Store(":memory:"),
    service = new NovelService(store),
    worker = new Worker(service, async (_r, _p, _s, delta) => {
      const text = JSON.stringify(
        outputSchema.parse({
          body: "시험용 본문.",
          scene: { date: "2026-10-21", time: "오후", place: "도서관" },
        }),
      );
      delta(text);
      return { text };
    });
  const app = createApp(service, worker, {
    accessToken,
    localOnly: !publicOrigin,
    publicOrigin,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  return {
    store,
    service,
    worker,
    base,
    close: async () => {
      await worker.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
async function session(base: string, password = "") {
  const r = await fetch(base + "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await r.json();
  return {
    r,
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    csrf: data.csrf,
  };
}
function post(
  base: string,
  path: string,
  auth: { cookie: string; csrf: string },
  body: unknown,
) {
  return fetch(base + "/api" + path, {
    method: "POST",
    headers: {
      Cookie: auth.cookie,
      "X-CSRF-Token": auth.csrf,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
test("HTTP: 익명 데이터 조회·CLI 요청 차단", async () => {
  const s = await setup();
  try {
    assert.equal((await fetch(s.base + "/api/projects")).status, 401);
    assert.equal(
      (
        await fetch(s.base + "/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
  } finally {
    await s.close();
  }
});
test("HTTP: 개인망 암호·세션·CSRF·교차 출처 검증", async () => {
  const s = await setup("long-test-password-only");
  try {
    assert.equal((await session(s.base, "틀린암호")).r.status, 401);
    const auth = await session(s.base, "long-test-password-only");
    assert.equal(auth.r.status, 200);
    assert.match(auth.r.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(auth.r.headers.get("set-cookie")!, /SameSite=Strict/);
    const csrf = await post(
      s.base,
      "/projects",
      { ...auth, csrf: "invalid" },
      { title: "불가" },
    );
    assert.equal(csrf.status, 403);
    const origin = await fetch(s.base + "/api/projects", {
      headers: { Cookie: auth.cookie, Origin: "https://unrelated.example" },
    });
    assert.equal(origin.status, 403);
    assert.equal(
      (await post(s.base, "/projects", auth, { title: "허용" })).status,
      201,
    );
  } finally {
    await s.close();
  }
});
test("HTTP: Tailscale HTTPS 프록시에서 암호 로그인·저장·주소 검증", async () => {
  const origin = "https://writing.example.ts.net:8443";
  const host = new URL(origin).host;
  const password = "tailscale-test-password-only";
  const s = await setup(password, origin);
  const headers = {
    Host: host,
    Origin: origin,
    "Content-Type": "application/json",
  };
  try {
    assert.equal(
      (await proxyRequest(s.base + "/api/projects", { headers })).status,
      401,
    );
    assert.equal(
      (
        await proxyRequest(s.base + "/api/session", {
          method: "POST",
          headers,
          body: JSON.stringify({ password: "" }),
        })
      ).status,
      401,
    );
    const login = await proxyRequest(s.base + "/api/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!;
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /HttpOnly/);
    const { csrf } = await login.json();
    const auth = {
      ...headers,
      Cookie: cookie.split(";")[0],
      "X-CSRF-Token": csrf,
    };
    const created = await proxyRequest(s.base + "/api/projects", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ title: "휴대폰 작품" }),
    });
    assert.equal(created.status, 201);
    const projects = await (
      await proxyRequest(s.base + "/api/projects", { headers: auth })
    ).json();
    assert.equal(projects[0].title, "휴대폰 작품");
    const invalidHeaders: Record<string, string>[] = [
      { Origin: "http://" + host },
      {
        Host: "other.example.ts.net:8443",
        Origin: "https://other.example.ts.net:8443",
      },
      {
        Origin: "https://unrelated.example",
        "X-Forwarded-Host": host,
        "X-Forwarded-Proto": "https",
      },
    ];
    for (const changed of invalidHeaders) {
      assert.equal(
        (
          await proxyRequest(s.base + "/api/projects", {
            headers: { ...auth, ...changed },
          })
        ).status,
        403,
      );
    }
  } finally {
    await s.close();
  }
});
test("HTTP: 로컬 모드에서 임의 IPv6 Host를 허용하지 않음", async () => {
  const s = await setup();
  try {
    assert.equal(
      (
        await proxyRequest(s.base + "/api/health", {
          headers: { Host: "[2001:db8::1]:4317" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await proxyRequest(s.base + "/api/health", {
          headers: { Host: "[::1]:4317" },
        })
      ).status,
      200,
    );
  } finally {
    await s.close();
  }
});
test("HTTP: 실제 생성 API·영속 작업·SSE·후보 확정·백업 복원 왕복", async () => {
  const s = await setup();
  try {
    const auth = await session(s.base),
      p = await (
        await post(s.base, "/projects", auth, { title: "API 검증" })
      ).json();
    const job = await (
      await post(s.base, "/jobs", auth, {
        branchId: p.branch.id,
        baseRevision: 0,
        input: "테스트",
        provider: "codex",
        model: "fixture",
        requestKey: id(),
      })
    ).json();
    await s.worker.tick();
    const result = await (
      await fetch(s.base + "/api/jobs/" + job.id, {
        headers: { Cookie: auth.cookie },
      })
    ).json();
    assert.equal(result.status, "completed");
    const stream = await (
      await fetch(s.base + "/api/jobs/" + job.id + "/events", {
        headers: { Cookie: auth.cookie },
      })
    ).text();
    assert.match(stream, /event: delta/);
    assert.match(stream, /event: done/);
    assert.equal(
      (
        await post(
          s.base,
          "/candidates/" + result.candidateId + "/commit",
          auth,
          { baseRevision: 0 },
        )
      ).status,
      200,
    );
    const backup = await (
      await fetch(s.base + "/api/projects/" + p.project.id + "/backup", {
        headers: { Cookie: auth.cookie },
      })
    ).json();
    assert.equal(
      (await post(s.base, "/backup/restore", auth, backup)).status,
      201,
    );
    assert.equal(s.service.projects().length, 2);
  } finally {
    await s.close();
  }
});
test("HTTP: 서버 오류·사용자 입력이 스택이나 비밀을 노출하지 않는다", async () => {
  const s = await setup();
  try {
    const auth = await session(s.base),
      response = await post(s.base, "/projects", auth, { title: "" });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.stack, undefined);
    assert.equal(data.error, "입력 형식을 확인하세요.");
    const invalid = await fetch(s.base + "/api/branches/unknown", {
      headers: { Cookie: auth.cookie },
    });
    assert.equal(invalid.status, 404);
  } finally {
    await s.close();
  }
});
