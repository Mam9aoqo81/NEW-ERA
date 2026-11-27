import { useNotebookChat } from "./useNotebookChat";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUpLeft,
  BookOpen,
  Check,
  CheckCheck,
  ChevronLeft,
  CircleHelp,
  FileText,
  Focus,
  GraduationCap,
  Layers3,
  Leaf,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  PanelRightOpen,
  RotateCcw,
  Trash2,
  Clock3,
} from "lucide-react";
import {
  api,
  json,
  jobError,
  type Citation,
  type Notebook,
  type Page,
  type Source,
  type User,
} from "./api";

const SAMPLE =
  "تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية. تستخدم النباتات الطاقة الضوئية من الشمس لتحويل الماء وثاني أكسيد الكربون إلى سكريات، وينطلق الأكسجين ناتجًا عن العملية. تحتوي البلاستيدات على صبغة الكلوروفيل التي تمتص الضوء. تساعد هذه العملية النباتات على إنتاج غذائها، وتشكل أساسًا للعديد من السلاسل الغذائية.";
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "حدث خطأ غير متوقع.";
function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "light" : ""}`}>
      <span className="brand-icon">
        <Layers3 size={23} />
      </span>
      <span dir="ltr">
        Know<span className="brand-lm">LM</span>
        <small>مساحة للفهم.</small>
      </span>
    </div>
  );
}
function Busy() {
  return <LoaderCircle size={18} className="spin" aria-label="جارٍ التحميل" />;
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="modal"
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="إغلاق">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Auth({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (register)
        await api("/v1/auth/register", null, json({ username, password }));
      const result = await api<{ access_token: string }>(
        "/v1/auth/login",
        null,
        json({ username, password }),
      );
      const user = await api<User>("/v1/auth/me", result.access_token);
      onLogin(result.access_token, user);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-form-side">
        <Brand />
        <div className="auth-form">
          <span className="eyebrow">
            <span className="little-dot" /> تعلّم بفضول، وافهم بعمق
          </span>
          <h1>
            كل مصادرك.
            <br />
            مساحة واحدة <em>للفهم.</em>
          </h1>
          <p className="muted">
            من أول سؤال إلى لحظة «فهمتها». اجمع مصادرك، اسأل عنها، وارجع إلى أصل
            كل معلومة.
          </p>
          <div className="auth-switch">
            <button
              className={!register ? "active" : ""}
              onClick={() => {
                setRegister(false);
                setError("");
              }}
            >
              تسجيل الدخول
            </button>
            <button
              className={register ? "active" : ""}
              onClick={() => {
                setRegister(true);
                setError("");
              }}
            >
              حساب جديد
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              اسم المستخدم
              <input
                dir="ltr"
                autoComplete="username"
                placeholder="your_username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                pattern="[a-zA-Z0-9_]{3,40}"
                title="3–40 حرفًا لاتينيًا أو رقمًا أو شرطة سفلية"
                required
                maxLength={40}
              />
            </label>
            <label>
              كلمة المرور
              <input
                dir="ltr"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            {register && (
              <p className="field-hint">
                اسم لاتيني من 3 أحرف أو أكثر، وكلمة مرور من 10 أحرف على الأقل.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? <Busy /> : <ArrowLeft size={18} />}{" "}
              {register ? "أنشئ مساحة تعلّمك" : "ادخل إلى مساحتك"}
            </button>
          </form>
          <div className="privacy-line">
            <ShieldCheck size={16} /> دفاترك خاصة. أنت تختار ما تضيفه.
          </div>
        </div>
        <footer>
          KnowLM · نسخة تطوير مبكّرة <span>صُمّمت للتعلّم، لا للتشتّت.</span>
        </footer>
      </section>
      <section className="auth-art" aria-label="معاينة توضيحية لمساحة الدراسة">
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <span className="art-pill">
          <Sparkles size={15} /> معرفة تبدأ بمصادرك
        </span>
        <div className="illustration">
          <div className="illustration-top">
            <span className="mini-icon">
              <BookOpen size={20} />
            </span>
            <div>
              <strong>رحلة إلى عالم الأحياء</strong>
              <small>مساحة دراسة · مثال توضيحي</small>
            </div>
            <span className="dots">•••</span>
          </div>
          <div className="paper-stack">
            <div className="paper-back" />
            <div className="paper">
              <div className="paper-label">
                <Leaf size={24} />
                <span>البناء الضوئي</span>
              </div>
              <div className="diagram">
                <span>ضوء الشمس</span>
                <div className="diagram-arrow">↓</div>
                <div className="leaf-circle">
                  <Leaf size={46} strokeWidth={1.3} />
                </div>
                <div className="diagram-arrow">↓</div>
                <span>طاقة للحياة</span>
              </div>
              <div className="paper-lines">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
          <div className="floating-answer">
            <span className="answer-spark">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>الفهم أهم من الحفظ.</strong>
              <p>
                اسأل، استكشف، وارجع إلى المصدر. <b>[1]</b>
              </p>
            </div>
          </div>
          <div className="floating-source">
            <CheckCheck size={16} /> كل فكرة لها مصدر
          </div>
        </div>
        <div className="art-bottom">
          <h2>
            أقل تشتّتًا.
            <br />
            أكثر لحظات «فهمتها».
          </h2>
          <p>مكتبتك ومساعد دراستك، في مكان هادئ واحد.</p>
          <div className="art-pagination">
            <i className="selected" />
            <i />
            <i />
          </div>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() =>
      sessionStorage.getItem("knowlm-token"),
    ),
    [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(!!token);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]),
    [selected, setSelected] = useState<Notebook | null>(null),
    [focus, setFocus] = useState(false),
    [create, setCreate] = useState(false),
    [error, setError] = useState(""),
    [llm, setLlm] = useState(false),
    [mobileNav, setMobileNav] = useState(false);
  const clear = useCallback(() => {
    sessionStorage.removeItem("knowlm-token");
    setToken(null);
    setUser(null);
    setNotebooks([]);
    setSelected(null);
    setChecking(false);
    setFocus(false);
  }, []);
  useEffect(() => {
    window.addEventListener("knowlm:expired", clear);
    return () => window.removeEventListener("knowlm:expired", clear);
  }, [clear]);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setChecking(true);
    Promise.all([
      api<User>("/v1/auth/me", token),
      api<Notebook[]>("/v1/notebooks", token),
    ])
      .then(([u, n]) => {
        if (active) {
          setUser(u);
          setNotebooks(n);
          setSelected(
            (current) => n.find((x) => x.id === current?.id) || n[0] || null,
          );
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  useEffect(() => {
    api<{ llm_configured: boolean }>("/health")
      .then((h) => setLlm(h.llm_configured))
      .catch(() => setLlm(false));
  }, []);
  function login(t: string, u: User) {
    sessionStorage.setItem("knowlm-token", t);
    setToken(t);
    setUser(u);
  }
  async function logout() {
    try {
      await api("/v1/auth/logout", token, { method: "POST" });
      clear();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function added(n: Notebook) {
    setNotebooks((old) => [...old, n]);
    setSelected(n);
    setCreate(false);
    setMobileNav(false);
  }
  if (checking)
    return (
      <div className="splash">
        <Brand />
        <Busy />
        <p>نفتح مساحة تعلّمك…</p>
      </div>
    );
  if (!token) return <Auth onLogin={login} />;
  return (
    <div className={`app-shell ${focus ? "focused" : ""}`}>
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="إغلاق القائمة"
            onClick={() => setMobileNav(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-label">
          مساحتك الشخصية <span>خاص</span>
        </div>
        <button
          className="nav-item selected"
          onClick={() => setMobileNav(false)}
        >
          <BookOpen size={19} /> دفاتر الدراسة{" "}
          <span className="nav-count">{notebooks.length}</span>
        </button>
        <div className="sidebar-section-title">
          دفاتري{" "}
          <button
            className="icon-button"
            aria-label="دفتر جديد"
            onClick={() => setCreate(true)}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="notebook-list">
          {notebooks.length === 0 ? (
            <p className="sidebar-empty">
              مساحة لأفكارك القادمة.
              <br />
              ابدأ بدفترك الأول.
            </p>
          ) : (
            notebooks.map((n) => (
              <button
                key={n.id}
                className={`notebook-nav ${selected?.id === n.id ? "active" : ""}`}
                onClick={() => {
                  setSelected(n);
                  setMobileNav(false);
                }}
              >
                <span className="notebook-dot" />
                <span>{n.title}</span>
                <ChevronLeft size={14} />
              </button>
            ))
          )}
        </div>
        <button className="new-notebook" onClick={() => setCreate(true)}>
          <Plus size={17} /> إنشاء دفتر جديد
        </button>
        <div className="sidebar-bottom">
          <div className="calm-card">
            <span>
              <Leaf size={18} /> خطوة صغيرة، فهم أعمق.
            </span>
            <p>
              ابدأ بسؤال واحد اليوم.
              <br />
              المعرفة تُبنى فكرةً بفكرة.
            </p>
          </div>
          <div className="profile">
            <span className="avatar">
              {(user?.username || "K").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong dir="auto">{user?.username || "حسابي"}</strong>
              <small>مساحة شخصية</small>
            </div>
            <button
              className="icon-button"
              aria-label="تسجيل الخروج"
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="إغلاق القائمة"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="فتح القائمة"
              onClick={() => setMobileNav(true)}
            >
              <PanelRightOpen size={20} />
            </button>
            <BookOpen size={17} />
            <span>مساحة التعلّم</span>
            <ChevronLeft size={14} />
            <strong>{selected?.title || "بداية جديدة"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="private-badge">
              <ShieldCheck size={14} /> خاص بك
            </span>
            <button
              className={`focus-button ${focus ? "on" : ""}`}
              aria-pressed={focus}
              onClick={() => setFocus(!focus)}
            >
              <Focus size={16} />
              <span>{focus ? "إنهاء التركيز" : "وضع التركيز"}</span>
            </button>
          </div>
        </header>
        {error && (
          <div className="global-error" role="alert">
            {error}
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="إخفاء الخطأ"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {selected ? (
          <Workspace
            key={`${token}-${selected.id}`}
            notebook={selected}
            token={token}
            llm={llm}
          />
        ) : (
          <div className="welcome">
            <span className="welcome-icon">
              <GraduationCap size={42} strokeWidth={1.3} />
            </span>
            <span className="eyebrow">صفحة جديدة، احتمالات كثيرة</span>
            <h1>
              أهلًا {user?.username}،<br />
              ماذا ستتعلّم اليوم؟
            </h1>
            <p>
              أنشئ دفترًا لمادتك، أضف مصادرك،
              <br />
              واطرح أول سؤال. سنبقي كل معلومة قريبة من مصدرها.
            </p>
            <button className="primary" onClick={() => setCreate(true)}>
              <Plus size={18} /> إنشاء أول دفتر
            </button>
            <div className="welcome-steps">
              <span>
                <FileText /> أضف مصادرك
              </span>
              <ChevronLeft />
              <span>
                <MessageSquare /> اسأل بفضول
              </span>
              <ChevronLeft />
              <span>
                <ShieldCheck /> تحقّق من المرجع
              </span>
            </div>
          </div>
        )}
        <footer className="workspace-footer">
          <span>
            <span className="little-dot" /> المعرفة من مصادرك، والقرار لك.
          </span>
          <span>KnowLM · مساحة للفهم</span>
        </footer>
      </div>
      {create && (
        <CreateNotebook
          token={token}
          close={() => setCreate(false)}
          onCreated={added}
        />
      )}
    </div>
  );
}
function CreateNotebook({
  token,
  close,
  onCreated,
}: {
  token: string;
  close: () => void;
  onCreated: (n: Notebook) => void;
}) {
  const [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const n = await api<Notebook>(
        "/v1/notebooks",
        token,
        json({ title: title.trim() }),
      );
      onCreated(n);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="دفتر جديد، فكرة جديدة" close={close}>
      <p className="muted">خصص مساحة لمادة، مشروع، أو أي شيء يثير فضولك.</p>
      <form onSubmit={submit}>
        <label>
          اسم الدفتر
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلًا: رحلة إلى عالم الأحياء"
            maxLength={200}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary wide" disabled={busy || !title.trim()}>
          {busy ? <Busy /> : <Plus size={18} />} إنشاء الدفتر
        </button>
      </form>
    </Modal>
  );
}

function Workspace({
  notebook,
  token,
  llm,
}: {
  notebook: Notebook;
  token: string;
  llm: boolean;
}) {
  const [sources, setSources] = useState<Source[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [loaded, setLoaded] = useState(false),
    [sourceError, setSourceError] = useState(""),
    [add, setAdd] = useState(false),
    [question, setQuestion] = useState(""),
    [confirmClear, setConfirmClear] = useState(false),
    [mode, setMode] = useState<"extractive" | "grounded">("extractive"),
    [citation, setCitation] = useState<Citation | null>(null),
    [tab, setTab] = useState<"chat" | "sources">("chat"),
    [sampleBusy, setSampleBusy] = useState(false);
  const seen = useRef(new Set<string>()),
    refreshVersion = useRef(0),
    end = useRef<HTMLDivElement>(null),
    chatScroll = useRef<HTMLDivElement>(null);
  const chat = useNotebookChat(notebook.id, token);
  const { turns, busy } = chat;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++refreshVersion.current;
      try {
        const rows = await api<Source[]>(
          `/v1/notebooks/${notebook.id}/sources`,
          token,
          { signal },
        );
        if (signal?.aborted || version !== refreshVersion.current) return;
        const newReady = rows
          .filter((s) => s.status === "ready" && !seen.current.has(s.id))
          .map((s) => s.id);
        for (const id of newReady) seen.current.add(id);
        setSources(rows);
        setSelected((current) =>
          [...new Set([...current, ...newReady])].filter((id) =>
            rows.some((s) => s.id === id && s.status === "ready"),
          ),
        );
        setLoaded(true);
        setSourceError("");
      } catch (e) {
        if (!signal?.aborted && version === refreshVersion.current) {
          setSourceError(errorMessage(e));
          setLoaded(true);
        }
      }
    },
    [notebook.id, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 3500);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.scrollRequest]);
  async function ask(e?: FormEvent, suggested?: string) {
    e?.preventDefault();
    const q = (suggested || question).trim();
    if (!q || !selected.length || busy || !chat.loaded || chat.loading) return;
    setQuestion("");
    await chat.send(q, selected, mode);
  }
  async function olderMessages() {
    const el = chatScroll.current;
    const height = el?.scrollHeight || 0;
    const top = el?.scrollTop || 0;
    await chat.loadOlder();
    requestAnimationFrame(() => {
      if (el) el.scrollTop = top + el.scrollHeight - height;
    });
  }
  async function sample() {
    setSampleBusy(true);
    try {
      await api(
        `/v1/notebooks/${notebook.id}/sources/text`,
        token,
        json({ title: "البناء الضوئي · مصدر تجريبي", text: SAMPLE }),
      );
      await refresh();
    } catch (e) {
      setSourceError(errorMessage(e));
    } finally {
      setSampleBusy(false);
    }
  }
  async function retry(s: Source) {
    if (!s.job) return;
    try {
      await api(`/v1/jobs/${s.job.id}/retry`, token, { method: "POST" });
      await refresh();
    } catch (e) {
      setSourceError(errorMessage(e));
    }
  }
  const ready = sources.filter((s) => s.status === "ready").length;
  return (
    <main className="notebook-workspace">
      <section className="notebook-heading">
        <div className="heading-title">
          <span className="notebook-cover">
            <BookOpen size={27} strokeWidth={1.5} />
          </span>
          <div>
            <span className="eyebrow">دفتر دراستك</span>
            <h1>{notebook.title}</h1>
            <p>
              <span>{sources.length} مصادر</span>
              <i /> مساحة خاصة للفهم والاستكشاف
            </p>
          </div>
        </div>
        <button
          className="outline"
          onClick={() => {
            setAdd(true);
            setTab("sources");
          }}
        >
          <Plus size={17} /> إضافة مصدر
        </button>
      </section>
      <div className="notebook-strip">
        <span>
          <ShieldCheck size={16} /> إجابات مرتبطة بمصادرك
        </span>
        <span>
          <Check size={15} /> {ready} مصادر جاهزة
        </span>
        <span className="local-label">
          <span className="little-dot" />
          {llm ? "التوليد الاختياري متاح" : "البحث المحلي · دون إرسال خارجي"}
        </span>
      </div>
      <div className="mobile-tabs">
        <button
          className={tab === "chat" ? "active" : ""}
          onClick={() => setTab("chat")}
        >
          <MessageSquare size={16} /> اسأل وافهم
        </button>
        <button
          className={tab === "sources" ? "active" : ""}
          onClick={() => setTab("sources")}
        >
          <FileText size={16} /> المصادر <b>{sources.length}</b>
        </button>
      </div>
      <div className="study-grid">
        <section
          className={`sources-panel panel ${tab === "sources" ? "mobile-active" : ""}`}
          aria-label="المصادر"
        >
          <div className="panel-title">
            <h2>
              <FileText size={18} /> المصادر{" "}
              <span className="count">{sources.length}</span>
            </h2>
            <button
              className="icon-button"
              aria-label="تحديث المصادر"
              onClick={() => void refresh()}
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="source-list">
            <p className="panel-description">
              اختر المصادر التي تريد البحث فيها.
            </p>
            {sourceError && (
              <p className="error" role="alert">
                {sourceError}
              </p>
            )}
            {!loaded ? (
              <div className="loading-line">
                <Busy /> نجهّز مكتبتك…
              </div>
            ) : sources.length === 0 ? (
              <div className="empty-sources">
                <span className="source-empty-icon">
                  <FileText size={28} strokeWidth={1.4} />
                </span>
                <h3>كل فهم يبدأ بمصدر</h3>
                <p>
                  أضف محاضرة أو ملاحظاتك،
                  <br />
                  ودع الأسئلة تقودك.
                </p>
              </div>
            ) : (
              <>
                <label className="select-all">
                  <input
                    type="checkbox"
                    checked={ready > 0 && selected.length === ready}
                    disabled={!ready}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? sources
                              .filter((s) => s.status === "ready")
                              .map((s) => s.id)
                          : [],
                      )
                    }
                  />{" "}
                  تحديد كل المصادر{" "}
                  <span>
                    {selected.length}/{ready}
                  </span>
                </label>
                {sources.map((s) => (
                  <div
                    className={`source-card ${selected.includes(s.id) ? "checked" : ""}`}
                    key={s.id}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(s.id)}
                        disabled={s.status !== "ready"}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, s.id]
                              : old.filter((id) => id !== s.id),
                          )
                        }
                      />
                      <span
                        className={`file-icon ${s.kind === "pdf" ? "pdf" : ""}`}
                      >
                        <FileText size={19} />
                      </span>
                      <span className="source-info">
                        <strong dir="auto">{s.title}</strong>
                        <small>
                          {s.kind === "pdf" ? "PDF" : "نص"} <span>·</span>{" "}
                          {s.status === "ready"
                            ? "جاهز للدراسة"
                            : s.status === "failed"
                              ? "تعثّرت المعالجة"
                              : "جارٍ استخراج النص"}
                        </small>
                      </span>
                    </label>
                    {s.status === "processing" && (
                      <div className="processing">
                        <Busy /> بانتظار العامل أو قيد المعالجة
                      </div>
                    )}
                    {s.status === "failed" && (
                      <div className="source-failure">
                        <p>{jobError(s.job?.error_code)}</p>
                        {s.job && s.job.attempts < 3 && (
                          <button onClick={() => void retry(s)}>
                            <RotateCcw size={13} /> إعادة المحاولة
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
            <button className="upload-zone" onClick={() => setAdd(true)}>
              <span>
                <Upload size={20} />
              </span>
              <strong>أضف مساحة جديدة للمعرفة</strong>
              <small>PDF أو نصوصك الخاصة</small>
              <b>
                <Plus size={14} /> إضافة مصدر
              </b>
            </button>
            {sources.length === 0 && loaded && (
              <button
                className="sample-button"
                onClick={() => void sample()}
                disabled={sampleBusy}
              >
                {sampleBusy ? <Busy /> : <Sparkles size={15} />} جرّب بمصدر
                تعليمي جاهز
              </button>
            )}
          </div>
          <div className="source-bottom">
            <ShieldCheck size={16} />
            <p>
              مصادرك خاصة بهذا الدفتر.
              <br />
              لا تُنشر أو تُشارك تلقائيًا.
            </p>
          </div>
        </section>
        <section
          className={`chat-panel panel ${tab === "chat" ? "mobile-active" : ""}`}
          aria-label="محادثة الدراسة"
        >
          <div className="panel-title">
            <h2>
              <Sparkles size={18} /> اسأل وافهم
            </h2>
            <div className="chat-actions">
              <span className="quiet-badge">سجل خاص محفوظ</span>
              <button
                className="icon-button"
                aria-label="مسح المحادثة"
                disabled={!turns.length || busy || chat.loading}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          <div
            className="chat-scroll"
            ref={chatScroll}
            aria-live="polite"
            aria-busy={chat.loading}
          >
            {chat.error && (
              <div className="error" role="alert">
                {chat.error}
                {!chat.loaded && (
                  <button
                    className="history-retry"
                    onClick={() => void chat.reload()}
                  >
                    إعادة تحميل السجل
                  </button>
                )}
              </div>
            )}
            {!chat.loaded && chat.loading && (
              <div className="loading-line">
                <Busy /> نستعيد محادثتك…
              </div>
            )}
            {chat.before && (
              <button
                className="load-history"
                disabled={chat.loading || busy}
                onClick={() => void olderMessages()}
              >
                {chat.loading ? <Busy /> : <Clock3 size={14} />} تحميل رسائل
                أقدم
              </button>
            )}
            {chat.loaded && turns.length === 0 ? (
              <div className="chat-empty">
                <div className="spark-art">
                  <Sparkles size={35} strokeWidth={1.3} />
                  <span className="spark-mini">
                    <Plus size={12} />
                  </span>
                </div>
                <span className="eyebrow">فضولك هو نقطة البداية</span>
                <h2>أهلًا بك في مساحة الفهم.</h2>
                <p>
                  اربط الأفكار، واسأل عن التفاصيل.
                  <br />
                  كل إجابة تقودك إلى المقطع الذي استندت إليه.
                </p>
                <div className="suggestions">
                  <button
                    disabled={!selected.length || !chat.loaded || chat.loading}
                    onClick={() =>
                      void ask(undefined, "ما هي عملية البناء الضوئي؟")
                    }
                  >
                    <span>
                      <Leaf size={17} /> ما هي عملية البناء الضوئي؟
                    </span>
                    <ArrowUpLeft size={16} />
                  </button>
                  <button
                    disabled={!selected.length || !chat.loaded || chat.loading}
                    onClick={() => void ask(undefined, "ما وظيفة الكلوروفيل؟")}
                  >
                    <span>
                      <CircleHelp size={17} /> ما وظيفة الكلوروفيل؟
                    </span>
                    <ArrowUpLeft size={16} />
                  </button>
                </div>
                <span className="suggestion-hint">
                  أمثلة مناسبة للمصدر التعليمي التجريبي
                </span>
              </div>
            ) : (
              turns.map((turn) => (
                <div className="turn" key={turn.id}>
                  <div className="user-message">
                    <span className="small-avatar">أنت</span>
                    <p dir="auto">{turn.question}</p>
                  </div>
                  <div className="assistant-message">
                    <div className="assistant-label">
                      <span className="small-ai">
                        <Sparkles size={14} />
                      </span>
                      <strong>KnowLM</strong>
                      <span>
                        {turn.mode === "grounded"
                          ? "إجابة مولّدة"
                          : "بحث في المصادر"}
                      </span>
                      {turn.saved && (
                        <span
                          className="saved-message"
                          title="محفوظة على الخادم"
                        >
                          <Check size={12} /> محفوظة
                        </span>
                      )}
                    </div>
                    {turn.error ? (
                      <div className="error" role="alert">
                        {turn.error}
                        {turn.payload && (
                          <button
                            className="history-retry"
                            disabled={busy || chat.loading}
                            onClick={() => void chat.retry(turn.id)}
                          >
                            إعادة إرسال بنفس المصادر
                          </button>
                        )}
                      </div>
                    ) : !turn.answer ? (
                      <div className="loading-line">
                        <Busy /> نبحث عن الخيط الذي يقود إلى الإجابة…
                      </div>
                    ) : (
                      <>
                        <p
                          dir="auto"
                          className={`answer-text ${!turn.answer.answered ? "refusal" : ""}`}
                        >
                          {turn.answer.answer}
                        </p>
                        {turn.answer.citations.length > 0 && (
                          <div className="citations">
                            <span className="citations-label">
                              <CheckCheck size={14} /> ارجع إلى المصدر
                            </span>
                            {turn.answer.citations.map((c, i) => (
                              <button
                                key={`${c.chunk_id}-${i}`}
                                onClick={() => setCitation(c)}
                              >
                                <span>{i + 1}</span>
                                <FileText size={13} />
                                <b>{c.title}</b>
                                <small>ص {c.page}</small>
                                <ArrowUpLeft size={13} />
                              </button>
                            ))}
                          </div>
                        )}
                        <p className="answer-notice">{turn.answer.notice}</p>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={end} />
          </div>
          <div className="composer-area">
            <div className="mode-row">
              <label>
                <span>طريقة الإجابة</span>
                <select
                  aria-label="طريقة الإجابة"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="extractive">مقتطفات موثّقة · محلي</option>
                  <option value="grounded" disabled={!llm}>
                    إجابة مولّدة {llm ? "" : "· غير مفعّلة"}
                  </option>
                </select>
              </label>
              <span>{selected.length} مصادر محددة</span>
            </div>
            {mode === "grounded" && (
              <p className="external-warning">
                سيُرسل السؤال ومقتطفات المصادر المحددة إلى مزوّد التوليد الخارجي.
              </p>
            )}
            <form className="composer" onSubmit={ask}>
              <textarea
                aria-label="سؤالك عن المصادر"
                placeholder={
                  selected.length
                    ? "ما الذي تود فهمه من مصادرك؟"
                    : "أضف مصدرًا وحدده لتبدأ السؤال…"
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={2000}
                rows={2}
                disabled={!selected.length || !chat.loaded || chat.loading}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void ask();
                  }
                }}
              />
              <div className="composer-bottom">
                <span>
                  <ShieldCheck size={13} /> بحث مرتبط بالمصادر
                </span>
                <button
                  className="send-button"
                  aria-label="إرسال السؤال"
                  disabled={
                    !selected.length ||
                    !question.trim() ||
                    busy ||
                    !chat.loaded ||
                    chat.loading
                  }
                >
                  {busy ? <Busy /> : <ArrowLeft size={19} />}
                </button>
              </div>
            </form>
            <p className="composer-disclaimer">
              محادثتك محفوظة في هذا الدفتر. راجع المصدر دائمًا؛ الاستشهاد لا يضمن
              صحة الاستنتاج.
            </p>
          </div>
        </section>
      </div>
      {confirmClear && (
        <Modal
          title="مسح محادثة الدفتر؟"
          close={() => {
            if (!busy) setConfirmClear(false);
          }}
        >
          <p className="muted">
            سيُحذف سجل الأسئلة والإجابات والاستشهادات المحفوظ من هذا الدفتر. لن
            تُحذف مصادرك. لا يمكن التراجع عن هذا الإجراء.
          </p>
          <div className="confirm-actions">
            <button
              className="outline"
              disabled={busy}
              onClick={() => setConfirmClear(false)}
            >
              إلغاء
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (await chat.clear()) setConfirmClear(false);
              }}
            >
              {busy ? <Busy /> : <Trash2 size={16} />} مسح السجل نهائيًا
            </button>
          </div>
          {chat.error && (
            <p className="error" role="alert">
              {chat.error}
            </p>
          )}
        </Modal>
      )}
      {add && (
        <AddSource
          token={token}
          notebookId={notebook.id}
          close={() => setAdd(false)}
          done={() => {
            setAdd(false);
            void refresh();
          }}
        />
      )}
      {citation && (
        <CitationViewer
          citation={citation}
          token={token}
          close={() => setCitation(null)}
        />
      )}
    </main>
  );
}

function AddSource({
  token,
  notebookId,
  close,
  done,
}: {
  token: string;
  notebookId: string;
  close: () => void;
  done: () => void;
}) {
  const [type, setType] = useState<"pdf" | "text">("pdf"),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (type === "text") {
        await api(
          `/v1/notebooks/${notebookId}/sources/text`,
          token,
          json({ title: title.trim(), text: text.trim() }),
        );
      } else {
        if (!file) throw new Error("اختر ملفًا أولًا.");
        if (file.size > 10 * 1024 * 1024)
          throw new Error("الحد الأقصى لحجم الملف 10 ميجابايت.");
        const data = new FormData();
        data.append("file", file);
        await api(`/v1/notebooks/${notebookId}/sources/pdf-jobs`, token, {
          method: "POST",
          body: data,
        });
      }
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="أضف مصدرًا إلى دفترك" close={close}>
      <p className="muted">المعرفة التي تختارها هي نقطة انطلاق الإجابة.</p>
      <div className="auth-switch">
        <button
          className={type === "pdf" ? "active" : ""}
          onClick={() => setType("pdf")}
        >
          <FileText size={16} /> ملف PDF
        </button>
        <button
          className={type === "text" ? "active" : ""}
          onClick={() => setType("text")}
        >
          <MessageSquare size={16} /> نص مكتوب
        </button>
      </div>
      <form onSubmit={submit}>
        {type === "pdf" ? (
          <>
            <label className="file-picker">
              <Upload size={28} />
              <strong>{file?.name || "اختر ملفًا من جهازك"}</strong>
              <span>PDF نصي · حتى 10 ميجابايت و200 صفحة</span>
              <input
                aria-label="ملف PDF"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
              />
            </label>
            <p className="field-hint">
              تتم المعالجة في الخلفية. الملفات المصوّرة والمحمية غير مدعومة
              حاليًا.
            </p>
          </>
        ) : (
          <>
            <label>
              عنوان المصدر
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={200}
                placeholder="مثلًا: ملاحظات المحاضرة الأولى"
              />
            </label>
            <label>
              المحتوى
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                required
                maxLength={500000}
                placeholder="الصق ملاحظاتك أو النص الذي ترغب في دراسته…"
              />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary wide"
          disabled={
            busy || (type === "text" && (!text.trim() || !title.trim()))
          }
        >
          {busy ? <Busy /> : <Plus size={17} />}{" "}
          {busy ? "جارٍ الإضافة…" : "إضافة إلى مصادري"}
        </button>
      </form>
    </Modal>
  );
}
function CitationViewer({
  citation,
  token,
  close,
}: {
  citation: Citation;
  token: string;
  close: () => void;
}) {
  const [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<Page>(citation.url, token, { signal: controller.signal })
      .then(setPage)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [citation, token]);
  return (
    <Modal title="العودة إلى المصدر" close={close}>
      <div className="citation-heading">
        <span className="file-icon">
          <FileText size={22} />
        </span>
        <div>
          <strong>{citation.title}</strong>
          <small>الصفحة {citation.page} · نص مستخرج</small>
        </div>
      </div>
      <p className="field-hint">
        هذا عرض للمقاطع النصية، وليس للملف الأصلي. قد تتداخل المقاطع.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !page ? (
        <div className="loading-line">
          <Busy /> نفتح المرجع…
        </div>
      ) : (
        <div className="page-text">
          {page.chunks.map((chunk) => (
            <p
              dir="auto"
              key={chunk.id}
              className={chunk.id === citation.chunk_id ? "highlighted" : ""}
            >
              {chunk.text}
            </p>
          ))}
        </div>
      )}
      <div className="quote-box">
        <span>
          <CheckCheck size={15} /> المقتطف المستشهد به
        </span>
        <blockquote dir="auto">{citation.quote}</blockquote>
      </div>
    </Modal>
  );
}
