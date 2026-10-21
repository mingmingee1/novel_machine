import { z } from "zod";

export const channels = ["story", "settings", "ooc"] as const;
export const providerNames = [
  "codex",
  "gemini-cli",
  "openai",
  "gemini",
] as const;
const dateSchema = z.string().refine((value) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}, "날짜는 실제 존재하는 YYYY-MM-DD 또는 빈 문자열이어야 합니다.");
export const sceneSchema = z.object({
  date: dateSchema,
  time: z.string().max(80),
  place: z.string().max(200),
  pov: z.string().max(100).default(""),
  transition: z
    .enum(["continue", "simultaneous", "advance", "flashback"])
    .default("continue"),
});
export type Scene = z.infer<typeof sceneSchema>;
export const memorySchema = z.object({
  id: z.string().optional(),
  kind: z.enum([
    "author",
    "event",
    "speech",
    "knowledge",
    "belief",
    "inference",
    "plan",
    "state",
    "relationship",
    "entity",
  ]),
  text: z.string().min(1).max(6000),
  entities: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  subject: z.string().default(""),
  object: z.string().default(""),
  visibility: z.enum(["public", "author", "character"]).default("public"),
  knownBy: z.array(z.string()).default([]),
  eventDate: dateSchema.default(""),
  learnedDate: dateSchema.default(""),
  validUntil: dateSchema.default(""),
  status: z
    .enum(["occurred", "planned", "cancelled", "completed", "tentative"])
    .default("occurred"),
  certainty: z.enum(["explicit", "reported", "inferred"]).default("explicit"),
  quote: z.string().min(1).max(10000),
  sourceCandidateId: z.string().default(""),
  sourceVersion: z.number().default(1),
  branchId: z.string().default(""),
  supersedesId: z.string().default(""),
});
export type Memory = z.infer<typeof memorySchema> & { id: string };
export const snsSchema = z.object({
  id: z.string().optional(),
  sender: z.string(),
  recipient: z.string(),
  text: z.string(),
  status: z.enum(["draft", "sent", "received", "read"]),
  quote: z.string(),
  date: z.string().default(""),
});
export const outputSchema = z.object({
  body: z.string().min(1).max(120000),
  scene: sceneSchema,
  memories: z.array(memorySchema).max(100).default([]),
  sns: z.array(snsSchema).max(50).default([]),
  choices: z.array(z.string().max(600)).max(6).default([]),
  checks: z
    .array(
      z.object({
        level: z.enum(["semantic", "style"]),
        message: z.string(),
        quote: z.string().default(""),
      }),
    )
    .default([]),
});
export type StoryOutput = z.infer<typeof outputSchema>;
export type Check = {
  level: "hard" | "semantic" | "style";
  message: string;
  quote?: string;
};
export type Project = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
};
export type Branch = {
  id: string;
  projectId: string;
  name: string;
  revision: number;
  parentId?: string;
  scene: Scene;
  history: string[];
  memoryIds: string[];
  sns: z.infer<typeof snsSchema>[];
  createdAt: string;
};
export type Candidate = {
  id: string;
  projectId: string;
  branchId: string;
  baseRevision: number;
  turn: number;
  version: number;
  sourceId?: string;
  status: "draft" | "accepted" | "discarded" | "incomplete";
  output: StoryOutput;
  checks: Check[];
  reviewed: boolean;
  locks: number[];
  mode: string;
  context: Context;
  createdAt: string;
};
export type Setting = {
  id: string;
  projectId: string;
  branchId: string;
  scope: "scene" | "branch" | "project";
  kind: "character" | "world" | "relationship" | "rule";
  name: string;
  text: string;
  aliases: string[];
  status: "proposed" | "held" | "applied" | "retired";
  locked: boolean;
  version: number;
  previousId?: string;
  sceneKey?: string;
  sourceMessageId?: string;
  createdAt: string;
};
export type Source = {
  id: string;
  projectId: string;
  title: string;
  text: string;
  version: number;
  previousId?: string;
  excluded: boolean;
  createdAt: string;
};
export type Excerpt = {
  id: string;
  projectId: string;
  sourceId: string;
  start: number;
  end: number;
  text: string;
  preference: "like" | "avoid";
  tags: string[];
  sceneTags: string[];
  note: string;
  excluded: boolean;
};
export type StyleRule = {
  text: string;
  evidenceIds: string[];
  when: string;
  avoid: string;
  element: "all" | "narration" | "dialogue" | "inner" | "description";
};
export type Profile = {
  id: string;
  projectId: string;
  familyId: string;
  version: number;
  name: string;
  rules: StyleRule[];
  excerptIds: string[];
  stats: Record<string, number>;
  analysis: string;
  active: boolean;
  createdAt: string;
};
export type Feedback = {
  id: string;
  projectId: string;
  profileId: string;
  before: string;
  after: string;
  preference: string;
  scope: "scene" | "general";
  applied: boolean;
  createdAt: string;
};
export const requestSchema = z.object({
  branchId: z.string(),
  baseRevision: z.number().int().nonnegative(),
  channel: z.enum(channels).default("story"),
  mode: z
    .enum([
      "continue",
      "rewrite",
      "partial",
      "style",
      "discuss",
      "analyze",
      "lab",
    ])
    .default("continue"),
  input: z.string().min(1).max(50000),
  provider: z.enum(providerNames),
  model: z.string().min(1).max(200),
  candidateId: z.string().optional(),
  requestKey: z.string().min(8).max(100),
  style: z
    .object({
      mode: z.enum(["off", "profile", "examples"]).default("off"),
      profileIds: z.array(z.string()).max(10).default([]),
      strength: z.enum(["light", "normal", "strong"]).default("normal"),
      elementProfiles: z.record(z.string(), z.string()).default({}),
    })
    .default({
      mode: "off",
      profileIds: [],
      strength: "normal",
      elementProfiles: {},
    }),
  range: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .optional(),
  allowMeaningChange: z.boolean().default(false),
  instructionsScope: z
    .enum(["generation", "scene", "branch", "project"])
    .default("generation"),
  targetLength: z.number().int().min(100).max(20000).default(1500),
  contextBudget: z.number().int().min(4000).max(200000).default(24000),
  participation: z.enum(["author", "character"]).default("author"),
  controlledCharacter: z.string().default(""),
  labGroup: z.string().optional(),
  blind: z.boolean().default(false),
  sourceId: z.string().optional(),
});
export type GenerateRequest = z.infer<typeof requestSchema>;
export type StyleBinding = {
  id: string;
  projectId: string;
  target: "work" | "pov" | "character" | "scene";
  subject: string;
  element: "all" | "narration" | "dialogue" | "inner" | "description";
  profileFamilyId: string;
  enabled: boolean;
};
export type Context = {
  branchId: string;
  revision: number;
  scene: Scene;
  settings: Setting[];
  memories: Memory[];
  recent: { id: string; body: string }[];
  profiles: Profile[];
  bindings: StyleBinding[];
  excerpts: Excerpt[];
  style: GenerateRequest["style"];
  estimatedTokens: number;
  budget: number;
  notes: string[];
  source?: Source;
};
export type Job = {
  id: string;
  projectId: string;
  branchId: string;
  requestKey: string;
  fingerprint: string;
  request: GenerateRequest;
  context: Context;
  status:
    "queued" | "running" | "completed" | "failed" | "interrupted" | "cancelled";
  attempt: number;
  previousJobId?: string;
  partial: string;
  candidateId?: string;
  result?: string;
  error?: string;
  errorKind?: string;
  usage?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type Message = {
  id: string;
  projectId: string;
  branchId: string;
  channel: "settings" | "ooc";
  role: "user" | "assistant";
  text: string;
  jobId: string;
  createdAt: string;
};
export type Workspace = {
  project: Project;
  branch: Branch;
  branches: Branch[];
  candidates: Candidate[];
  settings: Setting[];
  memories: Memory[];
  jobs: Job[];
  messages: Message[];
  sources: Source[];
  excerpts: Excerpt[];
  profiles: Profile[];
  feedback: Feedback[];
  bindings: StyleBinding[];
};
export const characterCount = (text: string) => Array.from(text).length;
export const sceneKey = (scene: Scene) => `${scene.date}|${scene.place}`;
export function dateLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "날짜 미정";
  const d = new Date(date + "T12:00:00Z");
  return Number.isNaN(d.getTime())
    ? date
    : `${date} ${["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()]}요일`;
}
