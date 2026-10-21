import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CloudOff,
  Feather,
  FileClock,
  FlaskConical,
  FolderArchive,
  GitBranch,
  LibraryBig,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Wifi,
  X,
} from "lucide-react";
import type {
  Branch,
  Candidate,
  GenerateRequest,
  Job,
  Project,
  Workspace,
} from "../shared/domain";
import { api, cacheGet, cachePut, connect, saveLocal, stored } from "./api";
import {
  BackupPanel,
  ConnectionsPanel,
  defaultReader,
  LabPanel,
  MemoryPanel,
  ReaderPanel,
  SettingsPanel,
  StylePanel,
  type ReaderSettings,
} from "./panels";
import { Busy, Empty, Field, Modal } from "./ui";
import { StoryCard } from "./Story";

type View = "write" | "memory" | "style" | "lab" | "connections" | "backup";
const channelNames = { story: "소설", settings: "설정", ooc: "OOC" };
export function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [w, setW] = useState<Workspace>(),
    [view, setView] = useState<View>("write"),
    [channel, setChannel] = useState<GenerateRequest["channel"]>("story");
  const [reader, setReader] = useState<ReaderSettings>(() =>
      stored("novel-reader", defaultReader),
    ),
    [readerOpen, setReaderOpen] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [newProject, setNewProject] = useState(false),
    [newTitle, setNewTitle] = useState(""),
    [newDescription, setNewDescription] = useState("");
  const [input, setInput] = useState(""),
    [mode, setMode] = useState<GenerateRequest["mode"]>("continue"),
    [provider, setProvider] = useState<GenerateRequest["provider"]>(() =>
      stored("novel-provider", "codex"),
    ),
    [model, setModel] = useState(() => stored("novel-model", "default"));
  const [style, setStyle] = useState<GenerateRequest["style"]>(() => ({
      mode: "off",
      profileIds: [],
      strength: "normal",
      elementProfiles: {},
    })),
    [targetLength, setTargetLength] = useState(1500),
    [budget, setBudget] = useState(24000),
    [range, setRange] = useState({ start: 0, end: 0 }),
    [allowMeaning, setAllowMeaning] = useState(false),
    [scope, setScope] =
      useState<GenerateRequest["instructionsScope"]>("generation"),
    [participation, setParticipation] = useState<"author" | "character">(
      "author",
    ),
    [controlled, setControlled] = useState("");
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine),
    [needsPassword, setNeedsPassword] = useState(false),
    [password, setPassword] = useState("");
  const [jobsOpen, setJobsOpen] = useState(false),
    [archiveOpen, setArchiveOpen] = useState(false),
    [forkRevision, setForkRevision] = useState<number>(),
    [forkSource, setForkSource] = useState<string>(),
    [forkName, setForkName] = useState("다른 길"),
    [limit, setLimit] = useState(15),
    [showLatest, setShowLatest] = useState(false);
  const scroller = useRef<HTMLDivElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    nearBottom = useRef(true),
    draftKey = useRef(""),
    requestKey = useRef<string | null>(null),
    branchRef = useRef("");
  const latest = w?.candidates
    .filter(
      (c) =>
        c.status === "draft" &&
        c.mode !== "lab" &&
        c.baseRevision === w.branch.revision,
    )
    .at(-1);
  const active = w?.jobs.find((j) => ["running", "queued"].includes(j.status));
  const selectedBranch = stored<string>("novel-branch", "");
  async function loadBranch(branchId: string) {
    const data = await api<Workspace>("/branches/" + branchId);
    setW(data);
    branchRef.current = branchId;
    saveLocal("novel-branch", branchId);
    void cachePut("workspace", data);
    setOffline(false);
  }
  async function refresh() {
    if (branchRef.current) await loadBranch(branchRef.current);
    const list = await api<Project[]>("/projects");
    setProjects(list);
    void cachePut("projects", list);
  }
  async function openProject(projectId: string) {
    const branches = await api<Branch[]>(
      "/projects/" + projectId + "/branches",
    );
    if (branches[0]) await loadBranch(branches[0].id);
    setView("write");
    setSidebar(false);
  }
  async function initialize(pass = "") {
    try {
      await connect(pass);
      setNeedsPassword(false);
      const list = await api<Project[]>("/projects");
      setProjects(list);
      void cachePut("projects", list);
      if (list.length) {
        if (selectedBranch) {
          try {
            await loadBranch(selectedBranch);
            return;
          } catch {}
        }
        await openProject(list[0].id);
      }
      setOffline(false);
    } catch (e) {
      if (e instanceof Error && "status" in e && e.status === 401) {
        setNeedsPassword(true);
        return;
      }
      setOffline(true);
      const cached = await cacheGet<Workspace>("workspace");
      if (cached) {
        setW(cached);
        branchRef.current = cached.branch.id;
      }
      setProjects((await cacheGet<Project[]>("projects")) ?? []);
    }
  }
  useEffect(() => {
    void initialize();
    const off = () => setOffline(true),
      on = () => void initialize();
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  useEffect(() => {
    saveLocal("novel-reader", reader);
    document.documentElement.dataset.theme = reader.theme;
  }, [reader]);
  useEffect(() => {
    saveLocal("novel-provider", provider);
    saveLocal("novel-model", model);
  }, [provider, model]);
  useEffect(() => {
    if (!w) return;
    const key = "novel-draft-" + w.branch.id + "-" + channel;
    draftKey.current = key;
    setInput(stored<{ text: string }>(key, { text: "" }).text);
    requestKey.current = null;
    setStyle(
      stored("novel-style-" + w.project.id, {
        mode: "off",
        profileIds: [],
        strength: "normal",
        elementProfiles: {},
      }),
    );
  }, [w?.branch.id, channel]);
  useEffect(() => {
    if (w) saveLocal("novel-style-" + w.project.id, style);
  }, [style, w?.project.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!active || offline) return;
    const stream = new EventSource("/api/jobs/" + active.id + "/events");
    const update = () => {
      void refresh().catch(() => setOffline(true));
    };
    let deltaTimer: ReturnType<typeof setTimeout> | undefined;
    stream.addEventListener("status", update);
    stream.addEventListener("delta", () => {
      if (!deltaTimer)
        deltaTimer = setTimeout(() => {
          deltaTimer = undefined;
          void api<Job>("/jobs/" + active.id)
            .then((job) => {
              if (!["running", "queued"].includes(job.status)) void refresh();
              else
                setW((previous) =>
                  previous
                    ? {
                        ...previous,
                        jobs: previous.jobs.map((j) =>
                          j.id === job.id ? job : j,
                        ),
                      }
                    : previous,
                );
            })
            .catch(() => {});
        }, 120);
      if (nearBottom.current) bottom.current?.scrollIntoView({ block: "end" });
      else setShowLatest(true);
    });
    stream.addEventListener("done", () => {
      stream.close();
      update();
    });
    stream.onerror = () => {
      stream.close();
      void refresh().catch(() => setOffline(true));
    };
    const fallback = setInterval(update, 2500);
    return () => {
      stream.close();
      clearInterval(fallback);
      if (deltaTimer) clearTimeout(deltaTimer);
    };
  }, [active?.id, offline]);
  useEffect(() => {
    if (nearBottom.current) bottom.current?.scrollIntoView({ block: "end" });
    else setShowLatest(true);
  }, [w?.candidates.length, w?.messages.length]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !w) return;
    const saved = stored<{ id: string; offset: number } | null>(
      "novel-position-" + w.branch.id,
      null,
    );
    if (saved)
      requestAnimationFrame(() => {
        const p = el.querySelector<HTMLElement>(
          '[data-paragraph="' + saved.id + '"]',
        );
        if (p)
          el.scrollTop +=
            p.getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            saved.offset;
      });
  }, [w?.branch.id]);
  async function mutate(fn: () => Promise<unknown>, message?: string) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (message) setToast(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "작업에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  function editInput(text: string) {
    setInput(text);
    requestKey.current = null;
    if (w)
      saveLocal(draftKey.current, { text, baseRevision: w.branch.revision });
  }
  async function generate(patch: Partial<GenerateRequest> = {}) {
    if (!w) {
      setNewProject(true);
      return;
    }
    if (offline) {
      setError("오프라인에서는 초안만 저장됩니다. 연결 후 직접 전송해 주세요.");
      return;
    }
    const draft = stored<{ baseRevision: number }>(draftKey.current, {
      baseRevision: w.branch.revision,
    });
    if (!patch.input && input && draft.baseRevision !== w.branch.revision) {
      setError(
        "초안을 작성한 뒤 분기가 변경됐습니다. 현재 장면을 확인하고 입력을 수정한 뒤 전송하세요.",
      );
      return;
    }
    const actualMode = patch.mode ?? (channel === "story" ? mode : "discuss");
    const text = patch.input ?? input;
    if (!text.trim()) {
      composer.current?.focus();
      return;
    }
    const key = patch.input
      ? crypto.randomUUID()
      : (requestKey.current ?? crypto.randomUUID());
    requestKey.current = key;
    setError("");
    setBusy(true);
    try {
      const job = await api<Job>("/jobs", {
        branchId: w.branch.id,
        baseRevision: w.branch.revision,
        channel,
        mode: actualMode,
        input: text,
        provider,
        model,
        requestKey: key,
        style,
        targetLength,
        contextBudget: budget,
        range: actualMode === "partial" ? range : undefined,
        allowMeaningChange: allowMeaning,
        instructionsScope: scope,
        participation,
        controlledCharacter: controlled,
        candidateId:
          actualMode === "lab" ||
          actualMode === "analyze" ||
          channel !== "story"
            ? undefined
            : latest?.id,
        ...patch,
      });
      if (!patch.input) editInput("");
      requestKey.current = null;
      await refresh();
      setToast(
        job.status === "queued"
          ? "작업을 저장했습니다. 창을 닫아도 서버에서 계속됩니다."
          : "기존 요청을 복구했습니다.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "전송에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  function changeReader(value: ReaderSettings) {
    const container = scroller.current;
    const anchor =
      container &&
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-paragraph]"),
      ).find(
        (p) =>
          p.getBoundingClientRect().bottom >
          container.getBoundingClientRect().top,
      );
    const offset = anchor?.getBoundingClientRect().top;
    setReader(value);
    requestAnimationFrame(() => {
      if (container && anchor && offset !== undefined)
        container.scrollTop += anchor.getBoundingClientRect().top - offset;
    });
  }
  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom.current) setShowLatest(false);
    if (w) {
      const p = Array.from(
        el.querySelectorAll<HTMLElement>("[data-paragraph]"),
      ).find(
        (p) =>
          p.getBoundingClientRect().bottom > el.getBoundingClientRect().top,
      );
      if (p)
        saveLocal("novel-position-" + w.branch.id, {
          id: p.dataset.paragraph,
          offset:
            p.getBoundingClientRect().top - el.getBoundingClientRect().top,
        });
    }
  }
  const navigation: { id: View; label: string; icon: ReactNode }[] = [
    { id: "write", label: "집필 공간", icon: <Feather size={18} /> },
    { id: "memory", label: "인물과 기억", icon: <BookOpen size={18} /> },
    { id: "style", label: "문체 자료실", icon: <LibraryBig size={18} /> },
    { id: "lab", label: "문체 실험실", icon: <FlaskConical size={18} /> },
    {
      id: "backup",
      label: "가져오기 · 백업",
      icon: <FolderArchive size={18} />,
    },
  ];
  const readerStyle = {
    "--reader-size": reader.size / 16 + "rem",
    "--reader-line": reader.lineHeight,
    "--reader-gap": reader.paragraphGap + "em",
    "--reader-margin": reader.margin + "px",
    "--reader-font": reader.font === "serif" ? "var(--serif)" : "var(--sans)",
  } as CSSProperties;
  return (
    <div className="app-shell" style={readerStyle}>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("write");
          }}
        >
          <span className="brand-mark">
            <Feather size={24} />
          </span>
          <span>
            여백<small>나만의 소설 작업실</small>
          </span>
        </a>
        <div className="workspace-label">MY WORKSPACE</div>
        <button
          className="project-select"
          onClick={() => {
            setView("write");
            setNewProject(!projects.length);
          }}
        >
          <div className="project-icon">
            <BookOpen size={20} />
          </div>
          <span>
            {w?.project.title || "나의 첫 번째 이야기"}
            <small>
              {w
                ? "개인 작품 · " + w.branches.length + "개 분기"
                : "새로운 이야기를 시작하세요"}
            </small>
          </span>
          <ChevronDown size={16} />
        </button>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              onClick={() => {
                setView(n.id);
                setSidebar(false);
              }}
            >
              {n.icon}
              {n.label}
              {n.id === "style" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <div className="section-heading">
            <span className="workspace-label">내 작품</span>
            <button
              className="icon-button"
              title="새 작품"
              aria-label="새 작품"
              onClick={() => setNewProject(true)}
            >
              <Plus size={17} />
            </button>
          </div>
          {projects.map((p) => (
            <button
              className={
                "project-row " + (w?.project.id === p.id ? "selected" : "")
              }
              key={p.id}
              onClick={() => void mutate(() => openProject(p.id))}
            >
              <span className="project-bullet" />
              {p.title}
            </button>
          ))}
          {!projects.length && (
            <p className="sidebar-hint">
              아직 쓰지 않은 이야기에도
              <br />
              자리가 필요하니까요.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="private-note">
            <LockKeyholeIcon />
            <span>
              당신만의 공간<small>작품은 이 서버에 보관됩니다</small>
            </span>
          </div>
          <button
            className={view === "connections" ? "active" : ""}
            onClick={() => {
              setView("connections");
              setSidebar(false);
            }}
          >
            <Settings2 size={18} />
            연결 설정
            <ArrowUp size={14} />
          </button>
          <span className="version">여백 / PERSONAL EDITION</span>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="메뉴 열기"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </button>
            <span>{w?.project.title || "나의 작업실"}</span>
            <ChevronRight size={14} />
            <strong>
              {view === "write"
                ? "집필 공간"
                : view === "connections"
                  ? "연결 설정"
                  : navigation.find((n) => n.id === view)?.label}
            </strong>
          </div>
          <div className="header-tools">
            <span className={"connection-state " + (offline ? "offline" : "")}>
              {offline ? (
                <CloudOff size={14} />
              ) : (
                <span className="status-dot connected" />
              )}
              {offline ? "오프라인 · 읽기·초안" : "서버 연결됨"}
            </span>
            <button
              className="icon-button"
              aria-label="읽기 설정"
              onClick={() => setReaderOpen(true)}
            >
              <SlidersHorizontal size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="작업 기록"
              onClick={() => setJobsOpen(true)}
            >
              <FileClock size={19} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="오류 닫기"
              onClick={() => setError("")}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {offline && (
          <div className="offline-banner">
            저장된 내용을 읽고 입력 초안을 보존할 수 있습니다. 생성 요청은 자동
            재전송하지 않습니다.
            <button className="text-button" onClick={() => void initialize()}>
              다시 연결
            </button>
          </div>
        )}
        {view === "write" && w && (
          <div className="writing-toolbar">
            <div className="channel-tabs">
              {(["story", "settings", "ooc"] as const).map((c) => (
                <button
                  key={c}
                  className={channel === c ? "selected" : ""}
                  onClick={() => setChannel(c)}
                >
                  {channelNames[c]}
                  {c === "story" && <span className="tab-dot" />}
                </button>
              ))}
            </div>
            <div className="branch-tools">
              <GitBranch size={15} />
              <select
                aria-label="현재 분기"
                value={w.branch.id}
                onChange={(e) => void mutate(() => loadBranch(e.target.value))}
              >
                {w.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                aria-label="현재 시점에서 분기"
                onClick={() => {
                  setForkRevision(w.branch.revision);
                  setForkSource(undefined);
                  setForkName("다른 길");
                }}
              >
                <Plus size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="후보 보관함"
                onClick={() => setArchiveOpen(true)}
              >
                <MoreHorizontal size={20} />
              </button>
            </div>
          </div>
        )}
        <div className="main-scroll" ref={scroller} onScroll={onScroll}>
          {!w && view !== "connections" && (
            <div className="welcome">
              <div className="welcome-tag">
                <span className="status-dot connected" />A QUIET PLACE FOR YOUR
                STORY
              </div>
              <h1>
                아직 쓰이지 않은
                <br />
                당신의 <em>다음 장면.</em>
              </h1>
              <p>
                인물의 기억부터 문장의 작은 습관까지.
                <br />
                당신의 이야기를 오래 기억하는 집필 공간, 여백입니다.
              </p>
              <button
                className="primary welcome-cta"
                onClick={() => setNewProject(true)}
              >
                <Plus size={18} />첫 번째 작품 시작하기
                <ArrowUp size={17} />
              </button>
              <div className="welcome-rule">
                <span>이야기를 위한 세 가지 자리</span>
              </div>
              <div className="welcome-cards">
                <div>
                  <span>01 / WRITE</span>
                  <Feather size={23} />
                  <h3>쓰고, 다시 쓰고</h3>
                  <p>
                    후보를 비교하고 마음에 드는 장면을 확정하세요. 이전 문장은
                    남아 있습니다.
                  </p>
                </div>
                <div>
                  <span>02 / REMEMBER</span>
                  <BookOpen size={23} />
                  <h3>이야기는 기억하고</h3>
                  <p>
                    인물의 말과 실제 사건, 아직 오지 않은 약속을 구분해 쌓아
                    갑니다.
                  </p>
                </div>
                <div>
                  <span>03 / FIND YOUR VOICE</span>
                  <LibraryBig size={23} />
                  <h3>문체는 당신답게</h3>
                  <p>
                    좋아하는 글의 호흡을 찾아, 당신의 장면에 어울리는 방식으로
                    적용하세요.
                  </p>
                </div>
              </div>
              <div className="welcome-footer">
                <span>PRIVATE BY DESIGN</span>
                <span>당신의 원문은, 언제나 당신의 것.</span>
              </div>
            </div>
          )}
          {view === "connections" && <ConnectionsPanel />}
          {w && view === "memory" && <MemoryPanel w={w} />}
          {w && view === "style" && (
            <StylePanel w={w} mutate={mutate} onGenerate={generate} />
          )}
          {w && view === "backup" && (
            <BackupPanel w={w} mutate={mutate} onRestored={openProject} />
          )}
          {w && view === "lab" && (
            <LabPanel w={w} mutate={mutate} onGenerate={generate} />
          )}
          {w && view === "write" && (
            <>
              {channel === "settings" && (
                <SettingsPanel w={w} mutate={mutate} />
              )}
              {channel === "story" && (
                <div className="reading-column">
                  <div className="chapter-heading">
                    <span className="eyebrow">YOUR STORY, AT YOUR PACE</span>
                    <h1>{w.project.title}</h1>
                    <p>
                      {w.project.description ||
                        "아직 쓰지 않은 다음 문장을 기다립니다."}
                    </p>
                    <span className="chapter-rule" />
                  </div>
                  {w.branch.history.length === 0 && !latest && (
                    <div className="blank-page">
                      <Feather size={28} />
                      <h2>첫 문장이 놓일 자리</h2>
                      <p>
                        아래에 장면의 시작이나 인물의 행동을 적어 주세요.
                        <br />
                        생성한 글은 후보로 보존되고, 확인한 뒤 확정합니다.
                      </p>
                      <div className="starter-prompts">
                        {[
                          "인물과 배경을 함께 정해 볼까?",
                          "조용한 일상 장면으로 시작해 줘.",
                          "원고를 가져와 이어 쓰고 싶어.",
                        ].map((p, i) => (
                          <button
                            key={p}
                            onClick={() => {
                              if (i === 2) setView("backup");
                              else if (i === 0) {
                                setChannel("settings");
                                setTimeout(() => editInput(p), 0);
                              } else editInput(p);
                            }}
                          >
                            {p}
                            <ArrowUp size={14} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {w.branch.history.length > limit && (
                    <button
                      className="load-more secondary"
                      onClick={() => {
                        const height = scroller.current?.scrollHeight ?? 0;
                        setLimit(limit + 15);
                        requestAnimationFrame(() => {
                          if (scroller.current)
                            scroller.current.scrollTop +=
                              scroller.current.scrollHeight - height;
                        });
                      }}
                    >
                      이전 장면 더 읽기
                    </button>
                  )}
                  {w.branch.history
                    .slice(-limit)
                    .map((cid) => w.candidates.find((c) => c.id === cid))
                    .filter((c): c is Candidate => !!c)
                    .map((c) => (
                      <StoryCard
                        key={c.id}
                        candidate={c}
                        w={w}
                        reader={reader}
                        mutate={mutate}
                        onFork={(revision) => {
                          setForkRevision(revision);
                          setForkSource(c.id);
                        }}
                        onChoice={(text) => void generate({ input: text })}
                        onRewrite={() => {
                          setMode("rewrite");
                          composer.current?.focus();
                        }}
                      />
                    ))}
                  {latest && (
                    <StoryCard
                      key={latest.id}
                      candidate={latest}
                      w={w}
                      reader={reader}
                      mutate={mutate}
                      onFork={(revision) => {
                        setForkRevision(revision);
                        setForkSource(latest.id);
                      }}
                      onChoice={(text) =>
                        void generate({ input: text, mode: "continue" })
                      }
                      onRewrite={() => {
                        setMode("rewrite");
                        composer.current?.focus();
                      }}
                    />
                  )}
                </div>
              )}
              {channel !== "story" && (
                <div className="discussion-column">
                  <div className="discussion-heading">
                    <span className="eyebrow">
                      {channel === "ooc" ? "OUT OF CHARACTER" : "SETTING NOTES"}
                    </span>
                    <h2>
                      {channel === "ooc"
                        ? "이야기 바깥의 대화"
                        : "설정을 함께 다듬기"}
                    </h2>
                    <p>
                      {channel === "ooc"
                        ? "전개를 가정하고, 문체를 상담하세요. 이 대화는 정본의 사건이나 관계를 바꾸지 않습니다."
                        : "대화는 제안으로 남습니다. 위의 설정 기록에서 적용 범위를 정해 확정하세요."}
                    </p>
                  </div>
                  {w.messages
                    .filter((m) => m.channel === channel)
                    .map((m) => (
                      <article className={"chat-message " + m.role} key={m.id}>
                        <span>
                          {m.role === "user" ? "나의 메모" : "집필 파트너"} ·{" "}
                          {w.branch.name}
                        </span>
                        <p>{m.text}</p>
                        {m.role === "assistant" && (
                          <div className="button-row">
                            <button
                              className="text-button"
                              onClick={() => {
                                saveLocal(
                                  "novel-draft-" + w.branch.id + "-story",
                                  {
                                    text: m.text,
                                    baseRevision: w.branch.revision,
                                  },
                                );
                                setChannel("story");
                                setInput(m.text);
                              }}
                            >
                              이번 생성에 적용
                            </button>
                            <button
                              className="text-button"
                              onClick={() =>
                                void mutate(
                                  () =>
                                    api(
                                      "/branches/" + w.branch.id + "/settings",
                                      {
                                        baseRevision: w.branch.revision,
                                        scope: "scene",
                                        kind: "rule",
                                        name: "장면 지시",
                                        text: m.text,
                                        status: "applied",
                                        sourceMessageId: m.id,
                                      },
                                    ),
                                  "현재 장면에 지시를 적용했습니다.",
                                )
                              }
                            >
                              현재 장면에 적용
                            </button>
                            <button
                              className="text-button"
                              onClick={() =>
                                void mutate(
                                  () =>
                                    api(
                                      "/branches/" + w.branch.id + "/settings",
                                      {
                                        baseRevision: w.branch.revision,
                                        scope: "branch",
                                        kind: "rule",
                                        name: "대화에서 가져온 변경안",
                                        text: m.text,
                                        status: "proposed",
                                        sourceMessageId: m.id,
                                      },
                                    ),
                                  "설정 변경안을 저장했습니다.",
                                )
                              }
                            >
                              설정 변경안 저장
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                </div>
              )}
              {active?.partial && (
                <div className="stream-preview">
                  <span className="eyebrow">생성 중 · 미완료 원문</span>
                  <p>{streamBody(active)}</p>
                </div>
              )}
              {active && (
                <div className="active-job">
                  <Busy />
                  <span>
                    {active.request.mode === "analyze"
                      ? "문체를 분석하고 있습니다"
                      : "선택한 연결에서 응답을 기다립니다"}
                    <small>
                      {active.request.provider} · {active.request.model} ·{" "}
                      {active.status === "queued" ? "대기 중" : "진행 중"}
                    </small>
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setJobsOpen(true)}
                  >
                    작업 보기
                  </button>
                </div>
              )}
            </>
          )}
          <div ref={bottom} className="scroll-bottom" />
        </div>
        {showLatest && view === "write" && (
          <button
            className="jump-latest secondary"
            onClick={() => {
              bottom.current?.scrollIntoView({
                behavior: "smooth",
                block: "end",
              });
              nearBottom.current = true;
              setShowLatest(false);
            }}
          >
            <ArrowDown size={15} />
            최신 위치로
          </button>
        )}
        {w && view === "write" && (
          <div className="composer-shell">
            <div className="composer">
              <div className="composer-top">
                <span className="composer-context">
                  <Feather size={14} />
                  {channelNames[channel]} <span>/</span> {w.branch.name}
                </span>
                {channel === "story" && (
                  <select
                    aria-label="작업 모드"
                    value={mode}
                    onChange={(e) =>
                      setMode(e.target.value as GenerateRequest["mode"])
                    }
                  >
                    <option value="continue">이어쓰기</option>
                    <option value="rewrite">현재 턴 재작성</option>
                    <option value="partial">선택 범위 수정</option>
                    <option value="style">문체만 재작성</option>
                  </select>
                )}
              </div>
              {mode === "partial" && channel === "story" && latest && (
                <details className="partial-select" open>
                  <summary>
                    수정할 범위 선택 · {range.end - range.start}자
                  </summary>
                  <textarea
                    aria-label="부분 수정 범위"
                    readOnly
                    value={latest.output.body}
                    onSelect={(e) =>
                      setRange({
                        start: e.currentTarget.selectionStart,
                        end: e.currentTarget.selectionEnd,
                      })
                    }
                  />
                </details>
              )}
              <textarea
                ref={composer}
                className="composer-input"
                aria-label="집필 지시"
                placeholder={
                  channel === "story"
                    ? "인물의 다음 행동이나, 쓰고 싶은 장면을 적어 주세요…"
                    : channel === "settings"
                      ? "인물과 세계관에 대해 이야기해 보세요…"
                      : "전개나 문체에 대해 편하게 이야기해 보세요…"
                }
                value={input}
                onChange={(e) => editInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.ctrlKey || e.metaKey) &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    void generate();
                  }
                }}
              />
              <div className="composer-bottom">
                <div className="model-controls">
                  <select
                    aria-label="연결 방식"
                    value={provider}
                    onChange={(e) => {
                      const p = e.target.value as GenerateRequest["provider"];
                      setProvider(p);
                      setModel(p === "codex" ? "default" : "");
                    }}
                  >
                    <option value="codex">Codex CLI</option>
                    <option value="gemini-cli">Gemini CLI</option>
                    <option value="openai">OpenAI API</option>
                    <option value="gemini">Gemini API</option>
                  </select>
                  <input
                    aria-label="모델 이름"
                    value={model}
                    placeholder="사용 가능한 모델 이름"
                    onChange={(e) => setModel(e.target.value)}
                  />
                  <span className="control-divider" />
                  <select
                    aria-label="문체 적용 모드"
                    value={style.mode}
                    onChange={(e) =>
                      setStyle({
                        ...style,
                        mode: e.target
                          .value as GenerateRequest["style"]["mode"],
                      })
                    }
                  >
                    <option value="off">문체 적용 끔</option>
                    <option value="profile">프로필 중심</option>
                    <option value="examples">프로필 + 예문</option>
                  </select>
                </div>
                <div className="send-controls">
                  {active && (
                    <button
                      className="icon-button stop-button"
                      aria-label="생성 중단"
                      onClick={() =>
                        void mutate(() =>
                          api("/jobs/" + active.id + "/cancel", {}),
                        )
                      }
                    >
                      <Square size={17} />
                    </button>
                  )}
                  <button
                    className="send-button"
                    aria-label="전송"
                    disabled={busy || offline || !input.trim() || !model}
                    onClick={() => void generate()}
                  >
                    {busy ? <Busy /> : <ArrowUp size={21} />}
                  </button>
                </div>
              </div>
              <details className="advanced-composer">
                <summary>
                  <SlidersHorizontal size={13} />
                  문체·분량·고급 설정<span>Ctrl / ⌘ + Enter로 전송</span>
                </summary>
                <div className="advanced-grid">
                  <Field label="문체 프로필">
                    <select
                      value={style.profileIds[0] || ""}
                      onChange={(e) =>
                        setStyle({
                          ...style,
                          profileIds: e.target.value ? [e.target.value] : [],
                        })
                      }
                    >
                      <option value="">선택 안 함</option>
                      {w.profiles
                        .filter((p) => p.active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · v{p.version}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="재현 강도">
                    <select
                      value={style.strength}
                      onChange={(e) =>
                        setStyle({
                          ...style,
                          strength: e.target
                            .value as GenerateRequest["style"]["strength"],
                        })
                      }
                    >
                      <option value="light">약하게</option>
                      <option value="normal">보통</option>
                      <option value="strong">강하게</option>
                    </select>
                  </Field>
                  <Field label="본문 목표 · 공백 포함 글자">
                    <input
                      type="number"
                      min={100}
                      max={20000}
                      value={targetLength}
                      onChange={(e) => setTargetLength(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="컨텍스트 예산 · 추정 토큰">
                    <input
                      type="number"
                      min={4000}
                      max={200000}
                      value={budget}
                      onChange={(e) => setBudget(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="이번 지시의 적용 의도">
                    <select
                      value={scope}
                      onChange={(e) =>
                        setScope(
                          e.target
                            .value as GenerateRequest["instructionsScope"],
                        )
                      }
                    >
                      <option value="generation">이번 생성</option>
                      <option value="scene">현재 장면</option>
                      <option value="branch">현재 분기</option>
                      <option value="project">작품 전체</option>
                    </select>
                  </Field>
                  <Field label="참여 방식">
                    <select
                      value={participation}
                      onChange={(e) =>
                        setParticipation(
                          e.target.value as "author" | "character",
                        )
                      }
                    >
                      <option value="author">작가 모드</option>
                      <option value="character">인물 참여 모드</option>
                    </select>
                  </Field>
                  {participation === "character" && (
                    <Field label="내가 통제하는 인물">
                      <input
                        value={controlled}
                        onChange={(e) => setControlled(e.target.value)}
                      />
                    </Field>
                  )}
                  {["narration", "dialogue", "inner", "description"].map(
                    (element, i) => (
                      <Field
                        key={element}
                        label={
                          ["서술", "대사", "내면 독백", "묘사"][i] +
                          " 전용 프로필"
                        }
                      >
                        <select
                          value={style.elementProfiles[element] || ""}
                          onChange={(e) => {
                            const mapping = { ...style.elementProfiles };
                            if (e.target.value)
                              mapping[element] = e.target.value;
                            else delete mapping[element];
                            setStyle({ ...style, elementProfiles: mapping });
                          }}
                        >
                          <option value="">공통 프로필 사용</option>
                          {w.profiles
                            .filter((p) => p.active)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    ),
                  )}
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={allowMeaning}
                    onChange={(e) => setAllowMeaning(e.target.checked)}
                  />
                  부분 수정에서 사건·의미 변경 허용
                </label>
                <small>
                  장면·분기·작품 지시는 변경안의 적용 의도입니다. 지속되는
                  설정은 ‘설정’ 탭에서 명시적으로 저장·적용하세요.
                </small>
              </details>
            </div>
            <p className="composer-caption">
              {latest
                ? "최신 후보는 검토 후 이어쓰거나, ‘이 장면 확정’으로 채택할 수 있습니다."
                : "자유 행동은 언제나 가능합니다. 입력 초안은 이 기기에 저장됩니다."}
            </p>
          </div>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <span className="status-dot connected" />
          {toast}
        </div>
      )}
      {readerOpen && (
        <ReaderPanel
          value={reader}
          onChange={changeReader}
          onClose={() => setReaderOpen(false)}
        />
      )}
      {newProject && (
        <Modal title="새로운 이야기 시작" onClose={() => setNewProject(false)}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(async () => {
                const result = await api<{ branch: Branch }>("/projects", {
                  title: newTitle,
                  description: newDescription,
                });
                await loadBranch(result.branch.id);
                setNewProject(false);
                setNewTitle("");
                setNewDescription("");
                setView("write");
                setChannel("story");
              }, "새 작품을 만들었습니다.");
            }}
          >
            <Field label="작품 이름">
              <input
                autoFocus
                required
                maxLength={150}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="이야기에 이름을 붙여 주세요"
              />
            </Field>
            <Field label="작품 소개 · 선택">
              <textarea
                rows={4}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="어떤 이야기를 쓰고 싶나요?"
              />
            </Field>
            <button className="primary" disabled={!newTitle.trim() || busy}>
              작품 만들기 <ArrowUp size={16} />
            </button>
          </form>
        </Modal>
      )}
      {needsPassword && (
        <Modal
          title="개인 작업실에 접속"
          onClose={() => setNeedsPassword(false)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void initialize(password);
            }}
          >
            <p>서버에 설정한 접속 암호를 입력하세요.</p>
            <Field label="접속 암호">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <button className="primary">연결</button>
          </form>
        </Modal>
      )}
      {forkRevision !== undefined && w && (
        <Modal
          title="다른 길로 이어가기"
          onClose={() => setForkRevision(undefined)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(async () => {
                const b = await api<Branch>(
                  "/branches/" + w.branch.id + "/fork",
                  {
                    name: forkName,
                    revision: forkRevision,
                    candidateId: forkSource,
                  },
                );
                await loadBranch(b.id);
                setForkRevision(undefined);
              }, "기존 분기를 보존하고 새 분기를 만들었습니다.");
            }}
          >
            <p>
              기준 버전 v{forkRevision}. 이 시점 이후의 본문과 기억은 새 분기에
              포함하지 않습니다.
            </p>
            <Field label="분기 이름">
              <input
                required
                value={forkName}
                onChange={(e) => setForkName(e.target.value)}
              />
            </Field>
            <button className="primary">
              <GitBranch size={16} />
              분기 만들기
            </button>
          </form>
        </Modal>
      )}
      {jobsOpen && (
        <Modal title="작업 기록과 복구" wide onClose={() => setJobsOpen(false)}>
          {!w?.jobs.length && (
            <Empty title="아직 실행한 작업이 없습니다">
              요청, 연결, 시도, 부분 출력과 사용량이 여기에 기록됩니다.
            </Empty>
          )}
          {w?.jobs
            .slice()
            .reverse()
            .map((j) => (
              <article className="surface job-card" key={j.id}>
                <div className="section-heading">
                  <h3>
                    {j.request.mode} · {j.request.provider}
                  </h3>
                  <span className="chip">
                    {
                      {
                        queued: "대기",
                        running: "진행",
                        completed: "완료",
                        failed: "실패",
                        interrupted: "복구 불가 · 중단",
                        cancelled: "사용자 중단",
                      }[j.status]
                    }
                  </span>
                </div>
                <small>
                  {j.request.model} · 시도 {j.attempt} · 기준 v
                  {j.context.revision}
                </small>
                <p>{j.request.input}</p>
                {j.error && <p className="error-inline">{j.error}</p>}
                <details>
                  <summary>원본 출력·사용량·고정 입력</summary>
                  <pre>{j.partial || "아직 수신한 출력 없음"}</pre>
                  <pre>
                    {JSON.stringify(
                      {
                        usage: j.usage ?? { cost: "미상" },
                        request: j.request,
                        context: j.context,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                {["failed", "interrupted", "cancelled"].includes(j.status) && (
                  <button
                    className="secondary"
                    onClick={() =>
                      void mutate(
                        () => api("/jobs/" + j.id + "/retry", {}),
                        "사용자 재시도를 별도 시도로 기록했습니다.",
                      )
                    }
                  >
                    새 시도로 재시도
                  </button>
                )}
                {["running", "queued"].includes(j.status) && (
                  <button
                    className="secondary"
                    onClick={() =>
                      void mutate(() => api("/jobs/" + j.id + "/cancel", {}))
                    }
                  >
                    중단
                  </button>
                )}
              </article>
            ))}
        </Modal>
      )}
      {archiveOpen && w && (
        <Modal title="후보 보관함" wide onClose={() => setArchiveOpen(false)}>
          <p className="muted">
            이전 후보와 폐기 후보는 기억에 반영하지 않고 보존합니다.
          </p>
          {w.candidates
            .filter((c) => c.status !== "accepted" && c.mode !== "lab")
            .reverse()
            .map((c) => (
              <article className="surface" key={c.id}>
                <span className="chip">
                  장면 {c.turn} · v{c.version} · {c.status}
                </span>
                <p className="prose">{c.output.body}</p>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() =>
                      void mutate(async () => {
                        await api("/candidates/" + c.id + "/restore", {});
                        setArchiveOpen(false);
                      }, "이전 후보를 복원했습니다.")
                    }
                  >
                    이 후보 복원
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setArchiveOpen(false);
                      setForkRevision(c.baseRevision);
                      setForkSource(c.id);
                    }}
                  >
                    기준 시점에서 분기
                  </button>
                </div>
              </article>
            ))}
        </Modal>
      )}
    </div>
  );
}
function LockKeyholeIcon() {
  return (
    <svg
      width="18"
      height="22"
      viewBox="0 0 18 22"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2"
        y="9"
        width="14"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5 9V6a4 4 0 118 0v3M9 13v3"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function streamBody(job: Job) {
  if (job.request.channel !== "story") return job.partial;
  const match = job.partial.match(/\"body\"\s*:\s*\"((?:[^\"\\]|\\.)*)/s);
  if (!match) return "응답 구조를 수신하고 있습니다…";
  try {
    return JSON.parse('"' + match[1] + '"');
  } catch {
    return "본문을 수신하고 있습니다…";
  }
}
