import type {
  Candidate,
  Check,
  Context,
  GenerateRequest,
  StoryOutput,
} from "../shared/domain.ts";
import { outputSchema } from "../shared/domain.ts";
export function parseJSON(text: string) {
  return JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
}
export function parseOutput(text: string) {
  return outputSchema.parse(parseJSON(text));
}
export function validateOutput(
  output: StoryOutput,
  context: Context,
  request?: GenerateRequest,
  previous?: Candidate,
): Check[] {
  const checks: Check[] = [...output.checks];
  for (const m of output.memories) {
    if (!output.body.includes(m.quote))
      checks.push({
        level: "hard",
        message: "기억의 근거 구절이 현재 본문에 없습니다.",
        quote: m.quote,
      });
    if (m.branchId && m.branchId !== context.branchId)
      checks.push({ level: "hard", message: "다른 분기의 기억 참조입니다." });
    if (m.sourceCandidateId)
      checks.push({
        level: "hard",
        message: "생성 연결은 기억의 원본 ID를 지정할 수 없습니다.",
      });
    if (
      m.supersedesId &&
      !context.memories.some((previous) => previous.id === m.supersedesId)
    )
      checks.push({
        level: "hard",
        message: "현재 컨텍스트에 없는 기억을 갱신하려고 했습니다.",
      });
    if (
      m.eventDate &&
      output.scene.date &&
      m.eventDate > output.scene.date &&
      m.status === "occurred"
    )
      checks.push({
        level: "hard",
        message: "미래 사건을 이미 발생한 사실로 기록했습니다.",
      });
    if (
      m.learnedDate &&
      output.scene.date &&
      m.learnedDate > output.scene.date &&
      m.knownBy.length
    )
      checks.push({
        level: "hard",
        message: "미래에 알게 될 지식을 현재 인물에 반영했습니다.",
      });
    if ((m.kind === "knowledge" || m.kind === "belief") && !m.knownBy.length)
      checks.push({ level: "hard", message: "지식·믿음의 주체가 없습니다." });
    if (
      m.kind === "relationship" ||
      m.kind === "inference" ||
      m.kind === "author"
    )
      checks.push({
        level: "semantic",
        message: "관계·해석·작가 설정 변경안은 근거를 확인한 뒤 채택하세요.",
        quote: m.quote,
      });
    if (m.kind === "speech" && m.certainty === "explicit")
      m.certainty = "reported";
    if (m.kind === "state" && !m.validUntil)
      checks.push({
        level: "semantic",
        message: "임시 상태의 유효 시기를 확인하세요.",
        quote: m.quote,
      });
  }
  for (const item of output.sns) {
    if (!output.body.includes(item.quote))
      checks.push({
        level: "hard",
        message: "SNS의 근거 구절이 본문에 없습니다.",
        quote: item.quote,
      });
    if (item.status === "read" && !/(읽|확인|read|seen)/i.test(item.quote))
      checks.push({
        level: "semantic",
        message: "메시지를 실제로 읽었는지 확인하세요.",
        quote: item.quote,
      });
  }
  if (previous) {
    const before = previous.output.body.split("\n\n"),
      after = output.body.split("\n\n");
    for (const index of previous.locks)
      if (before[index] !== after[index])
        checks.push({
          level: "hard",
          message: "잠긴 문단 " + (index + 1) + "이 변경됐습니다.",
        });
    if (request?.mode === "partial" && request.range) {
      const { start, end } = request.range;
      if (
        !output.body.startsWith(previous.output.body.slice(0, start)) ||
        !output.body.endsWith(previous.output.body.slice(end))
      )
        checks.push({
          level: "hard",
          message: "선택 범위 밖의 본문이 변경됐습니다.",
        });
    }
    if (
      (request?.mode === "style" || request?.mode === "partial") &&
      !request.allowMeaningChange
    ) {
      const oldFacts = previous.output.memories.map((m) => m.text).sort();
      const newFacts = output.memories.map((m) => m.text).sort();
      if (
        JSON.stringify(oldFacts) !== JSON.stringify(newFacts) ||
        JSON.stringify(previous.output.scene) !== JSON.stringify(output.scene)
      )
        checks.push({
          level: "semantic",
          message:
            "문체 수정에서 사실·장면 변경안이 감지됐습니다. 전후 비교가 필요합니다.",
        });
      checks.push({
        level: "semantic",
        message:
          "의미·발화 의도 보존은 자동 검증만으로 보장할 수 없습니다. 수정 전후를 검토하세요.",
      });
    }
  }
  for (const e of context.excerpts) {
    for (const segment of e.text
      .split(/[\n.!?]/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 35))
      if (output.body.includes(segment))
        checks.push({
          level: "style",
          message: "참고 원문의 긴 구절과 겹칩니다.",
          quote: segment,
        });
  }
  const endings = output.body
    .split("\n\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (new Set(endings).size < endings.length)
    checks.push({ level: "style", message: "반복되는 문단이 있습니다." });
  return checks;
}
