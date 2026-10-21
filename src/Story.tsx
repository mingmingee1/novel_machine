import { useState } from "react";
import {
  Check,
  GitBranch,
  LockKeyhole,
  Pencil,
  RotateCcw,
  FileSearch,
  Archive,
  Unlock,
  ChevronDown,
} from "lucide-react";
import type { Candidate, Workspace } from "../shared/domain";
import { characterCount, dateLabel } from "../shared/domain";
import { api } from "./api";
import { Field, Modal } from "./ui";
import type { Mutate, ReaderSettings } from "./panels";
export function StoryCard({
  candidate: c,
  w,
  reader,
  mutate,
  onFork,
  onChoice,
  onRewrite,
}: {
  candidate: Candidate;
  w: Workspace;
  reader: ReaderSettings;
  mutate: Mutate;
  onFork: (revision: number) => void;
  onChoice: (text: string) => void;
  onRewrite: () => void;
}) {
  const [edit, setEdit] = useState(false),
    [body, setBody] = useState(c.output.body),
    [metadata, setMetadata] = useState(""),
    [provenance, setProvenance] = useState(false),
    [compare, setCompare] = useState(false);
  const previous = w.candidates.find((p) => p.id === c.sourceId),
    stale = c.baseRevision !== w.branch.revision && c.status !== "accepted";
  const publicMemories = c.output.memories.filter(
    (m) => m.visibility === "public",
  );
  function startEdit() {
    setBody(c.output.body);
    setMetadata(JSON.stringify({ ...c.output, body: undefined }, null, 2));
    setEdit(true);
  }
  return (
    <article
      className={"story-card " + (c.status === "draft" ? "draft-card" : "")}
      data-candidate={c.id}
    >
      <div className="story-meta">
        <span className="eyebrow">SCENE {String(c.turn).padStart(2, "0")}</span>
        <span className={"chip " + (c.status === "accepted" ? "accepted" : "")}>
          {c.status === "accepted"
            ? "확정 본문"
            : c.status === "discarded"
              ? "보관된 후보"
              : "미확정 후보"}{" "}
          · v{c.version}
        </span>
        <span className="character-count">
          {characterCount(c.output.body).toLocaleString()}자{" "}
          <small>공백 포함</small>
        </span>
      </div>
      <div className="scene-location">
        <span>📍</span>
        <div>
          <strong>
            {dateLabel(c.output.scene.date)}{" "}
            {c.output.scene.time && "· " + c.output.scene.time}
          </strong>
          <p>
            {c.output.scene.place || "장소 미정"}{" "}
            {c.output.scene.pov && "· " + c.output.scene.pov + " 시점"}
          </p>
        </div>
      </div>
      <h3 className="sr-only">📖 본문</h3>
      <div className="story-prose">
        {c.output.body.split("\n\n").map((paragraph, index) => (
          <div
            className="paragraph-row"
            key={index}
            data-paragraph={c.id + "-" + index}
          >
            <p>{paragraph}</p>
            {c.status === "draft" && (
              <button
                className={
                  "paragraph-lock " + (c.locks.includes(index) ? "locked" : "")
                }
                aria-label={
                  (c.locks.includes(index) ? "잠금 해제" : "문단 잠금") +
                  " " +
                  (index + 1)
                }
                title={c.locks.includes(index) ? "잠금 해제" : "문단 잠금"}
                onClick={() =>
                  void mutate(() =>
                    api("/candidates/" + c.id + "/edit", {
                      body: c.output.body,
                      baseRevision: w.branch.revision,
                      locks: c.locks.includes(index)
                        ? c.locks.filter((i) => i !== index)
                        : [...c.locks, index],
                    }),
                  )
                }
              >
                {c.locks.includes(index) ? (
                  <LockKeyhole size={13} />
                ) : (
                  <Unlock size={13} />
                )}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="story-secondary">
        <details open={!reader.collapsed}>
          <summary>
            📊 스테이터스 + 해야 할 일 <span>{publicMemories.length}</span>
          </summary>
          {publicMemories.length ? (
            publicMemories.map((m, i) => (
              <p key={i}>
                <strong>{m.subject}</strong> {m.text}{" "}
                <small>
                  {m.status === "planned"
                    ? "예정"
                    : m.kind === "speech"
                      ? "발언"
                      : m.kind === "inference"
                        ? "추정"
                        : ""}
                </small>
              </p>
            ))
          ) : (
            <p className="muted">근거가 있는 상태 변경안이 없습니다.</p>
          )}
        </details>
        <details open={!reader.collapsed}>
          <summary>
            📱 SNS 현황 <span>{c.output.sns.length}</span>
          </summary>
          {c.output.sns.length ? (
            c.output.sns.map((s, i) => (
              <p key={i}>
                {s.sender} → {s.recipient}: {s.text}{" "}
                <span className="chip">
                  {
                    {
                      draft: "작성",
                      sent: "전송",
                      received: "수신",
                      read: "읽음",
                    }[s.status]
                  }
                </span>
              </p>
            ))
          ) : (
            <p className="muted">새로운 SNS 변화가 없습니다.</p>
          )}
        </details>
        <details
          open={c.checks.some((x) => x.level === "hard") || !reader.collapsed}
        >
          <summary>
            🧬 문체 로직 / 설정 붕괴 점검 <span>{c.checks.length}</span>
          </summary>
          {c.checks.length ? (
            c.checks.map((check, i) => (
              <p className={"check-item " + check.level} key={i}>
                <span className="chip">
                  {check.level === "hard"
                    ? "확정 차단"
                    : check.level === "semantic"
                      ? "검토 필요"
                      : "문체 의견"}
                </span>{" "}
                {check.message}
                {check.quote && <q>{check.quote}</q>}
              </p>
            ))
          ) : (
            <p className="muted">
              자동 점검에서 충돌을 찾지 못했습니다. 의미·문학적 품질까지
              보장하지는 않습니다.
            </p>
          )}
          {c.status === "draft" &&
            !c.reviewed &&
            !c.checks.some((x) => x.level === "hard") && (
              <button
                className="secondary"
                onClick={() =>
                  void mutate(
                    () => api("/candidates/" + c.id + "/review", {}),
                    "변경안을 검토한 후보로 표시했습니다.",
                  )
                }
              >
                본문과 변경안 검토 완료
              </button>
            )}
        </details>
      </div>
      {c.status === "draft" && !stale && c.output.choices.length > 0 && (
        <div className="choices">
          <h4>🎮 다음 행동</h4>
          {c.output.choices.map((choice, i) => (
            <button
              key={i}
              disabled={!c.reviewed}
              onClick={() => onChoice(choice)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {choice}
              <ChevronDown size={16} />
            </button>
          ))}
          <small>다른 행동은 아래 입력창에 자유롭게 적어 주세요.</small>
        </div>
      )}
      {stale && (
        <p className="notice">
          이 후보의 기준 버전이 현재 분기와 다릅니다. 원문은 보존되어 있으며,
          이전 시점에서 분기해 사용할 수 있습니다.
        </p>
      )}
      <footer className="story-actions">
        {c.status === "draft" && !stale && (
          <>
            <button
              className="primary small"
              disabled={!c.reviewed || c.checks.some((x) => x.level === "hard")}
              onClick={() =>
                void mutate(
                  () =>
                    api("/candidates/" + c.id + "/commit", {
                      baseRevision: w.branch.revision,
                    }),
                  "본문과 기억을 함께 확정했습니다.",
                )
              }
            >
              <Check size={15} />이 장면 확정
            </button>
            <button className="text-button" onClick={startEdit}>
              <Pencil size={15} />
              직접 편집
            </button>
            <button className="text-button" onClick={onRewrite}>
              <RotateCcw size={15} />
              재작성
            </button>
            <button
              className="text-button"
              onClick={() =>
                void mutate(
                  () => api("/candidates/" + c.id + "/discard", {}),
                  "후보를 보관했습니다. 정본에는 반영하지 않았습니다.",
                )
              }
            >
              <Archive size={15} />
              보관
            </button>
          </>
        )}
        {c.status === "accepted" && (
          <button
            className="text-button"
            onClick={() =>
              void mutate(async () => {
                const impact = await api<{
                  forkRevision: number;
                  candidateIds: string[];
                  memoryIds: string[];
                }>("/candidates/" + c.id + "/impacts");
                if (
                  window.confirm(
                    "이 장면부터 " +
                      impact.candidateIds.length +
                      "개 장면과 " +
                      impact.memoryIds.length +
                      "개 기억이 영향을 받습니다. 기존 본편을 보존하고 새 분기에서 수정합니다.",
                  )
                )
                  onFork(impact.forkRevision);
              })
            }
          >
            <GitBranch size={15} />이 장면 전에서 분기
          </button>
        )}
        <button className="text-button" onClick={() => setProvenance(true)}>
          <FileSearch size={15} />
          사용 근거
        </button>
        {previous && (
          <button className="text-button" onClick={() => setCompare(true)}>
            이전 버전과 비교
          </button>
        )}
      </footer>
      {edit && (
        <Modal
          title="본문 직접 편집 · 새 후보로 저장"
          wide
          onClose={() => setEdit(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(async () => {
                await api("/candidates/" + c.id + "/edit", {
                  body,
                  baseRevision: w.branch.revision,
                  output: { ...JSON.parse(metadata), body },
                });
                setEdit(false);
              }, "원문을 보존하고 새 후보를 저장했습니다.");
            }}
          >
            <Field label="본문">
              <textarea
                rows={18}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <details className="details-box">
              <summary>장면·기억·SNS 변경안 편집</summary>
              <p className="muted">
                근거 quote는 본문에 실제로 있어야 합니다. 알 수 없는 변경안은
                제거하고 빈 배열로 보존할 수 있습니다.
              </p>
              <textarea
                aria-label="변경안 JSON"
                rows={15}
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
              />
            </details>
            <button className="primary">새 후보 저장</button>
          </form>
        </Modal>
      )}
      {provenance && (
        <Modal
          title="이번 생성에 사용한 근거"
          wide
          onClose={() => setProvenance(false)}
        >
          <p className="muted">
            기준 분기 v{c.context.revision} · 추정{" "}
            {c.context.estimatedTokens.toLocaleString()} 토큰 / 예산{" "}
            {c.context.budget.toLocaleString()}. 실제 연결 입력은 이 고정본을
            사용합니다.
          </p>
          {c.context.notes.map((n, i) => (
            <p className="notice" key={i}>
              {n}
            </p>
          ))}
          <pre>
            {JSON.stringify(
              {
                settings: c.context.settings,
                memories: c.context.memories,
                recent: c.context.recent,
                profiles: c.context.profiles,
                bindings: c.context.bindings,
                excerpts: c.context.excerpts,
                style: c.context.style,
              },
              null,
              2,
            )}
          </pre>
        </Modal>
      )}
      {compare && previous && (
        <Modal
          title="전후 비교 · 원문은 보존됩니다"
          wide
          onClose={() => setCompare(false)}
        >
          <div className="compare-grid">
            <div>
              <h3>이전 v{previous.version}</h3>
              <p className="prose">{previous.output.body}</p>
            </div>
            <div>
              <h3>현재 v{c.version}</h3>
              <p className="prose">{c.output.body}</p>
            </div>
          </div>
          <details>
            <summary>사실·장면 변경안 비교</summary>
            <pre>
              {JSON.stringify(
                {
                  before: {
                    scene: previous.output.scene,
                    memories: previous.output.memories,
                  },
                  after: { scene: c.output.scene, memories: c.output.memories },
                },
                null,
                2,
              )}
            </pre>
          </details>
          <button
            className="secondary"
            onClick={() =>
              void mutate(async () => {
                await api("/candidates/" + previous.id + "/restore", {});
                setCompare(false);
              })
            }
          >
            이전 후보 복원
          </button>
        </Modal>
      )}
    </article>
  );
}
