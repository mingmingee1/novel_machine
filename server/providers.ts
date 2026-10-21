import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { setGlobalProxyFromEnv } from "node:http";
import type { GenerateRequest } from "../shared/domain.ts";
export class ProviderError extends Error {
  constructor(
    public kind:
      | "auth"
      | "quota"
      | "network"
      | "refusal"
      | "protocol"
      | "unavailable"
      | "cancelled",
    message: string,
  ) {
    super(message);
  }
}
export type ProviderResult = { text: string; usage?: Record<string, unknown> };
export type ProviderRunner = (
  request: GenerateRequest,
  prompt: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
) => Promise<ProviderResult>;
const safeError = (status: number) =>
  new ProviderError(
    status === 401 || status === 403
      ? "auth"
      : status === 429
        ? "quota"
        : "network",
    status === 401 || status === 403
      ? "연결 인증 또는 접근 권한을 확인하세요."
      : status === 429
        ? "요청 한도 또는 할당량에 도달했습니다."
        : "모델 서버 요청이 실패했습니다. HTTP " + status,
  );

export async function* sse(response: Response): AsyncGenerator<unknown> {
  if (!response.body)
    throw new ProviderError("protocol", "빈 스트림 응답입니다.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") yield JSON.parse(data);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
export const runAPI: ProviderRunner = async (
  request,
  prompt,
  signal,
  onDelta,
) => {
  // Node 24's supported proxy route preserves platform-injected HTTPS authentication.
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
    setGlobalProxyFromEnv();
  const openai = request.provider === "openai";
  const key = openai
    ? process.env.NOVEL_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    : process.env.NOVEL_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;
  if (!key)
    throw new ProviderError(
      "auth",
      openai
        ? "서버에 OpenAI API 키가 없습니다."
        : "서버에 Gemini API 키가 없습니다.",
    );
  const endpoint = openai
    ? "https://api.openai.com/v1/responses"
    : "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(request.model) +
      ":streamGenerateContent?alt=sse";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (openai) headers.Authorization = "Bearer " + key;
  else headers["x-goog-api-key"] = key;
  const structured = request.channel === "story" || request.mode === "analyze";
  const body = openai
    ? {
        model: request.model,
        input: prompt,
        stream: true,
        store: false,
        ...(structured ? { text: { format: { type: "json_object" } } } : {}),
      }
    : {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: structured
          ? { responseMimeType: "application/json" }
          : {},
      };
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal.aborted)
      throw new ProviderError("cancelled", "사용자가 중단했습니다.");
    throw new ProviderError(
      "network",
      "모델 서버에 연결할 수 없습니다. 네트워크와 허용 도메인을 확인하세요.",
    );
  }
  if (!response.ok) throw safeError(response.status);
  let text = "",
    usage: Record<string, unknown> | undefined,
    complete = false;
  for await (const raw of sse(response)) {
    const event = raw as Record<string, any>;
    if (openai) {
      if (event.type === "response.output_text.delta") {
        text += event.delta;
        onDelta(event.delta);
      }
      if (
        event.type === "response.refusal.delta" ||
        event.type === "response.refusal.done"
      )
        throw new ProviderError(
          "refusal",
          "모델이 이 요청에 응답하지 않았습니다. 원문과 요청은 보존했습니다.",
        );
      if (event.type === "response.failed" || event.type === "error")
        throw new ProviderError("protocol", "모델의 생성 작업이 실패했습니다.");
      if (event.type === "response.incomplete")
        throw new ProviderError(
          "protocol",
          "모델 출력이 완료되지 않았습니다. 부분 출력은 보존했습니다.",
        );
      if (event.type === "response.completed") {
        complete = true;
        usage = event.response?.usage;
      }
    } else {
      if (event.error)
        throw new ProviderError("protocol", "Gemini 생성 작업이 실패했습니다.");
      if (event.promptFeedback?.blockReason)
        throw new ProviderError(
          "refusal",
          "Gemini가 요청을 처리하지 않았습니다.",
        );
      for (const candidate of event.candidates ?? []) {
        for (const part of candidate.content?.parts ?? [])
          if (part.text && !part.thought) {
            text += part.text;
            onDelta(part.text);
          }
        if (candidate.finishReason === "STOP") complete = true;
        else if (candidate.finishReason)
          throw new ProviderError(
            candidate.finishReason === "SAFETY" ? "refusal" : "protocol",
            "Gemini 출력이 정상 완료되지 않았습니다: " + candidate.finishReason,
          );
      }
      if (event.usageMetadata) usage = event.usageMetadata;
    }
  }
  if (!complete || !text.trim())
    throw new ProviderError(
      "protocol",
      "완료 이벤트가 없는 응답입니다. 부분 출력은 보존했습니다.",
    );
  return {
    text,
    usage: {
      ...usage,
      costEstimate: null,
      costNote: "연결별 요금표와 청구 내역에서 확인하세요.",
    },
  };
};
function spawnCommand(
  executable: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) {
  return executable.endsWith(".js")
    ? spawn(process.execPath, [executable, ...args], options)
    : spawn(executable, args, options);
}
export function killProcess(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32")
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
    });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
