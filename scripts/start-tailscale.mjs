import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const [major, minor] = process.versions.node.split(".").map(Number);
const windows = process.platform === "win32";
const port = 4317;
const httpsPort = 8443;
const target = `http://127.0.0.1:${port}`;
let server;

function npm(args, capture = false) {
  // Only constant npm commands are passed through the Windows npm.cmd wrapper.
  const command = windows ? process.env.ComSpec || "cmd.exe" : "npm";
  const argv = windows ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;
  return execFileSync(command, argv, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
  });
}

function tailscaleExecutable() {
  const candidates = ["tailscale"];
  if (windows)
    candidates.push(
      join(
        process.env.ProgramFiles || "C:\\Program Files",
        "Tailscale",
        "tailscale.exe",
      ),
    );
  if (process.platform === "darwin")
    candidates.push(
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      "/opt/homebrew/bin/tailscale",
    );
  for (const command of candidates) {
    try {
      execFileSync(command, ["version"], {
        stdio: "ignore",
        timeout: 5000,
        windowsHide: true,
      });
      return command;
    } catch {}
  }
  throw new Error(
    "이 PC에 Tailscale을 설치하고 휴대폰과 같은 계정으로 로그인하세요. https://tailscale.com/download",
  );
}

async function freePort() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          "4317 포트가 사용 중입니다. 이미 실행한 여백 창을 종료한 뒤 다시 실행하세요.",
        ),
      ),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

