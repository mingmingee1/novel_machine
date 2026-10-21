import { chromium, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { Store } from "../server/db.ts";
import { NovelService } from "../server/service.ts";
import { Worker } from "../server/jobs.ts";
import { createApp } from "../server/api.ts";
import { outputSchema } from "../shared/domain.ts";

mkdirSync("test-results", { recursive: true });
const store = new Store(":memory:"),
  service = new NovelService(store);
let calls = 0;
const worker = new Worker(service, async (request, _prompt, signal, delta) => {
  calls++;
  const body = Array.from(
    { length: 26 },
    (_, i) =>
      "민서가 " +
      (i + 1) +
      "번째 책장을 넘겼다. 창가에는 오후의 빛이 길게 놓여 있었다. 그는 조금 전 읽은 문장의 끝에 다시 눈을 두었다.",
  ).join("\n\n");
  const output = outputSchema.parse({
    body,
    scene: { date: "2026-10-21", time: "오후", place: "도서관", pov: "민서" },
    memories: [
      {
        kind: "event",
        text: "민서가 도서관에서 책을 읽었다.",
        quote: "민서가 1번째 책장을 넘겼다.",
        entities: ["민서"],
        aliases: ["민서"],
      },
    ],
    choices: ["책을 덮고 창밖을 본다.", "방금 읽은 구절을 적어 둔다."],
  });
  const text =
    request.channel === "story"
      ? JSON.stringify(output)
      : "이 내용은 정본 변경이 아닌 상담 제안입니다.";
  for (let i = 0; i < text.length; i += 180) {
    if (signal.aborted) throw new Error("cancelled");
    delta(text.slice(i, i + 180));
    await new Promise((r) => setTimeout(r, 12));
  }
  return { text, usage: { fixture: true, costEstimate: null } };
});
const app = createApp(service, worker),
  dist = resolve("dist");
app.use(express.static(dist));
app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
worker.start();
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const browser = await chromium.launch({
  executablePath:
    process.env.NOVEL_CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  headless: true,
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
let checks = 0;
const pass = (label: string) => {
  checks++;
  console.log("PASS " + label);
};
async function noOverflow(p: Page, label: string) {
  const overflow = await p.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth + 1 ||
      Array.from(
        document.querySelectorAll<HTMLElement>(".main-scroll,.modal[open]"),
      ).some((el) => el.scrollWidth > el.clientWidth + 2),
  );
  assert.equal(overflow, false, label);
  pass(label);
}
async function nav(label: string) {
  if (await page.getByRole("button", { name: "메뉴 열기" }).isVisible())
    await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("button", { name: label, exact: true }).first().click();
}
try {
  await page.goto(base);
  await page.getByRole("button", { name: "첫 번째 작품 시작하기" }).waitFor();
  await page.screenshot({
    path: "test-results/desktop-welcome.png",
    fullPage: true,
  });
  pass("실제 서버에서 시작 화면 로드");
  await page.getByRole("button", { name: "첫 번째 작품 시작하기" }).click();
  await page.getByLabel("작품 이름").fill("도서관의 오후");
  await page
    .getByLabel("작품 소개 · 선택")
    .fill("모바일 집필과 복원 기능을 검증하는 테스트 작품");
  await page.getByRole("button", { name: "작품 만들기" }).click();
  await page
    .getByRole("heading", { name: "도서관의 오후", exact: true })
    .waitFor();
  pass("UI에서 작품 생성 → SQLite 저장");
  await page
    .getByRole("textbox", { name: "집필 지시" })
    .fill("도서관에서 시작해 줘.");
  await page.getByRole("button", { name: "전송", exact: true }).click();
  await page
    .getByRole("button", { name: "이 장면 확정", exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(calls, 1);
  pass("실제 UI → 작업 큐 → 모의 Provider → 후보");
  await page.getByRole("button", { name: "이 장면 확정", exact: true }).click();
  await page.getByText("확정 본문 · v1", { exact: true }).waitFor();
  assert.equal(service.projects().length, 1);
  assert.equal(store.list("memory").length, 1);
  pass("UI 확정 시 본문·기억 원자 반영");
  await page.getByRole("button", { name: "읽기 설정", exact: true }).click();
  const slider = page.getByLabel("본문 크기 · 16px");
  await slider.fill("19");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.reload();
  await page.getByText("확정 본문 · v1", { exact: true }).waitFor();
  const font = await page
    .locator(".story-prose")
    .evaluate((el) => getComputedStyle(el).fontSize);
  assert.equal(font, "19px");
  pass("읽기 설정 기기별 보존 및 재접속 후보 복구");
  await page.getByRole("textbox", { name: "집필 지시" }).fill("IME 조합 검증");
  await page
    .getByRole("textbox", { name: "집필 지시" })
    .dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      ctrlKey: true,
      isComposing: true,
      keyCode: 229,
    });
  await page.waitForTimeout(200);
  assert.equal(calls, 1);
  pass("한글 IME 조합 Enter가 전송되지 않음");
  await page.getByRole("textbox", { name: "집필 지시" }).fill("다음 장면");
  await page.getByRole("button", { name: "전송", exact: true }).click();
  await page.locator(".main-scroll").evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await page
    .getByRole("button", { name: "이 장면 확정", exact: true })
    .waitFor({ timeout: 15000 });
  const scroll = await page
    .locator(".main-scroll")
    .evaluate((el) => el.scrollTop);
  assert.ok(scroll < 200);
  pass("과거 읽기 중 스트리밍이 스크롤을 빼앗지 않음");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.locator(".main-scroll").evaluate((el) => {
    el.scrollTop = 150;
  });
  await noOverflow(page, "390px 모바일 본문 리플로우");
  await page.screenshot({ path: "test-results/mobile-reading.png" });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page, "320 CSS px 리플로우");
  const inputSize = await page
    .getByRole("textbox", { name: "집필 지시" })
    .evaluate((el) => getComputedStyle(el).fontSize);
  assert.equal(inputSize, "16px");
  pass("본문 설정과 16px 입력창 크기 분리");
  await page.setViewportSize({ width: 390, height: 400 });
  await page.getByRole("textbox", { name: "집필 지시" }).focus();
  const box = await page
    .getByRole("textbox", { name: "집필 지시" })
    .boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= 400);
  pass("모바일 키보드 높이 축소 시 입력창 표시 (viewport 모사)");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  await noOverflow(page, "200% 글자 확대 별도 검증");
  await page.screenshot({ path: "test-results/text-200-percent.png" });
  await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  await nav("문체 자료실");
  await page.getByLabel("제목", { exact: true }).fill("참고 문체");
  await page
    .getByLabel("원문", { exact: true })
    .fill("짧게 말했다.\n\n민서: 잠깐.\n그 말 뒤로 조용한 침묵이 놓였다.");
  await page.getByRole("button", { name: "원문 등록", exact: true }).click();
  await page.getByRole("button", { name: /참고 문체/ }).click();
  const original = page.getByRole("textbox", { name: "원문 구간 선택" });
  await original.click();
  await original.press("ControlOrMeta+A");
  await page
    .getByRole("button", { name: "선택 구간 저장", exact: true })
    .click();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  assert.equal(store.list("excerpt").length, 1);
  pass("문체 원문 업로드·구간 선택·예문 저장 실제 연결");
  await page.getByRole("button", { name: "문체 프로필", exact: true }).click();
  await page.getByLabel("프로필 이름").fill("짧은 호흡");
  await page
    .getByLabel("규칙 · 한 줄에 하나")
    .fill(
      "dialogue | 짧은 대사 뒤 행동 | 대화 장면 | 모든 줄에 반복하지 않는다",
    );
  await page.getByRole("checkbox", { name: /좋아요/ }).check();
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  assert.equal(store.list("profile").length, 1);
  pass("근거 예문을 가진 프로필 생성");
  await nav("가져오기 · 백업");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "백업 저장", exact: true }).click();
  const downloaded = await downloadEvent;
  const backupPath = "test-results/ui-backup.json";
  await downloaded.saveAs(backupPath);
  await page
    .locator('input[type=file][accept=".json"]')
    .setInputFiles(backupPath);
  await page
    .getByRole("heading", { name: "도서관의 오후 (복원)", exact: true })
    .waitFor();
  assert.equal(service.projects().length, 2);
  pass("UI 백업 다운로드 → 파일 선택 → 새 작품 복원");
  await page
    .getByRole("textbox", { name: "집필 지시" })
    .fill("오프라인에도 남는 초안");
  await context.setOffline(true);
  await page.waitForTimeout(100);
  await page.reload();
  await page
    .getByText("오프라인 · 읽기·초안", { exact: true })
    .waitFor({ timeout: 15000 });
  await expect(page.getByRole("textbox", { name: "집필 지시" })).toHaveValue(
    "오프라인에도 남는 초안",
  );
  assert.equal(calls, 2);
  pass("서비스 워커 오프라인 읽기·초안 복구·자동 전송 없음");
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  pass("브라우저 런타임 오류 없음");
  console.log(
    JSON.stringify({
      browser: "Chromium",
      checks,
      passed: checks,
      failed: 0,
      actualModelCalls: 0,
    }),
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/browser-failure.png",
    fullPage: true,
  });
  console.error("Browser errors:", errors);
  console.error(
    "Job status:",
    store
      .list<{ status: string; error?: string }>("job")
      .map((j) => ({ status: j.status, error: j.error })),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
  await worker.stop();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
}
