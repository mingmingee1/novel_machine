import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  Branch,
  Candidate,
  Check,
  Context,
  GenerateRequest,
  Job,
  Memory,
  Message,
  Project,
  Setting,
  StoryOutput,
  Workspace,
} from "../shared/domain.ts";
import { outputSchema, requestSchema, sceneKey } from "../shared/domain.ts";
import { AppError, id, now, Store } from "./db.ts";
import { buildContext, relevance } from "./context.ts";
import { validateOutput } from "./validation.ts";
import { Library } from "./library.ts";

export const emptyScene = {
  date: "",
  time: "",
  place: "",
  pov: "",
  transition: "continue" as const,
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class NovelService {
  library: Library;
  constructor(public store: Store) {
    this.library = new Library(store);
  }
  projects() {
    return this.store.list<Project>("project");
  }
  createProject(input: unknown) {
    const data = z
      .object({
        title: z.string().trim().min(1).max(150),
        description: z.string().max(10000).default(""),
      })
      .parse(input);
    const project: Project = { ...data, id: id(), createdAt: now() };
    const branch: Branch = {
      id: id(),
      projectId: project.id,
      name: "본편",
      revision: 0,
      scene: { ...emptyScene },
      history: [],
      memoryIds: [],
      sns: [],
      createdAt: now(),
    };
    this.store.transaction(() => {
      this.store.put("project", project);
      this.saveBranch(branch);
    });
    return { project, branch };
  }
  saveBranch(branch: Branch) {
    this.store.put("branch", branch);
    const settings = this.store
      .list<Setting>("setting", branch.projectId)
      .filter(
        (s) =>
          s.status === "applied" &&
          (s.scope === "project" || s.branchId === branch.id),
      );
    this.store.put("revision", {
      id: branch.id + ":" + branch.revision,
      projectId: branch.projectId,
      branchId: branch.id,
      branch: structuredClone(branch),
      settings,
    });
  }
  checkRevision(branch: Branch, revision: number) {
    if (branch.revision !== revision)
      throw new AppError(
        409,
        "분기가 변경됐습니다. 최신 내용을 불러온 뒤 다시 시도하세요.",
      );
  }
  workspace(branchId: string): Workspace {
    const branch = this.store.require<Branch>("branch", branchId),
      project = this.store.require<Project>("project", branch.projectId);
    return {
      project,
      branch,
      branches: this.store.list<Branch>("branch", project.id),
      candidates: this.store.list<Candidate>(
        "candidate",
        project.id,
        branch.id,
      ),
      memories: branch.memoryIds.map((mid) =>
        this.store.require<Memory>("memory", mid),
      ),
      settings: this.store
        .list<Setting>("setting", project.id)
        .filter((s) => s.scope === "project" || s.branchId === branchId),
      jobs: this.store.list<Job>("job", project.id, branch.id),
      messages: this.store.list<Message>("message", project.id, branch.id),
      sources: this.store.list("source", project.id),
      excerpts: this.store.list("excerpt", project.id),
      profiles: this.store.list("profile", project.id),
      feedback: this.store.list("feedback", project.id),
      bindings: this.store.list("style-binding", project.id),
    };
  }
  candidate(
    branchId: string,
    output: StoryOutput,
    options: {
      mode?: string;
      context?: Context;
      source?: Candidate;
      checks?: Check[];
    } = {},
  ) {
    const branch = this.store.require<Branch>("branch", branchId);
    const context =
      options.context ??
      buildContext(
        this.store,
        branch,
        requestSchema.parse({
          branchId,
          baseRevision: branch.revision,
          input: "직접 작성",
          requestKey: id(),
          provider: "codex",
          model: "default",
        }),
      );
    const checks = options.checks ?? validateOutput(output, context);
    const c: Candidate = {
      id: id(),
      projectId: branch.projectId,
      branchId,
      baseRevision: context.revision,
      turn: branch.history.length + 1,
      version: (options.source?.version ?? 0) + 1,
      sourceId: options.source?.id,
      status: "draft",
      output,
      checks,
      reviewed: !checks.some((c) => c.level !== "style"),
      locks: options.source?.locks ?? [],
      mode: options.mode ?? "manual",
      context,
      createdAt: now(),
    };
    this.store.put("candidate", c);
    return c;
  }
  editCandidate(candidateId: string, input: unknown) {
    const data = z
      .object({
        baseRevision: z.number().int(),
        body: z.string().min(1).max(120000),
        locks: z.array(z.number().int().nonnegative()).optional(),
        output: outputSchema.optional(),
      })
      .parse(input);
    const previous = this.store.require<Candidate>("candidate", candidateId),
      branch = this.store.require<Branch>("branch", previous.branchId);
    this.checkRevision(branch, data.baseRevision);
    if (previous.status === "accepted")
      throw new AppError(
        409,
        "확정 본문은 그 이전 시점에서 분기한 뒤 수정하세요.",
      );
    const output = data.output ?? { ...previous.output, body: data.body };
    output.body = data.body;
    const checks = validateOutput(
      output,
      previous.context,
      undefined,
      previous,
    );
    if (checks.some((c) => c.level === "hard" && c.message.includes("잠긴")))
      throw new AppError(
        409,
        "잠긴 문단을 변경할 수 없습니다. 먼저 잠금을 해제하세요.",
      );
    if (previous.output.body !== data.body)
      checks.push({
        level: "semantic",
        message: "직접 편집한 본문과 기억·상태 변경안을 다시 확인하세요.",
      });
    const c = this.candidate(branch.id, output, {
      mode: "edit",
      source: previous,
      context: previous.context,
      checks,
    });
    if (data.locks) {
      if (data.locks.some((i) => i >= data.body.split("\n\n").length))
        throw new AppError(400, "문단 번호가 올바르지 않습니다.");
      c.locks = data.locks;
      this.store.put("candidate", c);
    }
    return c;
  }
  review(candidateId: string) {
    const c = this.store.require<Candidate>("candidate", candidateId);
    this.checkRevision(
      this.store.require<Branch>("branch", c.branchId),
      c.baseRevision,
    );
    if (c.checks.some((check) => check.level === "hard"))
      throw new AppError(422, "구조·근거 오류를 먼저 수정하세요.");
    c.reviewed = true;
    this.store.put("candidate", c);
    return c;
  }
  discard(candidateId: string) {
    const c = this.store.require<Candidate>("candidate", candidateId);
    if (c.status === "accepted")
      throw new AppError(409, "확정 본문은 되돌리기 분기를 사용하세요.");
    c.status = "discarded";
    this.store.put("candidate", c);
    return c;
  }
  restoreCandidate(candidateId: string) {
    const c = this.store.require<Candidate>("candidate", candidateId),
      b = this.store.require<Branch>("branch", c.branchId);
    this.checkRevision(b, c.baseRevision);
    if (c.status === "accepted")
      throw new AppError(409, "이미 확정된 본문입니다.");
    return this.candidate(b.id, c.output, {
      source: c,
      context: c.context,
      mode: "restore",
      checks: c.checks,
    });
  }
  commit(candidateId: string, baseRevision: number) {
    return this.store.transaction(() =>
      this.commitInside(candidateId, baseRevision),
    );
  }
  private commitInside(candidateId: string, baseRevision: number) {
    const c = this.store.require<Candidate>("candidate", candidateId),
      branch = this.store.require<Branch>("branch", c.branchId);
    if (c.status === "accepted" && branch.history.includes(c.id)) return branch;
    this.checkRevision(branch, baseRevision);
    this.checkRevision(branch, c.baseRevision);
    if (
      c.status !== "draft" ||
      !c.reviewed ||
      c.checks.some((x) => x.level === "hard")
    )
      throw new AppError(422, "검수가 완료된 후보만 확정할 수 있습니다.");
    if (c.mode === "lab")
      throw new AppError(422, "실험 후보는 본문으로 가져온 뒤 확정하세요.");
    const newMemories = c.output.memories.map((m) => ({
      ...m,
      id: id(),
      branchId: branch.id,
      projectId: branch.projectId,
      sourceCandidateId: c.id,
      sourceVersion: c.version,
    }));
    for (const memory of newMemories) {
      this.store.put("memory", memory);
      this.store.put("search", {
        id: memory.id,
        projectId: branch.projectId,
        branchId: branch.id,
        text: memory.text,
        aliases: memory.aliases,
      } as { id: string; projectId: string; branchId: string });
    }
    c.status = "accepted";
    this.store.put("candidate", c);
    branch.history.push(c.id);
    branch.memoryIds.push(...newMemories.map((m) => m.id));
    branch.scene = c.output.scene;
    branch.sns.push(...c.output.sns.map((s) => ({ ...s, id: id() })));
    branch.revision++;
    this.saveBranch(branch);
    return branch;
  }
  fork(branchId: string, input: unknown) {
    const data = z
      .object({
        name: z.string().min(1).max(150),
        revision: z.number().int().nonnegative(),
        candidateId: z.string().optional(),
      })
      .parse(input);
    const parent = this.store.require<Branch>("branch", branchId);
    const source = data.candidateId
      ? this.store.require<Candidate>("candidate", data.candidateId)
      : undefined;
    if (
      source &&
      (source.branchId !== branchId || source.baseRevision !== data.revision)
    )
      throw new AppError(
        400,
        "수정할 원문의 기준 시점이 분기 시점과 다릅니다.",
      );
    const saved = this.store.require<{ branch: Branch; settings: Setting[] }>(
        "revision",
        branchId + ":" + data.revision,
      ),
      snapshot = saved.branch;
    return this.store.transaction(() => {
      const branch: Branch = {
        ...structuredClone(snapshot),
        id: id(),
        name: data.name,
        parentId: parent.id,
        createdAt: now(),
        revision: 0,
        history: [],
        memoryIds: [],
      };
      const candidateMap = new Map<string, string>();
      for (const [index, cid] of snapshot.history.entries()) {
        const c = this.store.require<Candidate>("candidate", cid),
          newId = id();
        candidateMap.set(cid, newId);
        this.store.put("candidate", {
          ...c,
          id: newId,
          branchId: branch.id,
          sourceId: c.id,
          baseRevision: index,
          context: { ...c.context, branchId: branch.id, revision: index },
        });
        branch.history.push(newId);
      }
      const memoryMap = new Map(snapshot.memoryIds.map((mid) => [mid, id()]));
      for (const mid of snapshot.memoryIds) {
        const memory = this.store.require<Memory>("memory", mid),
          newId = memoryMap.get(mid)!;
        this.store.put("memory", {
          ...memory,
          id: newId,
          projectId: branch.projectId,
          branchId: branch.id,
          sourceCandidateId:
            candidateMap.get(memory.sourceCandidateId) ??
            memory.sourceCandidateId,
          supersedesId: memoryMap.get(memory.supersedesId) ?? "",
        });
        branch.memoryIds.push(newId);
      }
      for (const setting of saved.settings ?? [])
        if (setting.scope !== "project")
          this.store.put("setting", {
            ...setting,
            id: id(),
            branchId: branch.id,
            previousId: setting.id,
          });
      const fullHistory = [...branch.history],
        fullMemories = [...branch.memoryIds];
      // Give copied turns their own revision history so past edits work after repeated forks.
      for (let index = 0; index <= fullHistory.length; index++) {
        branch.history = fullHistory.slice(0, index);
        branch.memoryIds = fullMemories.filter((mid) =>
          branch.history.includes(
            this.store.require<Memory>("memory", mid).sourceCandidateId,
          ),
        );
        branch.revision = index;
        branch.scene = index
          ? this.store.require<Candidate>(
              "candidate",
              branch.history[index - 1],
            ).output.scene
          : { ...emptyScene };
        branch.sns = branch.history.flatMap(
          (cid) => this.store.require<Candidate>("candidate", cid).output.sns,
        );
        this.saveBranch(branch);
      }
      if (source) {
        const output = structuredClone(source.output);
        output.memories = output.memories.map((m) => ({
          ...m,
          supersedesId: memoryMap.get(m.supersedesId) ?? "",
        }));
        this.candidate(branch.id, output, {
          source,
          mode: "past-edit",
          checks: [
            {
              level: "semantic",
              message:
                "이전 본문을 새 분기의 수정 후보로 보존했습니다. 변경 후 기억·후속 장면을 검토하세요.",
            },
          ],
        });
      }
      return branch;
    });
  }
  impacts(candidateId: string) {
    const c = this.store.require<Candidate>("candidate", candidateId),
      b = this.store.require<Branch>("branch", c.branchId);
    const index = b.history.indexOf(candidateId);
    const affected = index < 0 ? [] : b.history.slice(index);
    return {
      candidateIds: affected,
      memoryIds: b.memoryIds.filter((mid) =>
        affected.includes(
          this.store.require<Memory>("memory", mid).sourceCandidateId,
        ),
      ),
      forkRevision: c.baseRevision,
    };
  }
  setting(branchId: string, input: unknown) {
    const data = z
      .object({
        baseRevision: z.number().int(),
        scope: z.enum(["scene", "branch", "project"]),
        kind: z.enum(["character", "world", "relationship", "rule"]),
        name: z.string().min(1),
        text: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        status: z
          .enum(["proposed", "held", "applied", "retired"])
          .default("proposed"),
        locked: z.boolean().default(false),
        previousId: z.string().optional(),
        sourceMessageId: z.string().optional(),
      })
      .parse(input);
    const branch = this.store.require<Branch>("branch", branchId);
    this.checkRevision(branch, data.baseRevision);
    if (
      data.sourceMessageId &&
      this.store.require<Message>("message", data.sourceMessageId).branchId !==
        branchId
    )
      throw new AppError(400, "다른 분기의 상담 기록입니다.");
    const previous = data.previousId
      ? this.store.require<Setting>("setting", data.previousId)
      : undefined;
    if (
      previous &&
      (previous.projectId !== branch.projectId ||
        (previous.scope !== "project" && previous.branchId !== branchId))
    )
      throw new AppError(400, "다른 분기의 설정입니다.");
    const setting: Setting = {
      ...data,
      id: id(),
      projectId: branch.projectId,
      branchId,
      version: (previous?.version ?? 0) + 1,
      sceneKey: sceneKey(branch.scene),
      createdAt: now(),
    };
    return this.store.transaction(() => {
      if (previous && data.status === "applied")
        this.store.put("setting", { ...previous, status: "retired" });
      this.store.put("setting", setting);
      if (
        data.status === "applied" ||
        (data.status === "retired" && previous?.status === "applied")
      ) {
        const affected =
          data.scope === "project"
            ? this.store.list<Branch>("branch", branch.projectId)
            : [branch];
        for (const b of affected) {
          b.revision++;
          this.saveBranch(b);
        }
      }
      return setting;
    });
  }
  createJob(input: unknown) {
    const request = requestSchema.parse(input),
      fingerprint = hash({ ...request, requestKey: undefined });
    const prior = this.store.db
      .prepare("SELECT job_id FROM request_keys WHERE request_key=?")
      .get(request.requestKey) as { job_id: string } | undefined;
    if (prior) {
      const j = this.store.require<Job>("job", prior.job_id);
      if (j.fingerprint !== fingerprint)
        throw new AppError(409, "같은 요청 키로 다른 요청을 보낼 수 없습니다.");
      return j;
    }
    return this.store.transaction(() => {
      let branch = this.store.require<Branch>("branch", request.branchId);
      this.checkRevision(branch, request.baseRevision);
      const source = request.candidateId
        ? this.store.require<Candidate>("candidate", request.candidateId)
        : undefined;
      if (source && source.branchId !== branch.id)
        throw new AppError(400, "다른 분기의 후보입니다.");
      if (["rewrite", "partial", "style"].includes(request.mode)) {
        if (!source || source.status === "accepted")
          throw new AppError(
            409,
            "수정할 미확정 후보를 선택하세요. 확정 본문은 먼저 분기해야 합니다.",
          );
        this.checkRevision(branch, source.baseRevision);
      }
      if (
        request.mode === "partial" &&
        (!request.range ||
          !source ||
          request.range.start >= request.range.end ||
          request.range.end > source.output.body.length)
      )
        throw new AppError(400, "부분 수정 범위를 선택하세요.");
      if (request.channel === "story" && request.mode === "continue" && source)
        branch = this.commitInside(source.id, branch.revision);
      request.baseRevision = branch.revision;
      const context = buildContext(this.store, branch, request);
      const job: Job = {
        id: id(),
        projectId: branch.projectId,
        branchId: branch.id,
        requestKey: request.requestKey,
        fingerprint,
        request,
        context,
        status: "queued",
        attempt: 1,
        partial: "",
        createdAt: now(),
        updatedAt: now(),
      };
      this.store.put("job", job);
      this.store.db
        .prepare("INSERT INTO request_keys VALUES(?,?)")
        .run(request.requestKey, job.id);
      this.store.event(job.id, "status", { status: "queued" });
      if (request.channel !== "story")
        this.store.put("message", {
          id: id(),
          projectId: branch.projectId,
          branchId: branch.id,
          channel: request.channel,
          role: "user",
          text: request.input,
          jobId: job.id,
          createdAt: now(),
        } as Message);
      return job;
    });
  }
  retry(jobId: string) {
    const previous = this.store.require<Job>("job", jobId);
    if (!["failed", "cancelled", "interrupted"].includes(previous.status))
      throw new AppError(409, "실패·중단 작업만 재시도할 수 있습니다.");
    const branch = this.store.require<Branch>("branch", previous.branchId);
    this.checkRevision(branch, previous.context.revision);
    const request = { ...previous.request, requestKey: id() };
    // Reuse the frozen input; never recommit a preceding candidate during a retry.
    const job: Job = {
      ...previous,
      id: id(),
      requestKey: request.requestKey,
      request,
      fingerprint: hash({ ...request, requestKey: undefined }),
      status: "queued",
      attempt: previous.attempt + 1,
      previousJobId: previous.id,
      partial: "",
      candidateId: undefined,
      result: undefined,
      error: undefined,
      errorKind: undefined,
      usage: undefined,
      createdAt: now(),
      updatedAt: now(),
    };
    this.store.transaction(() => {
      this.store.put("job", job);
      this.store.db
        .prepare("INSERT INTO request_keys VALUES(?,?)")
        .run(job.requestKey, job.id);
      this.store.event(job.id, "status", { status: "queued" });
    });
    return job;
  }
  importLab(candidateId: string) {
    const c = this.store.require<Candidate>("candidate", candidateId),
      branch = this.store.require<Branch>("branch", c.branchId);
    this.checkRevision(branch, c.baseRevision);
    if (c.mode !== "lab") throw new AppError(400, "실험 후보가 아닙니다.");
    return this.candidate(branch.id, c.output, {
      source: c,
      context: c.context,
      mode: "import-lab",
      checks: c.checks,
    });
  }
  search(branchId: string, query: string) {
    const w = this.workspace(branchId);
    const aliases = w.settings.flatMap((s) => [s.name, ...s.aliases]);
    return w.memories
      .map((m) => ({
        memory: m,
        score: relevance(query, m.text, [
          ...aliases,
          ...m.entities,
          ...m.aliases,
        ]),
      }))
      .filter((x) => !query || x.score > 0)
      .sort((a, b) => b.score - a.score);
  }
  importPreview(text: string) {
    const sections = text
      .split(/(?=^.*(?:📍|📖|📊|📱|🧬|🎮|OOC))/m)
      .filter(Boolean)
      .map((raw) => ({
        raw,
        kind: /OOC/i.test(raw.slice(0, 30))
          ? "ooc"
          : /^[^\n]*(📊|📱|🧬|🎮|📍)/.test(raw)
            ? "metadata"
            : "body",
        confirmed: false,
      }));
    return {
      original: text,
      sections,
      notice: "분류는 제안입니다. 원문을 보존하며 후보로만 가져옵니다.",
    };
  }
  importText(branchId: string, input: unknown) {
    const data = z
      .object({
        text: z.string().min(1).max(120000),
        body: z.string().min(1).max(120000),
        baseRevision: z.number().int(),
      })
      .parse(input);
    const branch = this.store.require<Branch>("branch", branchId);
    this.checkRevision(branch, data.baseRevision);
    this.store.put("import", {
      id: id(),
      projectId: branch.projectId,
      branchId,
      original: data.text,
      createdAt: now(),
    } as { id: string; projectId: string; branchId: string });
    return this.candidate(
      branchId,
      outputSchema.parse({ body: data.body, scene: branch.scene }),
      {
        mode: "import",
        checks: [
          {
            level: "semantic",
            message:
              "가져온 원문의 분류·시간·설정을 확인하세요. 기억은 아직 추출하지 않았습니다.",
          },
        ],
      },
    );
  }
  exportText(branchId: string, includeCandidate: boolean, full: boolean) {
    const w = this.workspace(branchId),
      items = w.branch.history.map((cid) =>
        this.store.require<Candidate>("candidate", cid),
      );
    if (includeCandidate) {
      const latest = w.candidates
        .filter(
          (c) =>
            c.status === "draft" &&
            c.mode !== "lab" &&
            c.baseRevision === w.branch.revision,
        )
        .at(-1);
      if (latest) items.push(latest);
    }
    return items
      .map(
        (c) =>
          (c.status === "draft" ? "[미확정 후보]\n\n" : "") +
          (full
            ? [
                "📍 날짜 · 장소 · 시간",
                JSON.stringify(c.output.scene),
                "📖 본문",
                c.output.body,
                "📊 스테이터스 + 해야 할 일",
                JSON.stringify(c.output.memories, null, 2),
                "📱 SNS 현황",
                JSON.stringify(c.output.sns, null, 2),
                "🧬 문체 로직 / 설정 붕괴 점검",
                JSON.stringify(c.checks, null, 2),
                "🎮 선택지",
                c.output.choices.join("\n"),
              ].join("\n\n")
            : c.output.body),
      )
      .join("\n\n---\n\n");
  }
  backup(projectId: string) {
    const project = this.store.require<Project>("project", projectId);
    const rows = this.store.db
      .prepare(
        "SELECT kind,id,data FROM records WHERE project_id=? OR (kind='project' AND id=?) ORDER BY kind,id",
      )
      .all(projectId, projectId) as {
      kind: string;
      id: string;
      data: string;
    }[];
    const payload = {
      projectId: project.id,
      records: rows.map((r) => ({ kind: r.kind, data: JSON.parse(r.data) })),
    };
    return {
      format: "novel-machine",
      version: 1,
      createdAt: now(),
      checksum: hash(payload),
      payload,
    };
  }
  restoreBackup(input: unknown) {
    const parsed = z
      .object({
        format: z.literal("novel-machine"),
        version: z.literal(1),
        checksum: z.string(),
        payload: z.object({
          projectId: z.string(),
          records: z
            .array(
              z.object({
                kind: z.enum([
                  "project",
                  "branch",
                  "revision",
                  "candidate",
                  "memory",
                  "setting",
                  "source",
                  "excerpt",
                  "profile",
                  "feedback",
                  "job",
                  "message",
                  "import",
                  "search",
                  "style-binding",
                ]),
                data: z.record(z.string(), z.unknown()),
              }),
            )
            .max(100000),
        }),
      })
      .parse(input);
    if (hash(parsed.payload) !== parsed.checksum)
      throw new AppError(400, "백업 무결성 검사가 실패했습니다.");
    const records = parsed.payload.records,
      project = records.find((r) => r.kind === "project");
    if (
      !project ||
      project.data.id !== parsed.payload.projectId ||
      records.filter((r) => r.kind === "project").length !== 1
    )
      throw new AppError(400, "백업의 작품 구조가 올바르지 않습니다.");
    const map = new Map<string, string>(),
      seen = new Set<string>();
    for (const row of records) {
      if (
        typeof row.data.id !== "string" ||
        seen.has(row.kind + ":" + row.data.id)
      )
        throw new AppError(400, "백업 ID가 중복되거나 누락됐습니다.");
      seen.add(row.kind + ":" + row.data.id);
      if (row.kind !== "revision") map.set(row.data.id, id());
      if (
        row.kind !== "project" &&
        row.data.projectId !== parsed.payload.projectId
      )
        throw new AppError(400, "백업에 다른 작품의 자료가 있습니다.");
      if (row.kind === "candidate") outputSchema.parse(row.data.output);
    }
    const byKey = new Map(
      records.map((row) => [row.kind + ":" + row.data.id, row.data]),
    );
    for (const row of records) {
      const data = row.data;
      if (data.branchId && !byKey.has("branch:" + data.branchId))
        throw new AppError(400, "백업에 없는 분기 참조입니다.");
      if (row.kind === "memory") {
        const source = byKey.get("candidate:" + data.sourceCandidateId);
        if (!source || source.branchId !== data.branchId)
          throw new AppError(400, "기억의 원문·분기 참조가 올바르지 않습니다.");
      }
      if (row.kind === "excerpt") {
        const source = byKey.get("source:" + data.sourceId);
        if (
          !source ||
          typeof source.text !== "string" ||
          typeof data.start !== "number" ||
          typeof data.end !== "number" ||
          data.text !== source.text.slice(data.start, data.end)
        )
          throw new AppError(400, "예문의 원문·구간 참조가 올바르지 않습니다.");
      }
      if (
        row.kind === "job" &&
        ((data.request as { branchId?: string })?.branchId !== data.branchId ||
          (data.context as { branchId?: string })?.branchId !== data.branchId)
      )
        throw new AppError(400, "작업의 기준 분기가 올바르지 않습니다.");
    }
    for (const row of records)
      if (row.kind === "branch") {
        const b = row.data as unknown as Branch;
        if (
          !Array.isArray(b.history) ||
          !Array.isArray(b.memoryIds) ||
          !b.scene
        )
          throw new AppError(400, "백업 분기 구조가 올바르지 않습니다.");
        for (const cid of b.history)
          if (
            !seen.has("candidate:" + cid) ||
            byKey.get("candidate:" + cid)?.branchId !== b.id
          )
            throw new AppError(400, "백업에 확정 본문이 누락됐습니다.");
        for (const mid of b.memoryIds)
          if (
            !seen.has("memory:" + mid) ||
            byKey.get("memory:" + mid)?.branchId !== b.id
          )
            throw new AppError(400, "백업에 기억이 누락됐습니다.");
      }
    const remap = (v: unknown): unknown =>
      typeof v === "string"
        ? (map.get(v) ?? v)
        : Array.isArray(v)
          ? v.map(remap)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, remap(x)]),
              )
            : v;
    const newProjectId = map.get(parsed.payload.projectId)!;
    this.store.transaction(() => {
      for (const row of records) {
        const data = remap(row.data) as Record<string, unknown> & {
          id: string;
          projectId?: string;
          branchId?: string;
        };
        if (row.kind === "project") data.title = String(data.title) + " (복원)";
        if (row.kind === "revision")
          data.id =
            String(data.branchId) +
            ":" +
            String((data.branch as Branch).revision);
        if (row.kind === "job") {
          data.requestKey = id();
          if (["running", "queued"].includes(String(data.status))) {
            data.status = "interrupted";
            data.error = "복원된 외부 호출은 자동 재실행하지 않습니다.";
          }
        }
        this.store.put(row.kind, data);
      }
    });
    return this.store.require<Project>("project", newProjectId);
  }
}