export async function diagnostic(command: string, args: string[]) {
  return new Promise<{ installed: boolean; ok: boolean; output: string }>(
    (resolveResult) => {
      const child = spawnCommand(command, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      let text = "";
      const timeout = setTimeout(() => killProcess(child), 8000);
      child.stdout?.on("data", (data) => {
        text += String(data).slice(0, 4000);
      });
      child.on("error", () => {
        clearTimeout(timeout);
        resolveResult({ installed: false, ok: false, output: "" });
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveResult({
          installed: true,
          ok: code === 0,
          output: text.slice(0, 4000).trim(),
        });
      });
    },
  );
}
export async function providerStatus() {
  const codex = process.env.NOVEL_CODEX_PATH || "codex",
    gemini = process.env.NOVEL_GEMINI_PATH || "gemini";
  const [cv, ca, gv] = await Promise.all([
    diagnostic(codex, ["--version"]),
    diagnostic(codex, ["login", "status"]),
    diagnostic(gemini, ["--version"]),
  ]);
  return [
    {
      id: "codex",
      name: "Codex CLI",
      installed: cv.ok,
      authenticated: ca.ok,
      version: cv.output,
      status: !cv.ok
        ? "미설치"
        : ca.ok
          ? "로그인 확인 · 생성은 별도 검증"
          : "로그인 필요",
      billing: "Codex 로그인 계정의 이용 정책",
      limitation:
        "읽기 전용 샌드박스와 도구 비활성화. 별도 실행 폴더를 사용하며 새 세션으로 시작합니다.",
    },
    {
      id: "gemini-cli",
      name: "Gemini CLI",
      installed: gv.ok,
      authenticated: null,
      version: gv.output,
      status: gv.ok ? "설치 확인 · 인증은 실제 요청에서 확인" : "미설치",
      billing: "Gemini CLI 로그인 또는 설정된 키의 이용 정책",
      limitation:
        "앱의 deny-all 도구 정책과 빈 MCP/확장 목록 사용. CLI 인증·샌드박스 지원은 PC 환경에 따라 확인해야 합니다.",
    },
    {
      id: "openai",
      name: "OpenAI API",
      installed: true,
      authenticated: null,
      configured: !!(
        process.env.NOVEL_OPENAI_API_KEY || process.env.OPENAI_API_KEY
      ),
      status:
        process.env.NOVEL_OPENAI_API_KEY || process.env.OPENAI_API_KEY
          ? "키 설정됨 · 실연동 미검증"
          : "API 키 필요",
      billing: "OpenAI API 사용량 과금",
    },
    {
      id: "gemini",
      name: "Gemini API",
      installed: true,
      authenticated: null,
      configured: !!(
        process.env.NOVEL_GEMINI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY
      ),
      status:
        process.env.NOVEL_GEMINI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY
          ? "키 설정됨 · 실연동 미검증"
          : "API 키 필요",
      billing: "Google AI API 계정의 할당량·과금",
    },
  ];
}
export const runCLI: ProviderRunner = async (
  request,
  prompt,
  signal,
  onDelta,
) => {
  const isCodex = request.provider === "codex";
  const root = await mkdtemp(join(tmpdir(), "novel-provider-"));
  const command = isCodex
    ? process.env.NOVEL_CODEX_PATH || "codex"
    : process.env.NOVEL_GEMINI_PATH || "gemini";
  const args = isCodex
    ? [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "--color",
        "never",
        "-c",
        'approval_policy="never"',
        "-c",
        'web_search="disabled"',
        "-c",
        "mcp_servers={}",
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.apps=false",
        "-c",
        "features.multi_agent=false",
        "-c",
        "features.multi_agent_v2=false",
        "-c",
        "features.memories=false",
        "-c",
        "features.hooks=false",
        "-c",
        "features.codex_hooks=false",
        "-C",
        root,
        ...(request.model === "default" ? [] : ["-m", request.model]),
        "-",
      ]
    : [
        "--prompt",
        "Respond only to the input provided on stdin. Do not use any tools.",
        "--output-format",
        "stream-json",
        "--model",
        request.model,
        "--extensions",
        "none",
        "--allowed-mcp-server-names",
        "__novel_none__",
        "--admin-policy",
        join(root, "deny-tools.toml"),
      ];
  if (!isCodex) {
    await writeFile(
      join(root, "deny-tools.toml"),
      '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n',
    );
    await mkdir(join(root, ".gemini"), { recursive: true });
    await writeFile(
      join(root, ".gemini", "settings.json"),
      JSON.stringify({
        mcpServers: {},
        hooksConfig: { enabled: false },
        tools: { exclude: ["*"] },
        security: { enablePermanentToolApproval: false },
      }),
    );
  }
  return new Promise<ProviderResult>((resolveResult, reject) => {
    const child = spawnCommand(command, args, {
      cwd: root,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env, NO_COLOR: "1" },
    });
    let text = "",
      buffer = "",
      usage: Record<string, unknown> | undefined,
      completed = false,
      settled = false,
      stderr = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else
        resolveResult({
          text,
          usage: {
            ...usage,
            costEstimate: null,
            cliInvocationCount: 1,
            modelCallCount: null,
          },
        });
    };
    const abort = () => {
      killProcess(child);
      finish(new ProviderError("cancelled", "사용자가 중단했습니다."));
    };
    const timeout = setTimeout(() => {
      killProcess(child);
      finish(
        new ProviderError(
          "network",
          "생성이 10분 안에 완료되지 않았습니다. 부분 출력은 보존했습니다.",
        ),
      );
    }, 600000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.on("error", () =>
      finish(
        new ProviderError(
          "unavailable",
          "CLI를 실행할 수 없습니다. 설치와 실행 파일 경로를 확인하세요.",
        ),
      ),
    );
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-12000);
    });
    const line = (raw: string) => {
      if (!raw.trim()) return;
      let event: Record<string, any>;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      if (isCodex) {
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message"
        ) {
          const delta = event.item.text ?? "";
          text += delta;
          onDelta(delta);
        }
        if (event.type === "turn.completed") {
          completed = true;
          usage = event.usage;
        }
        if (event.type === "turn.failed" || event.type === "error") {
          killProcess(child);
          finish(
            new ProviderError(
              "protocol",
              "Codex 작업이 실패했습니다. CLI 로그인·모델 지원 상태를 확인하세요.",
            ),
          );
        }
        if (
          event.item &&
          ["command_execution", "mcp_tool_call", "web_search"].includes(
            event.item.type,
          )
        ) {
          killProcess(child);
          finish(
            new ProviderError(
              "protocol",
              "생성 중 도구 사용 요청을 차단했습니다.",
            ),
          );
        }
      } else {
        if (
          event.type === "message" &&
          event.role === "assistant" &&
          event.content
        ) {
          text += event.content;
          onDelta(event.content);
        }
        if (event.type === "result") {
          completed = event.status === "success";
          usage = event.stats;
          if (event.status === "error")
            finish(
              new ProviderError("protocol", "Gemini CLI 작업이 실패했습니다."),
            );
        }
        if (event.type === "tool_use") {
          killProcess(child);
          finish(
            new ProviderError(
              "protocol",
              "생성 중 도구 사용 요청을 차단했습니다.",
            ),
          );
        }
      }
    };
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
      if (text.length > 1_000_000) {
        killProcess(child);
        finish(new ProviderError("protocol", "출력 제한을 초과했습니다."));
      }
    });
    child.on("close", (code) => {
      line(buffer);
      if (settled) return;
      if (code !== 0 || !completed || !text.trim()) {
        const readonly = /read-only file system|EACCES|permission denied/i.test(
          stderr,
        );
        const auth = /auth|login|credential|api.key|unauthorized/i.test(stderr);
        finish(
          new ProviderError(
            readonly ? "unavailable" : auth ? "auth" : "protocol",
            readonly
              ? "CLI 실행 디렉터리가 읽기 전용이라 초기화하지 못했습니다. 쓰기 가능한 개인 PC의 CLI 환경에서 실행하세요. 로그인 여부와는 별도 문제입니다."
              : auth
                ? "CLI 인증을 완료한 뒤 다시 시도하세요."
                : "CLI가 정상 완료되지 않았습니다. 설치된 버전·모델·정책 지원을 확인하세요.",
          ),
        );
      } else finish();
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(prompt);
  });
};
export const runProvider: ProviderRunner = (
  request,
  prompt,
  signal,
  onDelta,
) =>
  request.provider === "codex" || request.provider === "gemini-cli"
    ? runCLI(request, prompt, signal, onDelta)
    : runAPI(request, prompt, signal, onDelta);
