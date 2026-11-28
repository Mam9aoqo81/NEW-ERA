import SharedLearning from "./Sharing";
import StudyTools from "./StudyTools";
import { citationLabel, isTimed, safeVideoLink } from "./citations";
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
  Youtube,
  ExternalLink,
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
  return window.location.pathname === "/share" ? (
    <SharedLearning />
  ) : (
    <PrivateApp />
  );
}

function PrivateApp() {
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
    [semantic, setSemantic] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const clear = useCallback(() => {
    sessionStorage.removeItem("knowlm-token");
    setToken(null);
    setUser(null);
    setNotebooks([]);
    setSelected(null);
    setChecking(false);
    setFocus(false);
    setDeleteAccountOpen(false);
    setMobileNav(false);
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
    api<{ llm_configured: boolean; semantic_configured?: boolean }>("/health")
      .then((h) => {
        setLlm(h.llm_configured);
        setSemantic(!!h.semantic_configured);
      })
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
              aria-label="حذف الحساب"
              title="حذف الحساب"
              onClick={() => setDeleteAccountOpen(true)}
            >
              <Trash2 size={17} />
            </button>
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
            semantic={semantic}
            onDeleted={() => {
              const remaining = notebooks.filter((n) => n.id !== selected.id);
              setNotebooks(remaining);
              setSelected(remaining[0] || null);
            }}
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
      {deleteAccountOpen && user && (
        <DeleteAccount
          token={token}
          username={user.username}
          onDeleted={clear}
          close={() => setDeleteAccountOpen(false)}
        />
      )}
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

function DeleteAccount({
  token,
  username,
  onDeleted,
  close,
}: {
  token: string;
  username: string;
  onDeleted: () => void;
  close: () => void;
}) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || confirmation !== username) return;
    setBusy(true);
    setError("");
    try {
      await api("/v1/auth/delete-account", token, json({ password }));
      setPassword("");
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
      setPassword("");
      setBusy(false);
    }
  }
  return (
    <Modal
      title="حذف الحساب نهائيًا؟"
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="muted">
        سيُحذف حسابك وكل دفاترك ومصادرك ومحادثاتك وبطاقاتك ونتائجك من قاعدة
        البيانات النشطة، وستُلغى كل جلسات الدخول. لا يمكن التراجع.
      </p>
      <p className="field-hint">
        لا يشمل ذلك النسخ الاحتياطية أو بيانات سبق إرسالها لمزوّد خارجي أو نسخًا
        سبق تنزيلها. لو انقطع الرد بعد التنفيذ، أعد تحميل الصفحة للتحقق من
        صلاحية جلستك؛ فشل الاتصال وحده لا يؤكد الحذف.
      </p>
      <form onSubmit={submit}>
        <label>
          اكتب اسم المستخدم للتأكيد: {username}
          <input
            aria-label="اسم المستخدم لتأكيد حذف الحساب"
            autoComplete="off"
            value={confirmation}
            disabled={busy}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        <label>
          كلمة المرور الحالية
          <input
            type="password"
            autoComplete="current-password"
            minLength={10}
            maxLength={128}
            required
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className="outline"
            disabled={busy}
            onClick={close}
          >
            إلغاء حذف الحساب
          </button>
          <button
            className="danger"
            disabled={busy || confirmation !== username || password.length < 10}
          >
            {busy ? <Busy /> : <Trash2 size={16} />} حذف حسابي وكل دفاتري
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Workspace({
  notebook,
  token,
  llm,
  semantic,
  onDeleted,
}: {
  notebook: Notebook;
  token: string;
  llm: boolean;
  semantic: boolean;
  onDeleted: () => void;
}) {
  const [sources, setSources] = useState<Source[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [loaded, setLoaded] = useState(false),
    [sourceError, setSourceError] = useState(""),
    [add, setAdd] = useState(false),
    [question, setQuestion] = useState(""),
    [confirmClear, setConfirmClear] = useState(false),
    [mode, setMode] = useState<"extractive" | "grounded">("extractive"),
    [semanticConsent, setSemanticConsent] = useState(false),
    [citation, setCitation] = useState<Citation | null>(null),
    [tab, setTab] = useState<"chat" | "sources">("chat"),
    [sampleBusy, setSampleBusy] = useState(false),
    [toolsOpen, setToolsOpen] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [deleteTitle, setDeleteTitle] = useState(""),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState("");
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
  useEffect(() => {
    setSemanticConsent(false);
  }, [selected.join(",")]);
  async function ask(e?: FormEvent, suggested?: string) {
    e?.preventDefault();
    const q = (suggested || question).trim();
    if (!q || !selected.length || busy || !chat.loaded || chat.loading) return;
    setQuestion("");
    await chat.send(q, selected, mode, semanticConsent);
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
        <div className="notebook-heading-actions">
          <button
            className="icon-button"
            aria-label="حذف الدفتر"
            title="حذف الدفتر"
            onClick={() => {
              setDeleteTitle("");
              setDeleteError("");
              setConfirmDelete(true);
            }}
          >
            <Trash2 size={18} />
          </button>
          <button
            className="outline tools-open-button"
            aria-pressed={toolsOpen}
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            <Layers3 size={16} />
            {toolsOpen ? "العودة للمحادثة" : "أدوات المراجعة"}
          </button>
          <button
            className="outline"
            onClick={() => {
              setAdd(true);
              setTab("sources");
            }}
          >
            <Plus size={17} /> إضافة مصدر
          </button>
        </div>
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
          {semanticConsent
            ? "البحث الدلالي · إرسال خارجي بموافقتك"
            : llm
              ? "التوليد الاختياري متاح"
              : "البحث المحلي · دون إرسال خارجي"}
        </span>
      </div>
      <div className={`mobile-tabs ${toolsOpen ? "tools-hidden" : ""}`}>
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
      {toolsOpen && (
        <StudyTools
          notebookId={notebook.id}
          token={token}
          sourceIds={selected}
          onCitation={setCitation}
        />
      )}
      <div className={`study-grid ${toolsOpen ? "tools-hidden" : ""}`}>
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
                  أضف محاضرة أو فيديو YouTube،
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
                        {s.kind === "youtube" ? (
                          <Youtube size={19} />
                        ) : (
                          <FileText size={19} />
                        )}
                      </span>
                      <span className="source-info">
                        <strong dir="auto">{s.title}</strong>
                        <small>
                          {s.kind === "pdf"
                            ? "PDF"
                            : s.kind === "docx"
                              ? "Word · فقرات"
                              : s.kind === "youtube"
                                ? "YouTube"
                                : "نص"}{" "}
                          <span>·</span>{" "}
                          {s.status === "ready"
                            ? "جاهز للدراسة"
                            : s.status === "failed"
                              ? "تعثّرت المعالجة"
                              : "جارٍ استخراج النص"}
                        </small>
                      </span>
                    </label>
                    {!!s.ocr_pages?.length && (
                      <p className="transcript-provenance">
                        OCR محلي · صفحات {s.ocr_pages.join("، ")} · راجع الأصل
                        لاحتمال أخطاء القراءة
                      </p>
                    )}
                    {s.kind === "youtube" && (
                      <p className="transcript-provenance">
                        {s.transcript_origin === "user_captions"
                          ? "نص مرفق يدويًا · غير مطابق آليًا للفيديو"
                          : "يعتمد على النص المتاح للفيديو"}
                      </p>
                    )}
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
              <small>PDF أو Word أو YouTube أو نصوصك</small>
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
                                <small dir={isTimed(c) ? "ltr" : undefined}>
                                  {citationLabel(c)}
                                </small>
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
            {semantic && (
              <label className="external-warning">
                <input
                  type="checkbox"
                  checked={semanticConsent}
                  onChange={(e) => setSemanticConsent(e.target.checked)}
                />
                أوافق على إرسال السؤال وكل مقاطع المصادر المحددة إلى مزوّد
                embeddings الخارجي للبحث الدلالي التجريبي. قد تترتب تكلفة؛
                التشابه ليس إثباتًا لصحة الإجابة. تُلغى الموافقة عند تغيير
                المصادر.
              </label>
            )}
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
      {confirmDelete && (
        <Modal
          title="حذف الدفتر وكل بياناته؟"
          close={() => {
            if (!deleting) setConfirmDelete(false);
          }}
        >
          <p className="muted">
            سيُحذف هذا الدفتر ومصادره وملفاته المحفوظة ومحادثاته وبطاقاته
            ومراجعاته واختباراته ونتائجه وخرائطه من قاعدة البيانات النشطة. لا
            يمكن التراجع. لا يحذف ذلك نسخًا احتياطية أو بيانات سبق إرسالها لخدمة
            خارجية.
          </p>
          <p className="field-hint">
            لن يستطيع عامل المعالجة إعادة نشر مصادر هذا الدفتر بعد الحذف. أي طلب
            خارجي بدأ بالفعل قد يستمر عند مزوّده.
          </p>
          <label>
            اكتب اسم الدفتر للتأكيد: {notebook.title}
            <input
              aria-label="اسم الدفتر لتأكيد الحذف"
              value={deleteTitle}
              onChange={(e) => setDeleteTitle(e.target.value)}
              disabled={deleting}
              autoComplete="off"
            />
          </label>
          {deleteError && (
            <p className="error" role="alert">
              {deleteError}
            </p>
          )}
          <div className="confirm-actions">
            <button
              className="outline"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              إلغاء الحذف
            </button>
            <button
              className="danger"
              disabled={deleting || deleteTitle !== notebook.title}
              onClick={async () => {
                setDeleting(true);
                setDeleteError("");
                try {
                  await api(`/v1/notebooks/${notebook.id}`, token, {
                    method: "DELETE",
                  });
                  onDeleted();
                } catch (e) {
                  // A lost DELETE response must not leave a removed notebook open.
                  try {
                    const remaining = await api<Notebook[]>(
                      "/v1/notebooks",
                      token,
                    );
                    if (!remaining.some((n) => n.id === notebook.id)) {
                      onDeleted();
                      return;
                    }
                  } catch {
                    /* Preserve the original failure if status cannot be confirmed. */
                  }
                  setDeleteError(errorMessage(e));
                  setDeleting(false);
                }
              }}
            >
              {deleting ? <Busy /> : <Trash2 size={16} />} حذف الدفتر نهائيًا
            </button>
          </div>
        </Modal>
      )}
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
  const [type, setType] = useState<"pdf" | "docx" | "text" | "youtube">("pdf"),
    [videoUrl, setVideoUrl] = useState(""),
    [manualCaptions, setManualCaptions] = useState(false),
    [youtubeAuto, setYoutubeAuto] = useState<boolean | null>(null),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ youtube_auto_fetch_enabled?: boolean }>("/health")
      .then((h) => {
        if (active) {
          const enabled = h.youtube_auto_fetch_enabled !== false;
          setYoutubeAuto(enabled);
          if (!enabled) setManualCaptions(true);
        }
      })
      .catch(() => {
        if (active) {
          setYoutubeAuto(false);
          setManualCaptions(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (type === "youtube") {
        await api(
          `/v1/notebooks/${notebookId}/sources/youtube-jobs`,
          token,
          json({
            url: videoUrl.trim(),
            title: title.trim() || undefined,
            captions: manualCaptions ? text : undefined,
          }),
        );
      } else if (type === "text") {
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
        await api(`/v1/notebooks/${notebookId}/sources/${type}-jobs`, token, {
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
          onClick={() => {
            setType("pdf");
            setFile(null);
          }}
        >
          <FileText size={16} /> ملف PDF
        </button>
        <button
          className={type === "docx" ? "active" : ""}
          onClick={() => {
            setType("docx");
            setFile(null);
          }}
        >
          <FileText size={16} /> Word
        </button>
        <button
          className={type === "text" ? "active" : ""}
          onClick={() => setType("text")}
        >
          <MessageSquare size={16} /> نص مكتوب
        </button>
        <button
          className={type === "youtube" ? "active" : ""}
          onClick={() => setType("youtube")}
        >
          <Youtube size={16} /> YouTube
        </button>
      </div>
      <form onSubmit={submit}>
        {type === "pdf" || type === "docx" ? (
          <>
            <label className="file-picker">
              <Upload size={28} />
              <strong>{file?.name || "اختر ملفًا من جهازك"}</strong>
              <span>
                {type === "docx"
                  ? "DOCX · حتى 10 ميجابايت و5000 فقرة"
                  : "PDF · حتى 10 ميجابايت و200 صفحة"}
              </span>
              <input
                aria-label={type === "docx" ? "ملف Word" : "ملف PDF"}
                type="file"
                accept={
                  type === "docx"
                    ? ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    : "application/pdf,.pdf"
                }
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
              />
            </label>
            <p className="field-hint">
              {type === "docx"
                ? "نستخرج فقرات المتن والجداول فقط، وليس الصور أو الهوامش أو التعليقات. المرجع رقم فقرة مستخرجة، وليس صفحة Word الأصلية. ملفات DOC وDOCM غير مدعومة."
                : "تتم المعالجة في الخلفية. قراءة الصفحات المصوّرة تحتاج OCR محليًا مفعّلًا لدى المشغّل (حتى 10 صفحات مصوّرة). الملفات المحمية غير مدعومة."}
            </p>
          </>
        ) : type === "youtube" ? (
          <>
            <label>
              رابط فيديو YouTube
              <input
                autoFocus
                type="url"
                dir="ltr"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                required
                maxLength={2048}
              />
            </label>
            <label>
              عنوان الفيديو (اختياري)
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="مثلًا: محاضرة البناء الضوئي"
              />
            </label>
            <p className="field-hint">
              ندعم روابط الفيديو العادية وyoutu.be وShorts. نبحث في النص المصاحب
              فقط، لا في صور الفيديو. الاستيراد التلقائي يتصل بـYouTube وقد
              يتعذّر بسبب قيود المنصة.
            </p>
            {youtubeAuto === false && (
              <p className="external-warning">
                الاستيراد التلقائي غير متاح في هذه البيئة. أرفق نصًا موقّتًا
                للفيديو بصيغة SRT أو VTT.
              </p>
            )}
            <label className="manual-caption-toggle">
              <input
                type="checkbox"
                checked={manualCaptions}
                disabled={youtubeAuto === false}
                onChange={(e) => setManualCaptions(e.target.checked)}
              />{" "}
              لدي ترجمة موقّتة SRT أو VTT
            </label>
            {manualCaptions && (
              <>
                <label className="caption-file">
                  استيراد ملف ترجمة (اختياري)
                  <input
                    type="file"
                    accept=".srt,.vtt,text/vtt,text/plain"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        if (f.size > 2 * 1024 * 1024)
                          throw new Error("ملف الترجمة أكبر من 2 ميجابايت.");
                        setText(await f.text());
                        setError("");
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  />
                </label>
                <label>
                  نص الترجمة الموقّت
                  <textarea
                    dir="auto"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={6}
                    maxLength={500000}
                    required
                    placeholder={
                      "WEBVTT\n\n00:00:15.000 --> 00:00:22.000\nنص المقطع هنا…"
                    }
                  />
                </label>
                <p className="field-hint">
                  أرفق نصًا تملكه أو لديك حق استخدامه. سيُوسم بأنه مضاف يدويًا؛ لا
                  نتحقق من مطابقته للفيديو.
                </p>
              </>
            )}
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
            busy ||
            (type === "text" && (!text.trim() || !title.trim())) ||
            (type === "youtube" &&
              (!videoUrl.trim() ||
                (manualCaptions && !text.trim()) ||
                (!manualCaptions && youtubeAuto !== true)))
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
          <small>
            {isTimed(citation) ? (
              <>
                توقيت المقطع <bdi dir="ltr">{citationLabel(citation)}</bdi> · نص
                الفيديو
              </>
            ) : citation.locator_type === "paragraph" ? (
              <>الفقرة {citation.paragraph} · نص Word مستخرج</>
            ) : (
              <>الصفحة {citation.page} · نص مستخرج</>
            )}
          </small>
        </div>
      </div>
      <p className="field-hint">
        {isTimed(citation)
          ? "الاستشهاد يشير إلى توقيت المقطع في نص الفيديو، وليس إلى تحليل الصور أو الصوت مباشرة."
          : citation.locator_type === "paragraph"
            ? "المرجع رقم فقرة في متن Word المستخرج، وليس رقم صفحة أو موضعًا مضمونًا في تخطيط الملف الأصلي."
            : "هذا عرض للمقاطع النصية، وليس للملف الأصلي. قد تتداخل المقاطع."}
      </p>
      {citation.ocr && (
        <p className="external-warning">
          هذا النص قُرئ آليًا من صورة بواسطة OCR وقد يحتوي أخطاء، خاصة الأرقام
          والتشكيل والجداول. رقم الصفحة محفوظ، لكن موضع الكلمات غير محدد. راجع
          الملف الأصلي قبل الاعتماد عليه.
        </p>
      )}
      {isTimed(citation) && citation.transcript_origin === "user_captions" && (
        <p className="external-warning">
          هذا النص مرفق يدويًا، ولم يُتحقق من مطابقته للفيديو.
        </p>
      )}
      {safeVideoLink(citation.media_url) && (
        <a
          className="video-link"
          href={safeVideoLink(citation.media_url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Youtube size={18} /> فتح الفيديو عند هذا التوقيت{" "}
          <ExternalLink size={14} />
        </a>
      )}
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
