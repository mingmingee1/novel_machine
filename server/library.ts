import { z } from "zod";
import type {
  Excerpt,
  Feedback,
  Profile,
  Source,
  StyleBinding,
} from "../shared/domain.ts";
import { characterCount } from "../shared/domain.ts";
import { AppError, id, now, Store } from "./db.ts";
export const profileInput = z.object({
  name: z.string().min(1).max(150),
  analysis: z.string().default(""),
  rules: z
    .array(
      z.object({
        text: z.string().min(1),
        evidenceIds: z.array(z.string()).default([]),
        when: z.string().default(""),
        avoid: z.string().default(""),
        element: z
          .enum(["all", "narration", "dialogue", "inner", "description"])
          .default("all"),
      }),
    )
    .max(100),
  excerptIds: z.array(z.string()).default([]),
  familyId: z.string().optional(),
});
export function statsFor(text: string) {
  const paragraphs = text.split(/\n\s*\n/).filter((x) => x.trim());
  const sentences = text
    .split(/(?<=[.!?。！？])\s+|\n/)
    .filter((x) => x.trim());
  const dialogue = text
    .split("\n")
    .filter((x) => /^[^:：\n]{1,25}[:：]|^["“「]/.test(x.trim()));
  return {
    characters: characterCount(text),
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    meanSentence: Math.round(
      characterCount(sentences.join("")) / Math.max(1, sentences.length),
    ),
    meanParagraph: Math.round(
      characterCount(paragraphs.join("")) / Math.max(1, paragraphs.length),
    ),
    dialogueLineRatio: Math.round(
      (dialogue.length /
        Math.max(1, text.split("\n").filter((x) => x.trim()).length)) *
        100,
    ),
  };
}
export class Library {
  constructor(private store: Store) {}
  binding(projectId: string, input: unknown) {
    const data = z
      .object({
        id: z.string().optional(),
        target: z.enum(["work", "pov", "character", "scene"]),
        subject: z.string().max(300).default(""),
        element: z.enum([
          "all",
          "narration",
          "dialogue",
          "inner",
          "description",
        ]),
        profileFamilyId: z.string(),
        enabled: z.boolean().default(true),
      })
      .parse(input);
    this.store.require("project", projectId);
    if (
      !this.store
        .list<Profile>("profile", projectId)
        .some((p) => p.familyId === data.profileFamilyId)
    )
      throw new AppError(400, "이 작품의 문체 프로필을 선택하세요.");
    if (
      data.id &&
      this.store.require<StyleBinding>("style-binding", data.id).projectId !==
        projectId
    )
      throw new AppError(400, "다른 작품의 문체 연결입니다.");
    if (data.target !== "work" && !data.subject.trim())
      throw new AppError(400, "대상 인물 또는 장면 조건을 입력하세요.");
    const binding: StyleBinding = { ...data, id: data.id ?? id(), projectId };
    this.store.put("style-binding", binding);
    return binding;
  }
  source(projectId: string, input: unknown) {
    const data = z
      .object({
        title: z.string().min(1).max(200),
        text: z.string().min(1).max(2_000_000),
        previousId: z.string().optional(),
      })
      .parse(input);
    this.store.require("project", projectId);
    const previous = data.previousId
      ? this.store.require<Source>("source", data.previousId)
      : undefined;
    if (previous && previous.projectId !== projectId)
      throw new AppError(400, "다른 작품의 자료입니다.");
    const source: Source = {
      ...data,
      id: id(),
      projectId,
      version: (previous?.version ?? 0) + 1,
      excluded: false,
      createdAt: now(),
    };
    this.store.transaction(() => {
      if (previous) this.store.put("source", { ...previous, excluded: true });
      this.store.put("source", source);
    });
    return source;
  }
  excerpt(projectId: string, input: unknown) {
    const data = z
      .object({
        sourceId: z.string(),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        preference: z.enum(["like", "avoid"]),
        tags: z.array(z.string()).default([]),
        sceneTags: z.array(z.string()).default([]),
        note: z.string().default(""),
      })
      .parse(input);
    const source = this.store.require<Source>("source", data.sourceId);
    if (
      source.projectId !== projectId ||
      data.start >= data.end ||
      data.end > source.text.length
    )
      throw new AppError(400, "원문 구간이 올바르지 않습니다.");
    const excerpt: Excerpt = {
      ...data,
      id: id(),
      projectId,
      text: source.text.slice(data.start, data.end),
      excluded: false,
    };
    this.store.put("excerpt", excerpt);
    return excerpt;
  }
  profile(projectId: string, input: unknown) {
    const data = profileInput.parse(input);
    const family = data.familyId
      ? this.store
          .list<Profile>("profile", projectId)
          .filter((p) => p.familyId === data.familyId)
      : [];
    if (data.familyId && !family.length)
      throw new AppError(404, "프로필 버전을 찾을 수 없습니다.");
    const excerpts = [
      ...new Set([
        ...data.excerptIds,
        ...data.rules.flatMap((r) => r.evidenceIds),
      ]),
    ].map((eid) => this.store.require<Excerpt>("excerpt", eid));
    if (excerpts.some((e) => e.projectId !== projectId))
      throw new AppError(400, "다른 작품의 근거 예문입니다.");
    const profile: Profile = {
      ...data,
      id: id(),
      projectId,
      familyId: data.familyId ?? id(),
      version: Math.max(0, ...family.map((p) => p.version)) + 1,
      active: true,
      stats: statsFor(excerpts.map((e) => e.text).join("\n\n")),
      createdAt: now(),
    };
    this.store.transaction(() => {
      for (const p of family)
        this.store.put("profile", { ...p, active: false });
      this.store.put("profile", profile);
    });
    return profile;
  }
  restore(profileId: string) {
    const p = this.store.require<Profile>("profile", profileId);
    return this.profile(p.projectId, { ...p, familyId: p.familyId });
  }
  feedback(projectId: string, input: unknown) {
    const data = z
      .object({
        profileId: z.string(),
        before: z.string().default(""),
        after: z.string().default(""),
        preference: z.string().min(1),
        scope: z.enum(["scene", "general"]),
      })
      .parse(input);
    if (
      this.store.require<Profile>("profile", data.profileId).projectId !==
      projectId
    )
      throw new AppError(400, "다른 작품의 프로필입니다.");
    const f: Feedback = {
      ...data,
      id: id(),
      projectId,
      applied: false,
      createdAt: now(),
    };
    this.store.put("feedback", f);
    return f;
  }
  applyFeedback(feedbackId: string) {
    const f = this.store.require<Feedback>("feedback", feedbackId);
    if (f.applied) throw new AppError(409, "이미 반영한 피드백입니다.");
    if (f.scope !== "general")
      throw new AppError(
        400,
        "장면 한정 피드백은 영구 규칙으로 적용하지 않습니다.",
      );
    const p = this.store.require<Profile>("profile", f.profileId);
    const profile = this.profile(p.projectId, {
      ...p,
      rules: [
        ...p.rules,
        {
          text: f.preference,
          evidenceIds: [],
          when: "사용자가 명시적으로 적용한 일반 선호",
          avoid: "장면과 인물 설정을 우선한다.",
          element: "all",
        },
      ],
    });
    this.store.put("feedback", { ...f, applied: true });
    return profile;
  }
}
