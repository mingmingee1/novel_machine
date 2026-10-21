const loopback = new Set(["127.0.0.1", "localhost", "::1"]);

export function networkConfig(env: NodeJS.ProcessEnv) {
  const host = env.NOVEL_HOST || "127.0.0.1";
  const port = Number(env.NOVEL_PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("NOVEL_PORT에는 1~65535 사이의 포트 번호를 입력하세요.");
  let publicOrigin: string | undefined;
  if (env.NOVEL_PUBLIC_ORIGIN) {
    const url = new URL(env.NOVEL_PUBLIC_ORIGIN);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !loopback.has(host)
    )
      throw new Error(
        "NOVEL_PUBLIC_ORIGIN은 HTTPS 주소여야 하며 서버는 루프백 주소에서 실행해야 합니다.",
      );
    publicOrigin = url.origin;
  }
  const localOnly = loopback.has(host) && !publicOrigin;
  const accessToken = env.NOVEL_ACCESS_TOKEN;
  if (!localOnly && (!accessToken || accessToken.length < 20))
    throw new Error(
      "개인망 접근에는 20자 이상의 NOVEL_ACCESS_TOKEN이 필요합니다.",
    );
  return { host, port, localOnly, publicOrigin, accessToken };
}
