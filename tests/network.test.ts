import test from "node:test";
import assert from "node:assert/strict";
import { networkConfig } from "../server/network.ts";

test("Tailscale 공개 주소를 설정하면 루프백에서도 앱 암호가 필수", () => {
  const env = { NOVEL_PUBLIC_ORIGIN: "https://writer.example.ts.net:8443/" };
  assert.throws(() => networkConfig(env), /20자/);
  assert.throws(
    () => networkConfig({ ...env, NOVEL_ACCESS_TOKEN: "short" }),
    /20자/,
  );
  const config = networkConfig({
    ...env,
    NOVEL_ACCESS_TOKEN: "test-password-long-enough",
  });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.localOnly, false);
  assert.equal(config.publicOrigin, "https://writer.example.ts.net:8443");
});

test("HTTPS 프록시 설정 오류와 외부 수신 암호 누락을 시작 전에 차단", () => {
  const base = { NOVEL_ACCESS_TOKEN: "test-password-long-enough" };
  for (const value of [
    "http://writer.example.ts.net",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com/?key=value",
    "https://example.com/#fragment",
  ])
    assert.throws(() => networkConfig({ ...base, NOVEL_PUBLIC_ORIGIN: value }));
  assert.throws(() =>
    networkConfig({
      ...base,
      NOVEL_PUBLIC_ORIGIN: "https://writer.example.ts.net",
      NOVEL_HOST: "0.0.0.0",
    }),
  );
  assert.throws(() => networkConfig({ NOVEL_HOST: "0.0.0.0" }), /20자/);
  assert.equal(networkConfig({}).localOnly, true);
});
