import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, json, type User } from "./api";
import "./community.css";

type Catalog = {
  countries: Record<string, string>;
  stages: Record<string, string>;
  subjects: Record<string, string>;
};
type Post = {
  id: string;
  title: string;
  kind: string;
  publisher: User;
  country: string;
  stage: string;
  subject: string;
  curriculum: string;
  expires_at: string;
  items?: {
    front?: string;
    back?: string;
    prompt?: string;
    choices?: string[];
  }[];
};
type Activity = { saved: string[]; following: string[]; blocked: User[] };
const message = (e: unknown) =>
  e instanceof Error ? e.message : "تعذّر تنفيذ الطلب.";
const empty: Activity = { saved: [], following: [], blocked: [] };

export function PublicPublisher({
  shareId,
  token,
  title,
}: {
  shareId: string;
  token: string;
  title: string;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<{
      snapshot: unknown;
      preview_hash: string;
    } | null>(null),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [country, setCountry] = useState("EG"),
    [stage, setStage] = useState("secondary"),
    [subject, setSubject] = useState("biology"),
    [curriculum, setCurriculum] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [link, setLink] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPreview(null);
    setConsent(false);
    Promise.all([
      api<typeof preview>(`/v1/shares/${shareId}/public-preview`, token, {
        signal: controller.signal,
      }),
      api<Catalog>("/v1/community/catalog", null, {
        signal: controller.signal,
      }),
    ])
      .then(([p, c]) => {
        if (!controller.signal.aborted) {
          setPreview(p);
          setCatalog(c);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [open, shareId, token]);
  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!preview || !consent || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Post>(
        "/v1/community/posts",
        token,
        json({
          share_id: shareId,
          preview_hash: preview.preview_hash,
          country,
          stage,
          subject,
          curriculum: curriculum.trim(),
          consent,
        }),
      );
      setLink(`${window.location.origin}/community#${result.id}`);
      setConsent(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="public-publisher">
      <button
        className="outline"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        نشر للمجتمع: {title}
      </button>
      {open && (
        <form onSubmit={publish}>
          <p className="external-warning">
            هذا نشر عام قابل للاكتشاف والنسخ، وليس مجرد رابط غير مدرج. سيظهر اسم
            حسابك والنص المعاين والتصنيف. لا تُفتح المصادر الخاصة. التصنيف ذاتي
            وليس اعتمادًا من منهج أو جهة رسمية. إلغاء الرابط أو انتهاؤه يخفي
            المنشور، لكنه لا يسحب النسخ التي وصلت للآخرين.
          </p>
          {preview && (
            <details open>
              <summary>النص المراد نشره للعامة</summary>
              <pre dir="auto">{JSON.stringify(preview.snapshot, null, 2)}</pre>
            </details>
          )}
          {catalog && (
            <>
              <label>
                الدولة
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  {Object.entries(catalog.countries).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                المرحلة
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                >
                  {Object.entries(catalog.stages).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                المادة
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  {Object.entries(catalog.subjects).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            اسم المنهج وإصداره
            <input
              required
              maxLength={100}
              value={curriculum}
              onChange={(e) => setCurriculum(e.target.value)}
              placeholder="مثال: أحياء عام · 2026/2027"
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            راجعت كل النص وأملك حق نشره للعامة، وأوافق على ظهور اسم حسابي
            والتصنيف معه. لا يحتوي معلومات خاصة، ولا أقدمه كختم جودة أو اعتماد
            رسمي.
          </label>
          <button
            className="primary"
            disabled={
              busy || !preview || !catalog || !consent || !curriculum.trim()
            }
          >
            تأكيد النشر العام
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {link && <a href={link}>فتح المنشور العام</a>}
        </form>
      )}
    </div>
  );
}

export default function Community({
  auth,
}: {
  auth: (onLogin: (token: string, user: User) => void) => ReactNode;
}) {
  const [token, setToken] = useState(() =>
      sessionStorage.getItem("knowlm-token"),
    ),
    [login, setLogin] = useState(false),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [posts, setPosts] = useState<Post[]>([]),
    [selected, setSelected] = useState(() => window.location.hash.slice(1)),
    [post, setPost] = useState<Post | null>(null),
    [comments, setComments] = useState<
      { id: number; user_id: string; username: string; text: string }[]
    >([]),
    [activity, setActivity] = useState<Activity>(empty),
    [me, setMe] = useState<User | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [country, setCountry] = useState(""),
    [stage, setStage] = useState(""),
    [subject, setSubject] = useState(""),
    [curriculum, setCurriculum] = useState(""),
    [publisher, setPublisher] = useState(""),
    [profile, setProfile] = useState<{
      username: string;
      active_posts: number;
    } | null>(null),
    [mode, setMode] = useState("all"),
    [next, setNext] = useState<number | null>(null),
    [text, setText] = useState(""),
    [consent, setConsent] = useState(false),
    [reason, setReason] = useState("privacy"),
    [note, setNote] = useState(""),
    [answers, setAnswers] = useState<Record<number, number>>({}),
    [result, setResult] = useState<{
      correct: number;
      total: number;
      questions: { explanation: string }[];
    } | null>(null),
    [confirm, setConfirm] = useState<null | {
      label: string;
      path: string;
      method: string;
    }>(null);
  const refreshActivity = useCallback(async () => {
    if (!token) {
      setMe(null);
      setActivity(empty);
      return;
    }
    const [a, u] = await Promise.all([
      api<Activity>("/v1/community/me", token),
      api<User>("/v1/auth/me", token),
    ]);
    setActivity(a);
    setMe(u);
  }, [token]);
  useEffect(() => {
    const expired = () => {
      sessionStorage.removeItem("knowlm-token");
      setToken(null);
      setActivity(empty);
      setMe(null);
      setLogin(true);
    };
    window.addEventListener("knowlm:expired", expired);
    return () => window.removeEventListener("knowlm:expired", expired);
  }, []);
  useEffect(() => {
    void refreshActivity().catch((e) => setError(message(e)));
  }, [refreshActivity]);
  useEffect(() => {
    const controller = new AbortController();
    api<Catalog>("/v1/community/catalog", null, { signal: controller.signal })
      .then((c) => {
        if (!controller.signal.aborted) setCatalog(c);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const change = () => {
      setSelected(window.location.hash.slice(1));
      setPost(null);
      setComments([]);
      setResult(null);
      setAnswers({});
      setNote("");
      setConsent(false);
      setText("");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const loadFeed = useCallback(
    async (offset = 0, signal?: AbortSignal) => {
      const q = new URLSearchParams({ offset: String(offset) });
      for (const [key, value] of Object.entries({
        country,
        stage,
        subject,
        curriculum: curriculum.trim(),
        publisher,
      }))
        if (value) q.set(key, value);
      if (mode !== "all") q.set(mode, "true");
      const page = await api<{ posts: Post[]; next_offset: number | null }>(
        `/v1/community/feed?${q}`,
        token,
        { signal },
      );
      if (!signal?.aborted) {
        setPosts((old) =>
          offset
            ? [...old, ...page.posts].filter(
                (p, i, all) => all.findIndex((x) => x.id === p.id) === i,
              )
            : page.posts,
        );
        setNext(page.next_offset);
      }
    },
    [country, stage, subject, curriculum, publisher, mode, token],
  );
  const loadPost = useCallback(
    async (signal?: AbortSignal) => {
      if (!selected) return;
      const [p, c] = await Promise.all([
        api<Post>(`/v1/community/posts/${selected}`, token, { signal }),
        api<typeof comments>(
          `/v1/community/posts/${selected}/comments`,
          token,
          { signal },
        ),
      ]);
      if (!signal?.aborted) {
        setPost(p);
        setComments(c);
      }
    },
    [selected, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPost(null);
    setComments([]);
    setAnswers({});
    setResult(null);
    const request = selected
      ? loadPost(controller.signal)
      : loadFeed(0, controller.signal);
    request.catch((e) => {
      if (!controller.signal.aborted) setError(message(e));
    });
    return () => controller.abort();
  }, [selected, loadFeed, loadPost]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, method: string, data?: unknown) {
    if (!token) {
      setLogin(true);
      return;
    }
    await api(path, token, {
      ...(data === undefined ? {} : json(data)),
      method,
    });
    await refreshActivity();
  }
  async function openProfile(id: string) {
    await run(async () => {
      const p = await api<{ username: string; active_posts: number }>(
        `/v1/community/publishers/${id}`,
        token,
      );
      setProfile(p);
      setPublisher(id);
      window.location.hash = "";
      setSelected("");
    });
  }
  if (login)
    return (
      <>
        <p className="external-warning" dir="rtl">
          تسجيل الدخول للحفظ والمتابعة والتعليق والإبلاغ. القراءة العامة لا
          تحتاج حسابًا.
        </p>
        {auth((value) => {
          sessionStorage.setItem("knowlm-token", value);
          setToken(value);
          setLogin(false);
        })}
      </>
    );
  return (
    <main className="community-page" dir="rtl">
      <header className="community-header">
        <a href="/">KnowLM · مساحة الدراسة</a>
        <h1>مجتمع المراجعة</h1>
        {!token && (
          <button className="outline" onClick={() => setLogin(true)}>
            تسجيل الدخول للمجتمع
          </button>
        )}
      </header>
      <p className="external-warning">
        منشورات أصحابها، غير مدققة علميًا. التصنيف والمنهج ذاتيان؛ لا نعتمدها
        رسميًا ولا نعرض ختم جودة أو سمعة AI. لا تكتب معلومات حساسة في تعليق عام.
        الحظر يفلتر الحسابات المسجلة ولا يجعل منشورًا عامًا سريًا عن الزوار.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {note && <p role="status">{note}</p>}
      {confirm && (
        <div className="external-warning">
          <p>{confirm.label}؟</p>
          <button
            className="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await mutate(confirm.path, confirm.method);
                const hidden =
                  confirm.path.endsWith("/block") ||
                  (confirm.path.includes("/posts/") &&
                    !confirm.path.includes("/comments/"));
                setConfirm(null);
                if (hidden) {
                  window.location.hash = "";
                  setSelected("");
                  setPost(null);
                  await loadFeed();
                } else if (selected) await loadPost();
                else await loadFeed();
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
      {!selected ? (
        <>
          {token && (
            <div className="community-actions">
              <button
                className="outline"
                disabled={busy || !activity.saved.length}
                onClick={() =>
                  setConfirm({
                    label: "مسح كل المحفوظات بما فيها المنتهية",
                    path: "/v1/community/me/saves",
                    method: "DELETE",
                  })
                }
              >
                مسح المحفوظات
              </button>
              <button
                className="outline"
                disabled={busy || !activity.following.length}
                onClick={() =>
                  setConfirm({
                    label: "إلغاء كل المتابعات",
                    path: "/v1/community/me/follows",
                    method: "DELETE",
                  })
                }
              >
                مسح المتابعات
              </button>
            </div>
          )}
          <section className="community-filters" aria-label="تصفية المنشورات">
            {catalog && (
              <>
                {(
                  [
                    [
                      "country",
                      "الدولة",
                      country,
                      setCountry,
                      catalog.countries,
                    ],
                    ["stage", "المرحلة", stage, setStage, catalog.stages],
                    [
                      "subject",
                      "المادة",
                      subject,
                      setSubject,
                      catalog.subjects,
                    ],
                  ] as const
                ).map(([key, title, value, change, values]) => (
                  <label key={key}>
                    {title}
                    <select
                      value={value}
                      onChange={(e) => change(e.target.value)}
                    >
                      <option value="">الكل</option>
                      {Object.entries(values).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
            )}
            <label>
              اسم المنهج وإصداره بالتطابق الكامل
              <input
                value={curriculum}
                onChange={(e) => setCurriculum(e.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              عرض
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="all">كل المنشورات</option>
                <option value="saved" disabled={!token}>
                  المحفوظات
                </option>
                <option value="following" disabled={!token}>
                  أتابعهم
                </option>
              </select>
            </label>
            <button
              className="outline"
              onClick={() => {
                setPublisher("");
                setProfile(null);
                setCountry("");
                setStage("");
                setSubject("");
                setCurriculum("");
                setMode("all");
              }}
            >
              مسح الفلاتر
            </button>
          </section>
          {profile && (
            <h2>
              ملف {profile.username} · {profile.active_posts} منشورات فعالة —
              العدد ليس تقييم جودة
            </h2>
          )}
          <div className="community-grid">
            {posts.map((p) => (
              <article key={p.id}>
                <h2>
                  <a href={`#${p.id}`}>{p.title}</a>
                </h2>
                <button
                  className="community-author"
                  onClick={() => void openProfile(p.publisher.id)}
                >
                  {p.publisher.username}
                </button>
                <p>
                  {catalog?.countries[p.country]} · {catalog?.stages[p.stage]} ·{" "}
                  {catalog?.subjects[p.subject]}
                </p>
                <p>
                  {p.curriculum} · {p.kind === "cards" ? "بطاقات" : "اختبار"}
                </p>
                <small>
                  متاح حتى {new Date(p.expires_at).toLocaleDateString("ar-EG")}
                </small>
              </article>
            ))}
          </div>
          {!posts.length && <p>لا توجد منشورات مطابقة حاليًا.</p>}
          {next !== null && (
            <button
              className="outline"
              disabled={busy}
              onClick={() => void run(() => loadFeed(next))}
            >
              منشورات أقدم
            </button>
          )}
          {!!activity.blocked.length && (
            <section>
              <h2>حسابات حظرتها</h2>
              {activity.blocked.map((u) => (
                <p key={u.id}>
                  {u.username}{" "}
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await mutate(
                          `/v1/community/publishers/${u.id}/block`,
                          "DELETE",
                        );
                        await loadFeed();
                      })
                    }
                  >
                    إلغاء حظر {u.username}
                  </button>
                </p>
              ))}
            </section>
          )}
        </>
      ) : (
        post && (
          <article className="community-detail">
            <a href="#">العودة للمنشورات</a>
            <h2>{post.title}</h2>
            <button
              className="community-author"
              onClick={() => void openProfile(post.publisher.id)}
            >
              {post.publisher.username}
            </button>
            <p>
              {post.curriculum} · {catalog?.countries[post.country]} ·{" "}
              {catalog?.subjects[post.subject]}
            </p>
            <div className="community-actions">
              <button
                className="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await mutate(
                      `/v1/community/posts/${post.id}/save`,
                      activity.saved.includes(post.id) ? "DELETE" : "PUT",
                    );
                  })
                }
              >
                {activity.saved.includes(post.id)
                  ? "إلغاء حفظ المنشور"
                  : "حفظ المنشور"}
              </button>
              {me?.id !== post.publisher.id && (
                <>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await mutate(
                          `/v1/community/publishers/${post.publisher.id}/follow`,
                          activity.following.includes(post.publisher.id)
                            ? "DELETE"
                            : "PUT",
                        );
                      })
                    }
                  >
                    {activity.following.includes(post.publisher.id)
                      ? "إلغاء متابعة الناشر"
                      : "متابعة الناشر"}
                  </button>
                  <button
                    className="outline"
                    onClick={() =>
                      token
                        ? setConfirm({
                            label: "حظر الناشر",
                            path: `/v1/community/publishers/${post.publisher.id}/block`,
                            method: "PUT",
                          })
                        : setLogin(true)
                    }
                  >
                    حظر الناشر
                  </button>
                </>
              )}
              {me?.id === post.publisher.id && (
                <button
                  className="outline"
                  onClick={() =>
                    setConfirm({
                      label: "إلغاء النشر العام وحذف تعليقاته وحفظه من القوائم",
                      path: `/v1/community/posts/${post.id}`,
                      method: "DELETE",
                    })
                  }
                >
                  إلغاء النشر العام
                </button>
              )}
            </div>
            {post.kind === "cards" ? (
              post.items?.map((item, i) => (
                <details className="community-card" key={i}>
                  <summary dir="auto">{item.front}</summary>
                  <p dir="auto">{item.back}</p>
                </details>
              ))
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const score = await api<typeof result>(
                      `/v1/community/posts/${post.id}/grade`,
                      token,
                      json({ answers: post.items!.map((_, i) => answers[i]) }),
                    );
                    if (window.location.hash.slice(1) === post.id)
                      setResult(score);
                  });
                }}
              >
                {post.items?.map((q, i) => (
                  <fieldset key={i}>
                    <legend>{q.prompt}</legend>
                    {q.choices?.map((choice, j) => (
                      <label key={j}>
                        <input
                          type="radio"
                          name={`public-question-${i}`}
                          checked={answers[i] === j}
                          disabled={!!result}
                          onChange={() => setAnswers((a) => ({ ...a, [i]: j }))}
                        />
                        {choice}
                      </label>
                    ))}
                    {result && <p>{result.questions[i].explanation}</p>}
                  </fieldset>
                ))}
                {result ? (
                  <p role="status">
                    نتيجتك {result.correct} من {result.total} · غير محفوظة
                  </p>
                ) : (
                  <button
                    className="primary"
                    disabled={
                      busy || Object.keys(answers).length !== post.items?.length
                    }
                  >
                    تصحيح الاختبار العام
                  </button>
                )}
              </form>
            )}
            <section>
              <h3>التعليقات العامة</h3>
              {comments.map((c) => (
                <article className="community-comment" key={c.id}>
                  <b dir="ltr">{c.username}</b>
                  <p dir="auto">{c.text}</p>
                  {(me?.id === c.user_id || me?.id === post.publisher.id) && (
                    <button
                      className="outline"
                      onClick={() =>
                        setConfirm({
                          label: "حذف التعليق",
                          path: `/v1/community/posts/${post.id}/comments/${c.id}`,
                          method: "DELETE",
                        })
                      }
                    >
                      حذف التعليق
                    </button>
                  )}
                  {me && me.id !== c.user_id && (
                    <button
                      className="outline"
                      onClick={() =>
                        setConfirm({
                          label: `حظر ${c.username}`,
                          path: `/v1/community/publishers/${c.user_id}/block`,
                          method: "PUT",
                        })
                      }
                    >
                      حظر {c.username}
                    </button>
                  )}
                </article>
              ))}
              {token ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!consent) return;
                    void run(async () => {
                      await mutate(
                        `/v1/community/posts/${post.id}/comments`,
                        "POST",
                        { text: text.trim(), consent },
                      );
                      setText("");
                      setConsent(false);
                      await loadPost();
                    });
                  }}
                >
                  <label>
                    تعليق عام
                    <textarea
                      maxLength={1000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={3}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    أوافق على نشر التعليق واسم حسابي للعامة ولا يتضمن معلومات
                    خاصة أو تعديًا على الآخرين.
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !text.trim() || !consent}
                  >
                    نشر التعليق العام
                  </button>
                </form>
              ) : (
                <button className="outline" onClick={() => setLogin(true)}>
                  سجّل الدخول للتعليق
                </button>
              )}
            </section>
            <section>
              <h3>الإبلاغ عن المنشور</h3>
              <label>
                سبب الإبلاغ
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="privacy">معلومات خاصة</option>
                  <option value="copyright">حقوق نشر</option>
                  <option value="harmful">محتوى ضار</option>
                  <option value="incorrect">معلومة غير صحيحة</option>
                  <option value="spam">محتوى مزعج</option>
                </select>
              </label>
              <button
                className="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!token) {
                      setLogin(true);
                      return;
                    }
                    await mutate(
                      `/v1/community/posts/${post.id}/report`,
                      "POST",
                      { reason },
                    );
                    setNote(
                      "استُلم البلاغ للمراجعة البشرية، وليس وعدًا بإزالة فورية.",
                    );
                  })
                }
              >
                إرسال بلاغ عن المنشور
              </button>
            </section>
          </article>
        )
      )}
    </main>
  );
}
