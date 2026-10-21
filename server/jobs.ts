import type { Candidate, Job, Message } from "../shared/domain.ts";
import { id, now } from "./db.ts";
import { NovelService } from "./service.ts";
import { promptFor } from "./context.ts";
import { parseJSON, parseOutput, validateOutput } from "./validation.ts";
import {
  ProviderError,
  runProvider,
  type ProviderRunner,
} from "./providers.ts";
export class Worker {
  active = new Map<string, AbortController>();
  timer?: ReturnType<typeof setInterval>;
  processing = false;
  constructor(
    public service: NovelService,
    private provider: ProviderRunner = runProvider,
  ) {}
  recover() {
    for (const job of this.service.store.list<Job>("job"))
      if (job.status === "running") {
        job.status = "interrupted";
        job.error =
          "서버가 재시작되어 이전 프로세스를 복구할 수 없습니다. 부분 출력은 보존했습니다.";
        job.updatedAt = now();
        this.service.store.put("job", job);
        this.service.store.event(job.id, "status", { status: job.status });
      }
  }
  start() {
    this.recover();
    this.timer = setInterval(() => void this.tick(), 300);
    this.timer.unref();
  }
  async tick() {
    if (this.processing) return;
    const job = this.service.store
      .list<Job>("job")
      .find((j) => j.status === "queued");
    if (!job) return;
    this.processing = true;
    try {
      await this.execute(job);
    } finally {
      this.processing = false;
    }
  }
  async execute(job: Job) {
    const store = this.service.store,
      controller = new AbortController();
    this.active.set(job.id, controller);
    job.status = "running";
    job.updatedAt = now();
    store.put("job", job);
    store.event(job.id, "status", { status: "running" });
    try {
      const source = job.request.candidateId
        ? store.require<Candidate>("candidate", job.request.candidateId)
        : undefined;
      const result = await this.provider(
        job.request,
        promptFor(job.request, job.context, source),
        controller.signal,
        (delta) => {
          if (controller.signal.aborted) return;
          job.partial += delta;
          job.updatedAt = now();
          store.put("job", job);
          store.event(job.id, "delta", { text: delta });
        },
      );
      if (controller.signal.aborted)
        throw new ProviderError("cancelled", "사용자가 중단했습니다.");
      job.partial = result.text;
      job.usage = result.usage;
      store.transaction(() => {
        if (job.request.mode === "analyze") {
          const data = parseJSON(result.text);
          const profile = this.service.library.profile(job.projectId, {
            ...data,
            excerptIds: job.context.excerpts.map((e) => e.id),
          });
          job.result = "문체 프로필을 저장했습니다: " + profile.name;
        } else if (job.request.channel !== "story") {
          const message: Message = {
            id: id(),
            projectId: job.projectId,
            branchId: job.branchId,
            channel: job.request.channel,
            role: "assistant",
            text: result.text,
            jobId: job.id,
            createdAt: now(),
          };
          store.put("message", message);
          job.result = result.text;
        } else {
          const output = parseOutput(result.text),
            checks = validateOutput(output, job.context, job.request, source);
          const branch = this.service.workspace(job.branchId).branch;
          if (branch.revision !== job.context.revision)
            checks.push({
              level: "hard",
              message:
                "생성 도중 분기가 변경됐습니다. 이 결과는 이전 버전의 후보로 보존했습니다.",
            });
          const c = this.service.candidate(job.branchId, output, {
            mode: job.request.mode,
            context: job.context,
            source,
            checks,
          });
          job.candidateId = c.id;
        }
        job.status = "completed";
        job.updatedAt = now();
        store.put("job", job);
        store.event(job.id, "status", {
          status: "completed",
          candidateId: job.candidateId,
        });
      });
    } catch (error) {
      const current = store.require<Job>("job", job.id);
      job.status =
        current.status === "interrupted"
          ? "interrupted"
          : current.status === "cancelled" || controller.signal.aborted
            ? "cancelled"
            : "failed";
      job.errorKind = error instanceof ProviderError ? error.kind : "protocol";
      job.error =
        error instanceof ProviderError
          ? error.message
          : "응답 구조 또는 저장 검증에 실패했습니다. 원본 출력은 작업 기록에 보존했습니다.";
      job.updatedAt = now();
      store.put("job", job);
      store.event(job.id, "status", { status: job.status, error: job.error });
    } finally {
      this.active.delete(job.id);
    }
  }
  cancel(jobId: string) {
    const job = this.service.store.require<Job>("job", jobId);
    if (!["queued", "running"].includes(job.status)) return job;
    job.status = "cancelled";
    job.updatedAt = now();
    this.service.store.put("job", job);
    this.service.store.event(job.id, "status", { status: "cancelled" });
    this.active.get(jobId)?.abort();
    return job;
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const [jobId, controller] of this.active) {
      const job = this.service.store.require<Job>("job", jobId);
      job.status = "interrupted";
      job.error = "서버 종료로 작업이 중단됐습니다.";
      this.service.store.put("job", job);
      controller.abort();
    }
  }
}
