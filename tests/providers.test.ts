import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAPI, runCLI } from "../server/providers.ts";
import { requestSchema } from "../shared/domain.ts";
const req = (provider: "openai" | "gemini" | "codex" | "gemini-cli") =>
  requestSchema.parse({
    branchId: "test-branch",
    baseRevision: 0,
    input: "요청",
    provider,
    model: "fixture-model",
    requestKey: "fixture-key-123",
  });
test("OpenAI Responses adapter: 실제 요청 형태·스트림·사용량 분리", async (t) => {
  const old = process.env.NOVEL_OPENAI_API_KEY;
  process.env.NOVEL_OPENAI_API_KEY = "fixture-only-not-a-key";
  try {
    let captured: Record<string, unknown> = {};
    t.mock.method(
      globalThis,
      "fetch",
      async (url: unknown, options: RequestInit) => {
        captured = { url, body: JSON.parse(String(options.body)) };
        return new Response(
          'data: {"type":"response.output_text.delta","delta":"{\\"ok\\":true}"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":4}}}\n\n',
        );
      },
    );
    const parts: string[] = [];
    const result = await runAPI(
      req("openai"),
      "JSON fixture prompt",
      new AbortController().signal,
      (t) => parts.push(t),
    );
    assert.equal(captured.url, "https://api.openai.com/v1/responses");
    assert.equal((captured.body as Record<string, unknown>).store, false);
    assert.equal(result.text, '{"ok":true}');
    assert.equal(parts.join(""), result.text);
    assert.equal(result.usage?.input_tokens, 3);
    assert.equal(result.usage?.costEstimate, null);
  } finally {
    if (old === undefined) delete process.env.NOVEL_OPENAI_API_KEY;
    else process.env.NOVEL_OPENAI_API_KEY = old;
  }
});
test("Gemini API adapter: SSE 본문·finishReason·키의 URL 제외", async (t) => {
  const old = process.env.NOVEL_GEMINI_API_KEY;
  process.env.NOVEL_GEMINI_API_KEY = "fixture-only-not-a-key";
  try {
    t.mock.method(
      globalThis,
      "fetch",
      async (url: unknown, options: RequestInit) => {
        assert.ok(String(url).endsWith(":streamGenerateContent?alt=sse"));
        assert.ok(!String(url).includes("fixture-only"));
        assert.equal(
          (options.headers as Record<string, string>)["x-goog-api-key"],
          "fixture-only-not-a-key",
        );
        return new Response(
          'data: {"candidates":[{"content":{"parts":[{"text":"본문"}]},"finishReason":"STOP"}],"usageMetadata":{"totalTokenCount":8}}\n\n',
        );
      },
    );
    const result = await runAPI(
      req("gemini"),
      "fixture",
      new AbortController().signal,
      () => {},
    );
    assert.equal(result.text, "본문");
    assert.equal(result.usage?.totalTokenCount, 8);
  } finally {
    if (old === undefined) delete process.env.NOVEL_GEMINI_API_KEY;
    else process.env.NOVEL_GEMINI_API_KEY = old;
  }
});
test("API 한도·인증·미완료 응답의 실패 유형 보존", async (t) => {
  const old = process.env.NOVEL_OPENAI_API_KEY;
  process.env.NOVEL_OPENAI_API_KEY = "fixture-only";
  try {
    let status = 429;
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          status === 200
            ? 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
            : "error",
          { status },
        ),
    );
    await assert.rejects(
      () =>
        runAPI(req("openai"), "JSON", new AbortController().signal, () => {}),
      { kind: "quota" },
    );
    status = 401;
    await assert.rejects(
      () =>
        runAPI(req("openai"), "JSON", new AbortController().signal, () => {}),
      { kind: "auth" },
    );
    status = 200;
    await assert.rejects(
      () =>
        runAPI(req("openai"), "JSON", new AbortController().signal, () => {}),
      { kind: "protocol" },
    );
  } finally {
    if (old === undefined) delete process.env.NOVEL_OPENAI_API_KEY;
    else process.env.NOVEL_OPENAI_API_KEY = old;
  }
});
test("CLI adapter: 사용자 입력은 셸 보간 없이 stdin, 로그와 최종 본문 분리", async () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-cli-test-")),
    script = join(dir, "fake.js"),
    capture = join(dir, "stdin.txt"),
    sentinel = join(dir, "must-not-exist");
  const old = process.env.NOVEL_CODEX_PATH;
  writeFileSync(
    script,
    'const fs=require("node:fs");let input="";process.stdin.on("data",x=>input+=x);process.stdin.on("end",()=>{fs.writeFileSync(' +
      JSON.stringify(capture) +
      ',input);console.error("progress log");console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"최종 본문"}}));console.log(JSON.stringify({type:"turn.completed",usage:{output_tokens:4}}));});',
  );
  process.env.NOVEL_CODEX_PATH = script;
  try {
    const payload = "$(touch " + sentinel + ") ; `echo injected`";
    const result = await runCLI(
      req("codex"),
      payload,
      new AbortController().signal,
      () => {},
    );
    assert.equal(readFileSync(capture, "utf8"), payload);
    assert.equal(existsSync(sentinel), false);
    assert.equal(result.text, "최종 본문");
    assert.equal(result.usage?.modelCallCount, null);
  } finally {
    if (old === undefined) delete process.env.NOVEL_CODEX_PATH;
    else process.env.NOVEL_CODEX_PATH = old;
    rmSync(dir, { recursive: true });
  }
});
test("Gemini CLI adapter: assistant chunks와 완료 상태 해석", async () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-cli-test-")),
    script = join(dir, "fake.js"),
    old = process.env.NOVEL_GEMINI_PATH;
  writeFileSync(
    script,
    'process.stdin.resume();process.stdin.on("end",()=>{console.log(JSON.stringify({type:"message",role:"assistant",content:"모의 본문"}));console.log(JSON.stringify({type:"result",status:"success",stats:{total_tokens:7}}));});',
  );
  process.env.NOVEL_GEMINI_PATH = script;
  try {
    const result = await runCLI(
      req("gemini-cli"),
      "fixture",
      new AbortController().signal,
      () => {},
    );
    assert.equal(result.text, "모의 본문");
    assert.equal(result.usage?.total_tokens, 7);
  } finally {
    if (old === undefined) delete process.env.NOVEL_GEMINI_PATH;
    else process.env.NOVEL_GEMINI_PATH = old;
    rmSync(dir, { recursive: true });
  }
});
