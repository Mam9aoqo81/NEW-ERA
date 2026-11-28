import Pomodoro from "./Pomodoro";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, json, type Answer, type User } from "./api";
import type { Turn } from "./useNotebookChat";
import "./collaboration.css";

type Role = "owner" | "editor" | "viewer";
type Settings = {
  role: Role;
  members?: { user_id: string; username: string; role: string }[];
  invitations?: { id: string; username: string; role: string }[];
};
type Message = {
  id: number;
  username: string;
  user_id: string;
  content: { text: string; question?: string; answer?: Answer };
  created_at: string;
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : "تعذّر إكمال الطلب.";
const label: Record<string, string> = {
  owner: "مالك",
  editor: "محرر",
  viewer: "قارئ",
};

export default function Collaboration({
  notebookId,
  token,
  turns,
  onRole,
  onLeave,
}: {
  notebookId: string;
  token: string;
  turns: Turn[];
  onRole: (role: Role) => void;
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(false),
    [settings, setSettings] = useState<Settings | null>(null),
    [rows, setRows] = useState<Message[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [username, setUsername] = useState(""),
    [role, setRole] = useState("viewer"),
    [consent, setConsent] = useState(false),
    [link, setLink] = useState(""),
    [text, setText] = useState(""),
    [turnId, setTurnId] = useState(""),
    [publish, setPublish] = useState(false),
    [confirm, setConfirm] = useState<null | { path: string; label: string }>(
      null,
    ),
    [me, setMe] = useState<User | null>(null);
  const base = `/v1/notebooks/${notebookId}`,
    mounted = useRef(true);
  const pending = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [state, page, user] = await Promise.all([
          api<Settings>(base + "/collaboration", token, { signal }),
          api<{ messages: Message[]; next_after: number }>(
            base + "/room?limit=1000",
            token,
            { signal },
          ),
          api<User>("/v1/auth/me", token, { signal }),
        ]);
        if (signal?.aborted) return;
        setSettings(state);
        onRole(state.role);
        setRows(page.messages);
        setMe(user);
        setError("");
      } catch (e) {
        if (!signal?.aborted) {
          setError(message(e));
          setRows([]);
          setSettings(null);
        }
      }
    },
    [base, token, onRole],
  );
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [open, refresh]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (mounted.current) setError(message(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!consent) return;
    await run(async () => {
      const result = await api<{ token: string }>(
        base + "/invitations",
        token,
        json({ username: username.trim(), role, consent }),
      );
      setLink(`${window.location.origin}/join#${result.token}`);
      setConsent(false);
      await refresh();
    });
  }
  async function post(e: FormEvent) {
    e.preventDefault();
    if (!publish) return;
    const content = {
      text,
      turn_id: turnId ? Number(turnId) : null,
      consent: publish,
    };
    const key = JSON.stringify(content);
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    await run(async () => {
      await api(
        base + "/room",
        token,
        json({ ...content, request_id: pending.current!.id }),
      );
      pending.current = null;
      setText("");
      setTurnId("");
      setPublish(false);
      await refresh();
    });
  }
  return (
    <section className="collaboration-panel">
      <button
        className="outline"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        التعاون وغرفة الدفتر
      </button>
      {open && (
        <div className="collaboration-body">
          <h2>التعاون وغرفة الدفتر</h2>
          <p className="external-warning">
            الأعضاء يرون كل مصادر هذا الدفتر ومخرجاته، بما فيها المضافة لاحقًا.
            محادثتك العادية ونتائجك وجدولة مراجعتك تظل خاصة؛ لا تظهر هنا إلا
            إجابة تختار نشرها. تحديث الغرفة كل 5 ثوانٍ، وليس تحريرًا لحظيًا مشتركًا.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {settings && (
            <>
              <p>صلاحيتك: {label[settings.role]}</p>
              <Pomodoro
                key={notebookId}
                notebookId={notebookId}
                token={token}
              />
              {settings.role === "owner" ? (
                <>
                  <form onSubmit={invite}>
                    <h3>دعوة مرتبطة باسم مستخدم</h3>
                    <label>
                      اسم المستخدم المدعو
                      <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        pattern="[a-zA-Z0-9_]{3,40}"
                        required
                        maxLength={40}
                      />
                    </label>
                    <label>
                      صلاحية المدعو
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                      >
                        <option value="viewer">
                          قارئ · المصادر والمراجعة الشخصية والغرفة
                        </option>
                        <option value="editor">
                          محرر · يضيف المصادر ويعدل أدوات الدراسة أيضًا
                        </option>
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      أوافق على إتاحة كل مصادر هذا الدفتر ومخرجاته لهذا الحساب،
                      وأملك حق مشاركتها. يمكن للمستلم نسخها ولا يمكن سحب ما قرأه
                      بالفعل.
                    </label>
                    <button className="primary" disabled={busy || !consent}>
                      إنشاء دعوة لمدة 7 أيام
                    </button>
                  </form>
                  {link && (
                    <label>
                      رابط دعوة جديد
                      <input
                        readOnly
                        value={link}
                        onFocus={(e) => e.target.select()}
                      />
                    </label>
                  )}
                  <h3>الأعضاء</h3>
                  {settings.members?.map((m) => (
                    <div className="collaboration-member" key={m.user_id}>
                      <b dir="ltr">{m.username}</b>
                      <select
                        aria-label={`صلاحية ${m.username}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) =>
                          void run(async () => {
                            await api(base + `/members/${m.user_id}`, token, {
                              ...json({ role: e.target.value }),
                              method: "PATCH",
                            });
                            await refresh();
                          })
                        }
                      >
                        <option value="viewer">قارئ</option>
                        <option value="editor">محرر</option>
                      </select>
                      <button
                        className="outline"
                        onClick={() =>
                          setConfirm({
                            path: base + `/members/${m.user_id}`,
                            label: `إزالة ${m.username}`,
                          })
                        }
                      >
                        إزالة {m.username}
                      </button>
                    </div>
                  ))}
                  {settings.invitations?.map((i) => (
                    <p key={i.id}>
                      دعوة {i.username} · {label[i.role]}{" "}
                      <button
                        className="outline"
                        onClick={() =>
                          setConfirm({
                            path: base + `/invitations/${i.id}`,
                            label: "إلغاء الدعوة",
                          })
                        }
                      >
                        إلغاء دعوة {i.username}
                      </button>
                    </p>
                  ))}
                </>
              ) : (
                <>
                  <p>
                    إضافة المصادر وتعديل الأدوات مشتركان للمحرر. الحذف والدعوات
                    والنشر العام للمالك فقط. أي مساهمة تضيفها للدفتر تبقى لديه
                    حتى لو غادرت أو حذفت حسابك، بخلاف رسائلك ومحادثتك ونتائجك
                    الشخصية.
                  </p>
                  <button
                    className="outline"
                    onClick={() =>
                      setConfirm({
                        path: base + "/membership",
                        label: "مغادرة الدفتر",
                      })
                    }
                  >
                    مغادرة الدفتر
                  </button>
                </>
              )}
              {confirm && (
                <div className="external-warning">
                  <p>
                    {confirm.label}؟ سيمنع ذلك الطلبات الجديدة، لكنه لا يسحب
                    نسخًا وصلت بالفعل.
                  </p>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(confirm.path, token, { method: "DELETE" });
                        const left = confirm.path.endsWith("/membership");
                        setConfirm(null);
                        if (left) onLeave();
                        else await refresh();
                      })
                    }
                  >
                    تأكيد {confirm.label}
                  </button>
                  <button className="outline" onClick={() => setConfirm(null)}>
                    إلغاء الإجراء
                  </button>
                </div>
              )}
              <h3>رسائل الغرفة</h3>
              <button
                className="outline"
                disabled={busy}
                onClick={() => void refresh()}
              >
                تحديث الغرفة
              </button>
              {rows.map((row) => (
                <article className="room-message" key={row.id}>
                  <header>
                    <b dir="ltr">{row.username}</b>
                    <small>
                      {new Date(row.created_at).toLocaleString("ar-EG")}
                    </small>
                  </header>
                  <p dir="auto">{row.content.text}</p>
                  {row.content.answer && (
                    <>
                      <strong dir="auto">{row.content.question}</strong>
                      <p dir="auto">{row.content.answer.answer}</p>
                      <p className="field-hint">{row.content.answer.notice}</p>
                      {row.content.answer.citations.map((c, i) => (
                        <p key={i} dir="auto">
                          [{i + 1}] {c.title} ·{" "}
                          {c.page
                            ? `ص ${c.page}`
                            : c.paragraph
                              ? `فقرة ${c.paragraph}`
                              : `${c.start_seconds} ثانية`}{" "}
                          · {c.quote}
                          {c.ocr ? " · OCR قد يخطئ" : ""}
                        </p>
                      ))}
                    </>
                  )}
                  {(settings.role === "owner" || me?.id === row.user_id) && (
                    <button
                      className="outline"
                      onClick={() =>
                        setConfirm({
                          path: base + `/room/${row.id}`,
                          label: "حذف الرسالة",
                        })
                      }
                    >
                      حذف الرسالة
                    </button>
                  )}
                </article>
              ))}
              <form onSubmit={post}>
                <label>
                  رسالة لأعضاء الدفتر
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={2000}
                    rows={3}
                  />
                </label>
                <label>
                  إرفاق إجابة من محادثتي الخاصة
                  <select
                    value={turnId}
                    onChange={(e) => setTurnId(e.target.value)}
                  >
                    <option value="">بدون إجابة</option>
                    {turns
                      .filter((t) => t.saved && t.answer?.turn_id)
                      .map((t) => (
                        <option key={t.id} value={t.answer!.turn_id}>
                          {t.question.slice(0, 100)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={publish}
                    onChange={(e) => setPublish(e.target.checked)}
                  />
                  راجعت الرسالة والإجابة المرفقة وأوافق على نشرهما لأعضاء هذا
                  الدفتر، وليس للعامة.
                </label>
                <button
                  className="primary"
                  disabled={busy || !publish || (!text.trim() && !turnId)}
                >
                  نشر في غرفة الدفتر
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function JoinNotebook({
  auth,
}: {
  auth: (onLogin: (token: string, user: User) => void) => React.ReactNode;
}) {
  const [token, setToken] = useState(() =>
      sessionStorage.getItem("knowlm-token"),
    ),
    [invitation, setInvitation] = useState<{
      title: string;
      role: string;
    } | null>(null),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [joined, setJoined] = useState(false);
  const [capability, setCapability] = useState(() =>
    window.location.hash.slice(1),
  );
  useEffect(() => {
    const change = () => {
      setCapability(window.location.hash.slice(1));
      setInvitation(null);
      setConsent(false);
      setJoined(false);
      setError("");
    };
    window.addEventListener("hashchange", change);
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.append(meta);
    return () => {
      window.removeEventListener("hashchange", change);
      meta.remove();
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setInvitation(null);
    setConsent(false);
    api<{ title: string; role: string }>(
      "/v1/collaboration/invitation",
      token,
      { headers: { "X-KnowLM-Invite": capability }, signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) setInvitation(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [token, capability]);
  if (!token)
    return (
      <>
        <p className="external-warning" dir="rtl">
          دعوة خاصة بحساب محدد. سجّل الدخول بالحساب المدعو؛ الرابط لا يمنح شخصًا
          آخر صلاحيات.
        </p>
        {auth((value) => {
          sessionStorage.setItem("knowlm-token", value);
          setToken(value);
        })}
      </>
    );
  async function accept() {
    if (!invitation || !consent || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/v1/collaboration/accept", token, {
        ...json({ consent }),
        headers: { "X-KnowLM-Invite": capability },
      });
      if (window.location.hash.slice(1) === capability) setJoined(true);
    } catch (e) {
      setError(
        message(e) +
          " إذا انقطع الرد بعد القبول، افتح مساحة الدراسة للتحقق من الدفتر.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shared-page" dir="rtl">
      <a href="/">KnowLM · مساحة الدراسة</a>
      <h1>دعوة للتعاون</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {joined ? (
        <p role="status">انضممت للدفتر. افتح مساحة الدراسة لتجده في مكتبتك.</p>
      ) : (
        invitation && (
          <>
            <h2>{invitation.title}</h2>
            <p>صلاحيتك: {label[invitation.role]}</p>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              أقبل الوصول لمصادر الدفتر وأحترم خصوصيتها وحقوقها. مساهماتي في
              المصادر والأدوات مشتركة وتبقى لدى مالك الدفتر، ومحادثتي ونتائجي
              خاصة إلا ما أنشره في الغرفة.
            </label>
            <button
              className="primary"
              disabled={!consent || busy}
              onClick={() => void accept()}
            >
              قبول دعوة الدفتر
            </button>
          </>
        )
      )}
    </main>
  );
}