async function main() {
  if (major < 24 || (major === 24 && minor < 19))
    throw new Error(
      "Node.js 24.19 이상을 먼저 설치하세요. https://nodejs.org/",
    );
  if (process.argv.includes("--help")) {
    console.log(
      "PC와 휴대폰의 Tailscale 로그인 후 실행하세요. HTTPS 8443번으로 앱을 연결하고 휴대폰 주소와 접속 암호를 표시합니다.",
    );
    return;
  }
  const tailscale = tailscaleExecutable();
  const status = JSON.parse(
    execFileSync(tailscale, ["status", "--json"], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    }),
  );
  if (status.BackendState !== "Running")
    throw new Error("이 PC의 Tailscale을 켜고 로그인한 뒤 다시 실행하세요.");
  const dns = status.Self?.DNSName?.replace(/\.$/, "");
  if (!dns || !/^[a-z0-9.-]+\.ts\.net$/i.test(dns))
    throw new Error(
      "Tailscale 기기 주소를 찾지 못했습니다. Tailscale 관리 화면에서 MagicDNS를 켜세요.",
    );
  const host = `${dns}:${httpsPort}`;
  const origin = `https://${host}`;
  const existing = JSON.parse(
    execFileSync(tailscale, ["serve", "status", "--json"], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    }) || "{}",
  );
  if (
    Object.entries(existing.AllowFunnel || {}).some(
      ([key, value]) => key.endsWith(`:${httpsPort}`) && value,
    )
  )
    throw new Error(
      "8443 포트에 Tailscale Funnel이 켜져 있습니다. 이 앱은 개인망용이므로 해당 Funnel을 끈 뒤 다시 실행하세요.",
    );
  const routes = Object.entries(existing.Web || {}).filter(([key]) =>
    key.endsWith(`:${httpsPort}`),
  );
  const ourRoute =
    routes.length === 1 &&
    routes[0][0] === host &&
    Object.keys(routes[0][1].Handlers || {}).length === 1 &&
    routes[0][1].Handlers["/"]?.Proxy === target &&
    existing.TCP?.[httpsPort]?.HTTPS === true;
  if ((routes.length || existing.TCP?.[httpsPort]) && !ourRoute)
    throw new Error(
      "Tailscale 8443 포트를 다른 서비스가 사용 중입니다. 기존 설정은 변경하지 않았습니다.",
    );
  await freePort();
  const fingerprint = createHash("sha256")
    .update(readFileSync("package-lock.json"))
    .digest("hex");
  const stamp = ".cache/tailscale-install.sha256";
  if (
    !existsSync("node_modules/tsx") ||
    !existsSync(stamp) ||
    readFileSync(stamp, "utf8") !== fingerprint
  ) {
    console.log("처음 실행에 필요한 패키지를 설치합니다.");
    npm(["ci"]);
    mkdirSync(".cache", { recursive: true });
    writeFileSync(stamp, fingerprint);
  }
  const { parse } = await import("dotenv");
  const env = {
    ...(existsSync(".env") ? parse(readFileSync(".env")) : {}),
    ...process.env,
  };
  const secretFile = ".env.tailscale.local";
  if (!env.NOVEL_ACCESS_TOKEN) {
    if (!existsSync(secretFile))
      writeFileSync(
        secretFile,
        `NOVEL_ACCESS_TOKEN=${randomBytes(24).toString("base64url")}\n`,
        { mode: 0o600, flag: "wx" },
      );
    env.NOVEL_ACCESS_TOKEN = parse(readFileSync(secretFile)).NOVEL_ACCESS_TOKEN;
  }
  if (!env.NOVEL_ACCESS_TOKEN || env.NOVEL_ACCESS_TOKEN.length < 20)
    throw new Error(
      "접속 암호는 20자 이상이어야 합니다. .env의 NOVEL_ACCESS_TOKEN을 확인하세요.",
    );
  Object.assign(env, {
    NOVEL_HOST: "127.0.0.1",
    NOVEL_PORT: String(port),
    NOVEL_PUBLIC_ORIGIN: origin,
  });
  // Resolve npm JS entry points so Windows does not need to spawn a .cmd shell wrapper.
  try {
    const globalRoot = npm(["root", "-g"], true).trim();
    for (const [variable, name, bin] of [
      ["NOVEL_CODEX_PATH", "@openai/codex", "codex"],
      ["NOVEL_GEMINI_PATH", "@google/gemini-cli", "gemini"],
    ]) {
      if (env[variable]) continue;
      const manifestPath = join(globalRoot, name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const entry =
        typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[bin];
      if (entry && existsSync(join(globalRoot, name, entry)))
        env[variable] = join(globalRoot, name, entry);
    }
  } catch {}
  console.log("앱 화면을 준비합니다.");
  npm(["run", "build"]);
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  let stopped = false;
  server.once("exit", (code) => {
    stopped = true;
    if (!process.exitCode) process.exitCode = code || 0;
  });
  server.once("error", () => {
    stopped = true;
    process.exitCode = 1;
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (stopped)
      throw new Error("서버가 시작되지 않았습니다. 위 오류를 확인하세요.");
    try {
      const response = await fetch(`${target}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).service === "novel-machine") {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("서버 응답을 확인하지 못했습니다.");
  if (!ourRoute) {
    console.log(
      "Tailscale HTTPS 접속을 설정합니다. HTTPS 활성화 안내가 나오면 표시된 Tailscale 관리 주소에서 활성화한 뒤 다시 실행하세요.",
    );
    execFileSync(tailscale, ["serve", "--bg", `--https=${httpsPort}`, target], {
      stdio: "inherit",
      timeout: 30000,
      windowsHide: true,
    });
  }
  console.log(
    `\n휴대폰 Tailscale을 켜고 브라우저에서 여세요:\n${origin}\n\n앱 접속 암호: ${env.NOVEL_ACCESS_TOKEN}\n\n이 창과 PC를 켜 두세요. 종료: Ctrl+C.\n소설 생성 연결은 앱의 ‘연결 설정’에서 확인하세요.\n`,
  );
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (server && server.exitCode === null) server.kill("SIGTERM");
  });
main().catch((error) => {
  console.error(`\n시작하지 못했습니다: ${error.message}`);
  if (server && server.exitCode === null) server.kill("SIGTERM");
  process.exitCode = 1;
});
