import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Plus,
  Upload,
  ArrowUpRight,
  Check,
  BookOpen,
  RotateCcw,
  Download,
  FlaskConical,
  LibraryBig,
  LockKeyhole,
  Search,
  Eye,
  EyeOff,
} from "lucide-react";
import type {
  Candidate,
  GenerateRequest,
  Profile,
  Setting,
  Source,
  Workspace,
} from "../shared/domain";
import { api, apiText, download, saveLocal, stored } from "./api";
import { Empty, Field, Modal } from "./ui";

export type Mutate = (
  fn: () => Promise<unknown>,
  message?: string,
) => Promise<void>;
export type ReaderSettings = {
  size: number;
  lineHeight: number;
  paragraphGap: number;
  margin: number;
  theme: "light" | "dark";
  font: "serif" | "sans";
  collapsed: boolean;
};
export const defaultReader: ReaderSettings = {
  size: 16,
  lineHeight: 1.65,
  paragraphGap: 0.65,
  margin: 16,
  theme: "light",
  font: "serif",
  collapsed: false,
};
export function ReaderPanel({
  value,
  onChange,
  onClose,
}: {
  value: ReaderSettings;
  onChange: (v: ReaderSettings) => void;
  onClose: () => void;
}) {
  const slider = (
    key: keyof ReaderSettings,
    label: string,
    min: number,
    max: number,
    step: number,
    suffix = "",
  ) => (
    <Field label={label + " · " + value[key] + suffix}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(value[key])}
        onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
      />
    </Field>
  );
  return (
    <Modal title="읽기 설정" onClose={onClose}>
      <p className="muted">
        이 기기에만 저장됩니다. 입력창과 버튼 크기는 별도로 유지됩니다.
      </p>
      <div
        className="reader-preview"
        style={{
          fontSize: value.size / 16 + "rem",
          lineHeight: value.lineHeight,
          fontFamily: value.font === "serif" ? "var(--serif)" : "var(--sans)",
          paddingInline: value.margin,
        }}
      >
        이야기에는 저마다의 호흡이 있다.
        <p style={{ marginTop: value.paragraphGap + "em" }}>
          조금 넓은 여백과 편안한 글씨로, 읽던 문장에 다시 머물러 보세요.
        </p>
      </div>
      {slider("size", "본문 크기", 14, 22, 0.5, "px")}
      {slider("lineHeight", "행간", 1.4, 2, 0.05)}
      {slider("paragraphGap", "문단 간격", 0.2, 2, 0.05, "em")}
      {slider("margin", "좌우 여백", 12, 40, 2, "px")}
      <div className="form-grid">
        <Field label="글꼴">
          <select
            value={value.font}
            onChange={(e) =>
              onChange({ ...value, font: e.target.value as "serif" | "sans" })
            }
          >
            <option value="serif">명조 · 시스템 글꼴</option>
            <option value="sans">고딕 · 시스템 글꼴</option>
          </select>
        </Field>
        <Field label="테마">
          <select
            value={value.theme}
            onChange={(e) =>
              onChange({ ...value, theme: e.target.value as "light" | "dark" })
            }
          >
            <option value="light">밝은 종이</option>
            <option value="dark">밤의 작업실</option>
          </select>
        </Field>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={value.collapsed}
          onChange={(e) => onChange({ ...value, collapsed: e.target.checked })}
        />
        상태·SNS·점검 기본 접기
      </label>
      <button className="text-button" onClick={() => onChange(defaultReader)}>
        기본값으로 돌아가기
      </button>
    </Modal>
  );
}
export function SettingsPanel({ w, mutate }: { w: Workspace; mutate: Mutate }) {
  const [edit, setEdit] = useState<Setting>(),
    [name, setName] = useState(""),
    [text, setText] = useState(""),
    [kind, setKind] = useState<Setting["kind"]>("character"),
    [scope, setScope] = useState<Setting["scope"]>("branch"),
    [aliases, setAliases] = useState(""),
    [locked, setLocked] = useState(false);
  function load(s: Setting) {
    setEdit(s);
    setName(s.name);
    setText(s.text);
    setKind(s.kind);
    setScope(s.scope);
    setAliases(s.aliases.join(", "));
    setLocked(s.locked);
  }
  const save = (status: Setting["status"]) =>
    mutate(
      async () => {
        await api("/branches/" + w.branch.id + "/settings", {
          baseRevision: w.branch.revision,
          name,
          text,
          kind,
          scope,
          aliases: aliases
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          locked,
          status,
          previousId: edit?.id,
        });
        setEdit(undefined);
        setName("");
        setText("");
      },
      status === "applied"
        ? "설정을 새 버전으로 적용했습니다."
        : "설정 제안을 저장했습니다.",
    );
  return (
    <div className="panel-content">
      <div className="section-intro">
        <span className="eyebrow">STORY BIBLE</span>
        <h2>이야기의 기준</h2>
        <p>대화 속 제안을 확인하고, 필요한 범위에 적용하세요.</p>
      </div>
      <label className="secondary file-button">
        <Upload size={16} />
        인물·세계관 JSON 가져오기
        <input
          type="file"
          accept=".json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void mutate(
                async () =>
                  api("/branches/" + w.branch.id + "/settings-import", {
                    baseRevision: w.branch.revision,
                    items: JSON.parse(await file.text()),
                  }),
                "설정 제안으로 가져왔습니다. 확인 후 적용하세요.",
              );
          }}
        />
      </label>
      <div className="settings-cards">
        {w.settings
          .filter((s) => s.status !== "retired")
          .map((s) => (
            <button key={s.id} className="setting-card" onClick={() => load(s)}>
              <span className="chip">
                {s.status === "applied"
                  ? "적용됨"
                  : s.status === "held"
                    ? "보류"
                    : "제안"}{" "}
                · v{s.version}
              </span>
              <h3>
                {s.name} {s.locked && <LockKeyhole size={14} />}
              </h3>
              <p>{s.text}</p>
              <small>
                {s.scope === "project"
                  ? "작품 전체"
                  : s.scope === "scene"
                    ? "현재 장면"
                    : "현재 분기"}{" "}
                · {s.aliases.join(", ")}
              </small>
            </button>
          ))}
      </div>
      <form
        className="surface form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save("proposed");
        }}
      >
        <h3>
          {edit ? "설정 변경안 · v" + (edit.version + 1) : "새 설정 기록"}
        </h3>
        <div className="form-grid">
          <Field label="이름">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="인물 이름 또는 설정 제목"
            />
          </Field>
          <Field label="종류">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Setting["kind"])}
            >
              <option value="character">인물</option>
              <option value="world">세계관</option>
              <option value="relationship">방향성 관계</option>
              <option value="rule">작품 규칙</option>
            </select>
          </Field>
        </div>
        <Field label="내용">
          <textarea
            required
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="확정할 내용과 근거를 적어 주세요. 관계는 누구 → 누구인지 명시하세요."
          />
        </Field>
        <div className="form-grid">
          <Field label="별칭 · 쉼표로 구분">
            <input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="이름, 별명"
            />
          </Field>
          <Field label="적용 범위">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Setting["scope"])}
            >
              <option value="branch">현재 분기</option>
              <option value="scene">현재 장면</option>
              <option value="project">작품 전체</option>
            </select>
          </Field>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={locked}
            onChange={(e) => setLocked(e.target.checked)}
          />
          핵심 설정으로 잠금 · 명시적 수정만 허용
        </label>
        <div className="button-row">
          <button className="secondary" type="submit">
            변경안 저장
          </button>
          <button
            className="primary"
            type="button"
            disabled={!name || !text}
            onClick={() => void save("applied")}
          >
            설정 적용 <Check size={16} />
          </button>
          {edit && (
            <button
              type="button"
              className="text-button"
              onClick={() => void save("held")}
            >
              보류
            </button>
          )}
        </div>
      </form>
      <details className="details-box">
        <summary>
          이전 설정 버전 (
          {w.settings.filter((s) => s.status === "retired").length})
        </summary>
        {w.settings
          .filter((s) => s.status === "retired")
          .map((s) => (
            <button className="history-row" key={s.id} onClick={() => load(s)}>
              {s.name} · v{s.version}
              <span>불러와 새 버전으로 수정</span>
            </button>
          ))}
      </details>
    </div>
  );
}
export function MemoryPanel({ w }: { w: Workspace }) {
  const [query, setQuery] = useState(""),
    [ids, setIds] = useState<string[]>(),
    [privateView, setPrivateView] = useState(false);
  useEffect(() => {
    if (!query) {
      setIds(undefined);
      return;
    }
    const t = setTimeout(() => {
      void api<{ memory: { id: string } }[]>(
        "/branches/" + w.branch.id + "/search?q=" + encodeURIComponent(query),
      ).then((items) => setIds(items.map((x) => x.memory.id)));
    }, 200);
    return () => clearTimeout(t);
  }, [query, w.branch.id]);
  const names: Record<string, string> = {
    author: "작가 설정",
    event: "사건",
    speech: "발언",
    knowledge: "지식",
    belief: "믿음",
    inference: "추정",
    plan: "예정",
    state: "임시 상태",
    relationship: "관계",
    entity: "인물·객체",
  };
  const memories = w.memories.filter(
    (m) =>
      (!ids || ids.includes(m.id)) &&
      (privateView || m.visibility === "public"),
  );
  return (
    <div className="panel-content">
      <div className="section-intro">
        <span className="eyebrow">MEMORY</span>
        <h2>기억의 서랍</h2>
        <p>
          확정된 본문의 근거를 따라 기록합니다. 발언과 사실, 예정과 발생을
          구분합니다.
        </p>
      </div>
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label="기억 검색"
          placeholder="인물, 별칭, 약속으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={privateView}
          onChange={(e) => setPrivateView(e.target.checked)}
        />
        작가용 비밀·인물별 지식도 열람
      </label>
      {!memories.length && (
        <Empty title="아직 기록된 기억이 없어요">
          근거가 있는 기억 변경안을 본문과 함께 확정하면 이곳에 쌓입니다.
        </Empty>
      )}
      <div className="memory-list">
        {memories.map((m) => (
          <article className="surface" key={m.id}>
            <div className="button-row">
              <span className="chip">{names[m.kind]}</span>
              <small>
                {m.status === "planned"
                  ? "예정"
                  : m.status === "tentative"
                    ? "미확정"
                    : m.status}{" "}
                ·{" "}
                {m.certainty === "reported"
                  ? "발언·보고"
                  : m.certainty === "inferred"
                    ? "추정"
                    : "명시됨"}
              </small>
            </div>
            <h3>
              {m.subject}
              {m.object ? " → " + m.object : ""}
            </h3>
            <p>{m.text}</p>
            <blockquote>{m.quote}</blockquote>
            <small>
              {m.eventDate && "사건 " + m.eventDate + " · "}
              {m.learnedDate && "인지 " + m.learnedDate + " · "}
              {m.knownBy.length > 0 &&
                "알고 있는 인물: " + m.knownBy.join(", ")}
            </small>
            <details>
              <summary>원본·유효 시기</summary>
              <code>
                {m.sourceCandidateId} · v{m.sourceVersion}
              </code>
              <p>
                {m.validUntil ? "유효 기한: " + m.validUntil : "기한 지정 없음"}
              </p>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
export function StylePanel({
  w,
  mutate,
  onGenerate,
}: {
  w: Workspace;
  mutate: Mutate;
  onGenerate: (input: Partial<GenerateRequest>) => Promise<void>;
}) {
  const [view, setView] = useState<"sources" | "profiles" | "feedback">(
      "sources",
    ),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [source, setSource] = useState<Source>(),
    [range, setRange] = useState({ start: 0, end: 0 }),
    [preference, setPreference] = useState<"like" | "avoid">("like"),
    [tags, setTags] = useState("서술"),
    [sceneTags, setSceneTags] = useState("일상"),
    [note, setNote] = useState(""),
    [profile, setProfile] = useState<Profile>(),
    [profileName, setProfileName] = useState(""),
    [rules, setRules] = useState(""),
    [checked, setChecked] = useState<string[]>([]),
    [feedback, setFeedback] = useState(""),
    [before, setBefore] = useState(""),
    [after, setAfter] = useState(""),
    [feedbackScope, setFeedbackScope] = useState<"scene" | "general">("scene");
  const fileRef = useRef<HTMLInputElement>(null);
  async function file(file?: File) {
    if (!file) return;
    setTitle(file.name.replace(/\.(txt|md)$/i, ""));
    setText(await file.text());
  }
  function editProfile(p: Profile) {
    setProfile(p);
    setProfileName(p.name);
    setRules(
      p.rules
        .map(
          (r) => r.element + " | " + r.text + " | " + r.when + " | " + r.avoid,
        )
        .join("\n"),
    );
    setChecked(p.excerptIds);
    setView("profiles");
  }
  async function saveProfile() {
    await mutate(async () => {
      await api("/projects/" + w.project.id + "/profiles", {
        name: profileName,
        familyId: profile?.familyId,
        excerptIds: checked,
        rules: rules
          .split("\n")
          .filter((x) => x.trim())
          .map((line) => {
            const parts = line.split("|").map((s) => s.trim());
            return {
              element: [
                "all",
                "narration",
                "dialogue",
                "inner",
                "description",
              ].includes(parts[0])
                ? parts[0]
                : "all",
              text: parts[1] || parts[0],
              when: parts[2] || "장면에 맞을 때",
              avoid: parts[3] || "모든 문단에서 반복하지 않는다",
              evidenceIds: checked,
            };
          }),
        analysis: "사용자가 편집한 문체 규칙",
      });
      setProfile(undefined);
      setProfileName("");
      setRules("");
    }, "문체 프로필을 새 버전으로 저장했습니다.");
  }
  return (
    <div className="panel-content">
      <div className="section-intro">
        <span className="eyebrow">STYLE LIBRARY</span>
        <h2>좋아하는 문장의 결</h2>
        <p>
          원문은 그대로 보존하고, 예문과 규칙을 골라 실제 집필에 적용하세요.
        </p>
      </div>
      <div className="segmented">
        <button
          className={view === "sources" ? "selected" : ""}
          onClick={() => setView("sources")}
        >
          원문·예문
        </button>
        <button
          className={view === "profiles" ? "selected" : ""}
          onClick={() => setView("profiles")}
        >
          문체 프로필
        </button>
        <button
          className={view === "feedback" ? "selected" : ""}
          onClick={() => setView("feedback")}
        >
          피드백
        </button>
      </div>
      {view === "sources" && (
        <>
          <div className="source-grid">
            {w.sources.map((s) => (
              <button
                className={"source-card " + (s.excluded ? "excluded" : "")}
                key={s.id}
                onClick={() => {
                  setSource(s);
                  setRange({ start: 0, end: 0 });
                }}
              >
                <BookOpen size={22} />
                <h3>{s.title}</h3>
                <small>
                  v{s.version} · {s.text.length.toLocaleString()}자{" "}
                  {s.excluded ? "· 사용 제외" : ""}
                </small>
              </button>
            ))}
          </div>
          <form
            className="surface form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(async () => {
                await api("/projects/" + w.project.id + "/sources", {
                  title,
                  text,
                });
                setTitle("");
                setText("");
              }, "참고 원문을 보존했습니다.");
            }}
          >
            <div className="section-heading">
              <h3>참고 글 등록</h3>
              <button
                type="button"
                className="text-button"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={16} />
                TXT·Markdown
              </button>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={(e) => void file(e.target.files?.[0])}
              />
            </div>
            <Field label="제목">
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="자료의 이름과 출처"
              />
            </Field>
            <Field label="원문">
              <textarea
                required
                rows={7}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="참고 글이나 직접 쓴 예문을 붙여 넣으세요."
              />
            </Field>
            <button className="primary" type="submit">
              원문 등록 <Plus size={16} />
            </button>
          </form>
          <h3 className="subheading">
            선택한 예문 <span>{w.excerpts.length}</span>
          </h3>
          {w.excerpts.map((e) => (
            <article className="surface excerpt-card" key={e.id}>
              <span className="chip">
                {e.preference === "like" ? "좋아하는 예문" : "피하고 싶은 예문"}{" "}
                {e.excluded ? "· 제외됨" : ""}
              </span>
              <p>{e.text}</p>
              <small>
                {e.tags.join(" · ")} / {e.sceneTags.join(" · ")}
              </small>
              <div className="button-row">
                <button
                  className="text-button"
                  onClick={() =>
                    void mutate(() =>
                      api("/excerpts/" + e.id + "/edit", {
                        preference: e.preference === "like" ? "avoid" : "like",
                      }),
                    )
                  }
                >
                  선호 구분 변경
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    const next = window.prompt(
                      "요소 태그 (쉼표 구분)",
                      e.tags.join(", "),
                    );
                    if (next !== null)
                      void mutate(() =>
                        api("/excerpts/" + e.id + "/edit", {
                          tags: next
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }),
                      );
                  }}
                >
                  분류 수정
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void mutate(() =>
                      api("/excerpts/" + e.id + "/edit", {
                        excluded: !e.excluded,
                      }),
                    )
                  }
                >
                  {e.excluded ? "다시 사용" : "사용 제외"}
                </button>
              </div>
            </article>
          ))}
        </>
      )}
      {view === "profiles" && (
        <>
          <StyleBindings w={w} mutate={mutate} />
          <div className="source-grid">
            {w.profiles.map((p) => (
              <article key={p.id} className="surface">
                <span className="chip">
                  v{p.version} · {p.active ? "현재 버전" : "이전 버전"}
                </span>
                <h3>{p.name}</h3>
                <p>
                  {p.rules
                    .slice(0, 2)
                    .map((r) => r.text)
                    .join(" / ")}
                </p>
                <small>
                  평균 문장 {p.stats.meanSentence}자 · 대사 행{" "}
                  {p.stats.dialogueLineRatio}% (통계)
                </small>
                <div className="button-row">
                  <button
                    className="text-button"
                    onClick={() => editProfile(p)}
                  >
                    규칙 편집
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void mutate(
                        () => api("/profiles/" + p.id + "/restore", {}),
                        "이 버전을 새 버전으로 복원했습니다.",
                      )
                    }
                  >
                    <RotateCcw size={14} />
                    버전 복원
                  </button>
                </div>
                {p.analysis && (
                  <details>
                    <summary>분석·해석</summary>
                    <p>{p.analysis}</p>
                  </details>
                )}
              </article>
            ))}
          </div>
          <form
            className="surface form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile();
            }}
          >
            <h3>{profile ? "프로필 수정 · 새 버전" : "문체 규칙 만들기"}</h3>
            <Field label="프로필 이름">
              <input
                required
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="예: 짧은 대사, 긴 여운"
              />
            </Field>
            <Field
              label="규칙 · 한 줄에 하나"
              hint="요소 | 실행 규칙 | 적용 조건 | 과용 금지 조건. 요소: all, narration, dialogue, inner, description"
            >
              <textarea
                required
                rows={7}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="dialogue | 짧은 대사 뒤 행동으로 반응을 보여 준다 | 대화 장면 | 모든 대사 뒤에 반복하지 않는다"
              />
            </Field>
            <fieldset>
              <legend>근거·참조 예문</legend>
              {w.excerpts
                .filter((e) => !e.excluded)
                .map((e) => (
                  <label className="check-label" key={e.id}>
                    <input
                      type="checkbox"
                      checked={checked.includes(e.id)}
                      onChange={(ev) =>
                        setChecked(
                          ev.target.checked
                            ? [...checked, e.id]
                            : checked.filter((x) => x !== e.id),
                        )
                      }
                    />
                    {e.preference === "avoid" ? "피하기" : "좋아요"} ·{" "}
                    {e.text.slice(0, 70)}
                  </label>
                ))}
            </fieldset>
            <button className="primary" type="submit">
              프로필 저장 <Check size={16} />
            </button>
            <small className="muted">
              문체 프로필과 예문 참조 방식입니다. 모델 가중치 훈련이 아닙니다.
            </small>
          </form>
        </>
      )}
      {view === "feedback" && (
        <>
          <form
            className="surface form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                () =>
                  api("/projects/" + w.project.id + "/feedback", {
                    profileId:
                      profile?.id || w.profiles.find((p) => p.active)?.id,
                    before,
                    after,
                    preference: feedback,
                    scope: feedbackScope,
                  }),
                "선호 후보로 저장했습니다. 일반 규칙은 따로 적용해야 합니다.",
              );
            }}
          >
            <Field label="대상 프로필">
              <select
                value={
                  profile?.id || w.profiles.find((p) => p.active)?.id || ""
                }
                onChange={(e) =>
                  setProfile(w.profiles.find((p) => p.id === e.target.value))
                }
              >
                {w.profiles
                  .filter((p) => p.active)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="수정 전">
                <textarea
                  value={before}
                  onChange={(e) => setBefore(e.target.value)}
                />
              </Field>
              <Field label="직접 수정한 문장">
                <textarea
                  value={after}
                  onChange={(e) => setAfter(e.target.value)}
                />
              </Field>
            </div>
            <Field label="선호·피하고 싶은 표현">
              <textarea
                required
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </Field>
            <Field label="적용 의도">
              <select
                value={feedbackScope}
                onChange={(e) =>
                  setFeedbackScope(e.target.value as "scene" | "general")
                }
              >
                <option value="scene">이 장면만</option>
                <option value="general">일반 선호 후보</option>
              </select>
            </Field>
            <button className="primary" disabled={!w.profiles.length}>
              피드백 저장
            </button>
          </form>
          {w.feedback.map((f) => (
            <article className="surface" key={f.id}>
              <span className="chip">
                {f.scope === "scene" ? "장면 한정" : "일반 선호 후보"} ·{" "}
                {f.applied ? "적용됨" : "미적용"}
              </span>
              <p>{f.preference}</p>
              {f.before && <del>{f.before}</del>}
              {f.after && <p>{f.after}</p>}
              {f.scope === "general" && !f.applied && (
                <button
                  className="secondary"
                  onClick={() =>
                    void mutate(() => api("/feedback/" + f.id + "/apply", {}))
                  }
                >
                  일반 규칙으로 적용
                </button>
              )}
            </article>
          ))}
        </>
      )}
      {source && (
        <Modal
          title={source.title + " · v" + source.version}
          wide
          onClose={() => setSource(undefined)}
        >
          <p className="muted">
            분석할 구간을 드래그해 선택하세요. 대사와 앞뒤 반응을 함께 담는
            구간을 권합니다.
          </p>
          <textarea
            className="source-original"
            aria-label="원문 구간 선택"
            readOnly
            value={source.text}
            onSelect={(e) =>
              setRange({
                start: e.currentTarget.selectionStart,
                end: e.currentTarget.selectionEnd,
              })
            }
          />
          <p className="selection-status">
            선택: {range.start}–{range.end} · {range.end - range.start}자
          </p>
          <div className="form-grid">
            <Field label="예문 선호">
              <select
                value={preference}
                onChange={(e) =>
                  setPreference(e.target.value as "like" | "avoid")
                }
              >
                <option value="like">좋아하는 예문</option>
                <option value="avoid">피하고 싶은 예문</option>
              </select>
            </Field>
            <Field label="요소 태그">
              <input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
            <Field label="장면 유형">
              <input
                value={sceneTags}
                onChange={(e) => setSceneTags(e.target.value)}
              />
            </Field>
            <Field label="메모">
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <div className="button-row">
            <button
              className="primary"
              disabled={range.start === range.end}
              onClick={() =>
                void mutate(
                  () =>
                    api("/projects/" + w.project.id + "/excerpts", {
                      sourceId: source.id,
                      ...range,
                      preference,
                      tags: tags.split(",").map((s) => s.trim()),
                      sceneTags: sceneTags.split(",").map((s) => s.trim()),
                      note,
                    }),
                  "선택 구간을 예문으로 저장했습니다.",
                )
              }
            >
              선택 구간 저장
            </button>
            <button
              className="secondary"
              onClick={() => {
                void onGenerate({
                  mode: "analyze",
                  channel: "settings",
                  sourceId: source.id,
                  input:
                    "이 참고 원문을 분석하고 근거가 있는 문체 프로필을 만들어 주세요.",
                });
                setSource(undefined);
              }}
            >
              선택한 연결로 문체 분석
            </button>
            <button
              className="text-button"
              onClick={() => {
                void mutate(() =>
                  api("/sources/" + source.id + "/exclude", {
                    excluded: !source.excluded,
                  }),
                );
                setSource(undefined);
              }}
            >
              {source.excluded ? "자료 다시 사용" : "자료 사용 제외"}
            </button>
            <button
              className="text-button"
              onClick={async () => {
                const next = window.prompt(
                  "새 원문을 붙여 넣으세요. 기존 버전은 보존됩니다.",
                  source.text,
                );
                if (next !== null)
                  await mutate(() =>
                    api("/projects/" + w.project.id + "/sources", {
                      title: source.title,
                      text: next,
                      previousId: source.id,
                    }),
                  );
                setSource(undefined);
              }}
            >
              새 버전으로 교체
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function StyleBindings({ w, mutate }: { w: Workspace; mutate: Mutate }) {
  const [target, setTarget] = useState("work"),
    [subject, setSubject] = useState(""),
    [element, setElement] = useState("all"),
    [family, setFamily] = useState("");
  const names: Record<string, string> = {
    work: "작품 공통",
    pov: "시점 인물",
    character: "등장인물 말투",
    scene: "장면 유형",
  };
  return (
    <details className="details-box">
      <summary>인물·장면별 문체 자동 연결 ({w.bindings?.length ?? 0})</summary>
      <p className="muted">
        문체 적용을 켜면 등록된 조건과 해당 프로필의 현재 버전을 생성 입력에
        함께 전달합니다. 진행 중 작업은 기존 버전을 유지합니다.
      </p>
      {(w.bindings ?? []).map((b) => (
        <div className="history-row" key={b.id}>
          <span>
            {names[b.target]} · {b.subject || "전체"} · {b.element} →{" "}
            {
              w.profiles.find(
                (p) => p.familyId === b.profileFamilyId && p.active,
              )?.name
            }
          </span>
          <button
            className="text-button"
            onClick={() =>
              void mutate(() =>
                api("/projects/" + w.project.id + "/style-bindings", {
                  ...b,
                  enabled: !b.enabled,
                }),
              )
            }
          >
            {b.enabled ? "연결 해제" : "다시 연결"}
          </button>
        </div>
      ))}
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(
            () =>
              api("/projects/" + w.project.id + "/style-bindings", {
                target,
                subject,
                element,
                profileFamilyId: family,
              }),
            "조건별 문체 연결을 저장했습니다.",
          );
        }}
      >
        <div className="form-grid">
          <Field label="연결 대상">
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {Object.entries(names).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="인물 이름·장면 조건">
            <input
              value={subject}
              disabled={target === "work"}
              required={target !== "work"}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="민서 / 조용한 일상 / 말다툼"
            />
          </Field>
          <Field label="문체 요소">
            <select
              value={element}
              onChange={(e) => setElement(e.target.value)}
            >
              {["all", "narration", "dialogue", "inner", "description"].map(
                (key, i) => (
                  <option key={key} value={key}>
                    {["전체", "서술", "대사", "내면", "묘사"][i]}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="연결 프로필">
            <select
              required
              value={family}
              onChange={(e) => setFamily(e.target.value)}
            >
              <option value="">프로필 선택</option>
              {w.profiles
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.familyId} value={p.familyId}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <button className="secondary" disabled={!family}>
          조건별 문체 연결 저장
        </button>
      </form>
    </details>
  );
}
export function ConnectionsPanel() {
  const [providers, setProviders] = useState<Record<string, any>[]>([]),
    [error, setError] = useState("");
  const load = () => {
    setError("");
    void api<Record<string, any>[]>("/providers")
      .then(setProviders)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);
  return (
    <div className="panel-content">
      <div className="section-intro">
        <span className="eyebrow">CONNECTIONS</span>
        <h2>어떤 목소리로 쓸까요</h2>
        <p>
          본문·추출·검수에는 입력창에서 선택한 연결을 사용합니다. 다른 유료
          연결로 자동 전환하지 않습니다.
        </p>
      </div>
      <button className="secondary" onClick={load}>
        <RotateCcw size={16} />
        연결 진단 새로고침
      </button>
      {error && <p role="alert">{error}</p>}
      <div className="connection-grid">
        {providers.map((p) => (
          <article className="surface connection-card" key={p.id}>
            <span
              className={
                "status-dot " +
                (p.authenticated || p.configured ? "connected" : "")
              }
            />
            <h3>{p.name}</h3>
            <span className="chip">{p.status}</span>
            <p>{p.billing}</p>
            {p.version && <small>{p.version}</small>}
            {p.limitation && <p className="muted">{p.limitation}</p>}
          </article>
        ))}
      </div>
      <div className="surface">
        <h3>서버에서 연결 준비</h3>
        <p>
          API 키는 개인 PC의 <code>.env</code>에 설정합니다. 브라우저에는 키를
          저장하지 않습니다.
        </p>
        <pre>NOVEL_OPENAI_API_KEY=…{"\n"}NOVEL_GEMINI_API_KEY=…</pre>
        <p>
          CLI는 같은 PC에서 설치·로그인 후 사용하세요. 모델은 실제 계정에서
          지원하는 이름을 입력합니다. Codex의 <code>default</code>는 CLI 기본
          모델을 사용합니다.
        </p>
        <p className="muted">
          설치·로그인 확인은 실제 생성 성공과 다릅니다. 생성 결과와 사용량은
          작업 기록에서 확인할 수 있습니다. 비용을 알 수 없으면 ‘미상’으로
          남깁니다.
        </p>
      </div>
    </div>
  );
}
export function BackupPanel({
  w,
  mutate,
  onRestored,
}: {
  w: Workspace;
  mutate: Mutate;
  onRestored: (projectId: string) => Promise<void>;
}) {
  const [text, setText] = useState(""),
    [body, setBody] = useState(""),
    [preview, setPreview] = useState<{ raw: string; kind: string }[]>(),
    [include, setInclude] = useState(true),
    [full, setFull] = useState(false);
  return (
    <div className="panel-content">
      <div className="section-intro">
        <span className="eyebrow">YOUR WORDS, YOUR FILES</span>
        <h2>이야기를 안전하게</h2>
        <p>작품의 원문과 버전, 기억, 문체 자료를 함께 보관하세요.</p>
      </div>
      <div className="surface form-stack">
        <h3>전체 백업</h3>
        <p>
          모든 분기와 미확정 후보를 포함합니다. 인증정보는 포함하지 않습니다.
        </p>
        <div className="button-row">
          <button
            className="primary"
            onClick={() =>
              void mutate(async () =>
                download(
                  w.project.title + "-백업.json",
                  JSON.stringify(
                    await api("/projects/" + w.project.id + "/backup"),
                    null,
                    2,
                  ),
                  "application/json",
                ),
              )
            }
          >
            <Download size={16} />
            백업 저장
          </button>
          <label className="secondary file-button">
            <Upload size={16} />
            백업 복원
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void mutate(async () => {
                    const p = await api<{ id: string }>(
                      "/backup/restore",
                      JSON.parse(await f.text()),
                    );
                    await onRestored(p.id);
                  }, "무결성을 확인하고 새 작품으로 복원했습니다.");
              }}
            />
          </label>
        </div>
        <small>기존 작품을 덮어쓰지 않고 별도 작품으로 복원합니다.</small>
      </div>
      <div className="surface form-stack">
        <h3>원고 내보내기</h3>
        <label className="check-label">
          <input
            type="checkbox"
            checked={include}
            onChange={(e) => setInclude(e.target.checked)}
          />
          최신 미확정 후보 포함 · 표시하여 구분
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
          />
          상태·SNS·점검·선택지를 포함한 여섯 영역
        </label>
        <div className="button-row">
          {["txt", "md"].map((ext) => (
            <button
              className="secondary"
              key={ext}
              onClick={() =>
                void mutate(async () =>
                  download(
                    w.project.title + "." + ext,
                    await apiText(
                      "/branches/" +
                        w.branch.id +
                        "/export?candidate=" +
                        include +
                        "&full=" +
                        full,
                    ),
                  ),
                )
              }
            >
              {ext.toUpperCase()} 저장
            </button>
          ))}
        </div>
      </div>
      <form
        className="surface form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(
            () =>
              api("/branches/" + w.branch.id + "/import", {
                text,
                body,
                baseRevision: w.branch.revision,
              }),
            "원문을 보존하고 미확정 후보로 가져왔습니다.",
          );
        }}
      >
        <div className="section-heading">
          <h3>이전 글 가져오기</h3>
          <label className="text-button file-button">
            <Upload size={16} />
            TXT·Markdown
            <input
              type="file"
              accept=".txt,.md"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void f.text().then((t) => {
                    setText(t);
                    setBody(t);
                  });
              }}
            />
          </label>
        </div>
        <Field label="가져온 원문">
          <textarea
            required
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setBody(e.target.value);
            }}
          />
        </Field>
        <button
          type="button"
          className="secondary"
          disabled={!text}
          onClick={() =>
            void mutate(async () => {
              const p = await api<{
                sections: { raw: string; kind: string }[];
              }>("/import/preview", { text });
              setPreview(p.sections);
            })
          }
        >
          본문·메타·OOC 구분 미리보기
        </button>
        {preview && (
          <div className="import-preview">
            {preview.map((p, i) => (
              <div key={i}>
                <span className="chip">{p.kind} · 분류 제안</span>
                <p>{p.raw}</p>
              </div>
            ))}
          </div>
        )}
        <Field
          label="본문으로 가져올 내용"
          hint="자동 분류는 제안입니다. 원문은 별도로 보존됩니다."
        >
          <textarea
            required
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <button className="primary" type="submit">
          미확정 후보로 가져오기
        </button>
      </form>
    </div>
  );
}
export function LabPanel({
  w,
  onGenerate,
  mutate,
}: {
  w: Workspace;
  onGenerate: (patch: Partial<GenerateRequest>) => Promise<void>;
  mutate: Mutate;
}) {
  const [outline, setOutline] = useState(""),
    [a, setA] = useState(""),
    [b, setB] = useState(""),
    [blind, setBlind] = useState(true),
    [revealed, setRevealed] = useState(false);
  const jobs = w.jobs.filter((j) => j.request.mode === "lab"),
    candidates = w.candidates.filter((c) => c.mode === "lab");
  const profileSelect = (
    label: string,
    value: string,
    set: (s: string) => void,
  ) => (
    <Field label={label}>
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">문체 적용 끔</option>
        {w.profiles
          .filter((p) => p.active)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · v{p.version}
            </option>
          ))}
      </select>
    </Field>
  );
  return (
    <div className="panel-content">
      <div className="section-intro">
        <span className="eyebrow">STYLE LAB</span>
        <h2>같은 장면, 다른 호흡</h2>
        <p>
          현재 분기·모델·분량 목표를 고정해 비교합니다. 실험은 정본과 기억을
          바꾸지 않습니다.
        </p>
      </div>
      <form
        className="surface form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          setRevealed(false);
          const group = crypto.randomUUID();
          void (async () => {
            await onGenerate({
              mode: "lab",
              channel: "story",
              input: outline,
              labGroup: group,
              blind,
              style: {
                mode: a ? "examples" : "off",
                profileIds: a ? [a] : [],
                strength: "normal",
                elementProfiles: {},
              },
            });
            await onGenerate({
              mode: "lab",
              channel: "story",
              input: outline,
              labGroup: group,
              blind,
              style: {
                mode: b ? "examples" : "off",
                profileIds: b ? [b] : [],
                strength: "normal",
                elementProfiles: {},
              },
            });
          })();
        }}
      >
        <Field label="공통 사건 개요">
          <textarea
            required
            rows={5}
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
            placeholder="일어난 사실과 발화 의도를 적어 주세요."
          />
        </Field>
        <div className="form-grid">
          {profileSelect("A의 문체", a, setA)}
          {profileSelect("B의 문체", b, setB)}
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={blind}
            onChange={(e) => setBlind(e.target.checked)}
          />
          결과의 프로필 이름을 가리고 비교
        </label>
        <button className="primary" disabled={!outline}>
          <FlaskConical size={16} />두 후보 생성 · 선택한 연결 2회 실행
        </button>
      </form>
      {blind && candidates.length > 0 && (
        <button className="text-button" onClick={() => setRevealed(!revealed)}>
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}프로필 이름{" "}
          {revealed ? "가리기" : "공개"}
        </button>
      )}
      <div className="lab-grid">
        {candidates.map((c, index) => {
          const job = jobs.find((j) => j.candidateId === c.id);
          return (
            <article className="surface" key={c.id}>
              <span className="eyebrow">후보 {index % 2 ? "B" : "A"}</span>
              <h3>
                {blind && !revealed
                  ? "이름을 가린 문체"
                  : c.context.profiles
                      .map((p) => p.name + " v" + p.version)
                      .join(", ") || "문체 적용 끔"}
              </h3>
              <p className="prose">{c.output.body}</p>
              <small>
                기준 v{c.baseRevision} · {job?.request.model} · 목표{" "}
                {job?.request.targetLength}자
              </small>
              <details>
                <summary>사용 예문·규칙·점검</summary>
                <pre>
                  {JSON.stringify(
                    {
                      profiles: c.context.profiles,
                      excerpts: c.context.excerpts,
                      checks: c.checks,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() =>
                    void mutate(
                      () => api("/candidates/" + c.id + "/import-lab", {}),
                      "현재 분기 기준을 확인하고 본문 후보로 가져왔습니다.",
                    )
                  }
                >
                  본문 후보로 가져오기
                </button>
                {c.context.profiles[0] && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void mutate(
                        () =>
                          api("/projects/" + w.project.id + "/feedback", {
                            profileId: c.context.profiles[0].id,
                            before: "",
                            after: c.output.body,
                            preference: "A/B 비교에서 이 후보를 선호함",
                            scope: "scene",
                          }),
                        "장면 한정 선호로 저장했습니다.",
                      )
                    }
                  >
                    이 후보 선호
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!candidates.length && (
        <Empty title="문체를 천천히 비교해 보세요">
          서술 거리, 대사의 리듬, 의미 보존을 직접 살펴보세요. 자동 문체
          일치율은 사용하지 않습니다.
        </Empty>
      )}
    </div>
  );
}
