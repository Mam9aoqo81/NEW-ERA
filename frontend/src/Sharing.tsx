import { useEffect, useState, type FormEvent } from "react";
import { api, json } from "./api";
import "./sharing.css";

type Item = {
  front?: string;
  back?: string;
  prompt?: string;
  choices?: string[];
  correct_index?: number;
  explanation?: string;
};
type Snapshot = { kind: "cards" | "quiz"; items: Item[] };
type Preview = { snapshot: Snapshot; preview_hash: string };
type ShareRow = {
  id: string;
  title: string;
  kind: string;
  expires_at: string;
  active: boolean;
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : "تعذّر إكمال العملية.";

export function SharePublisher({
  target,
  notebookId,
  token,
  kind,
}: {
  target: string;
  notebookId: string;
  token: string;
  kind: "cards" | "quiz";
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [title, setTitle] = useState("مراجعة مشتركة"),
    [days, setDays] = useState(7),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [link, setLink] = useState(""),
    [rows, setRows] = useState<ShareRow[]>([]),
    [revoke, setRevoke] = useState("");
  async function list() {
    setRows(await api<ShareRow[]>(`/v1/notebooks/${notebookId}/shares`, token));
  }
  async function inspect() {
    setBusy(true);
    setError("");
    setPreview(null);
    setLink("");
    setConsent(false);
    try {
      setPreview(await api<Preview>(target + "/share-preview", token));
      await list();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (open) void inspect();
  }, [open, target]);
  async function publish(e: FormEvent) {
    e.preventDefault();
    if (!preview || !consent || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token: string }>(
        target + "/shares",
        token,
        json({
          title: title.trim(),
          expires_days: days,
          consent,
          preview_hash: preview.preview_hash,
        }),
      );
      setLink(`${window.location.origin}/share#${result.token}`);
      setConsent(false);
      await list();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sharing-owner">
      <button
        className="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {kind === "cards" ? "مشاركة البطاقات" : "مشاركة الاختبار"}
      </button>
      {open && (
        <div className="sharing-box">
          <h3>معاينة النسخة التي سيقرأها الآخرون</h3>
          <p className="external-warning">
            أي شخص يحمل الرابط يستطيع قراءة النص ونسخه دون حساب. تُحذف المراجع
            وروابط المصادر وأسماء ملفاتها آليًا، لكن السؤال أو الإجابة قد يكشفان
            معلومات خاصة بنفسيهما. راجع كل النص، ولا تنشر ما لا تملك حق مشاركته.
            هذه ليست مشاركة للدفتر أو ختم تحقق. يستطيع المستلم حفظ نسخة مستقلة
            من البطاقات؛ إلغاء الرابط لا يسحب النسخ المحفوظة.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="outline"
            disabled={busy}
            onClick={() => void inspect()}
          >
            تحديث معاينة المشاركة
          </button>
          {preview && (
            <>
              <div className="share-preview" aria-label="النص الذي سيُنشر">
                {preview.snapshot.items.map((item, i) => (
                  <article key={i}>
                    <strong>{item.front || item.prompt}</strong>
                    {item.back ? (
                      <p>{item.back}</p>
                    ) : (
                      <>
                        <ol>
                          {item.choices?.map((choice, j) => (
                            <li key={j}>{choice}</li>
                          ))}
                        </ol>
                        <p>الإجابة والتفسير بعد التصحيح: {item.explanation}</p>
                      </>
                    )}
                  </article>
                ))}
              </div>
              <form onSubmit={publish}>
                <label>
                  عنوان النسخة المشتركة
                  <input
                    value={title}
                    maxLength={200}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </label>
                <label>
                  صلاحية الرابط
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    <option value={1}>يوم واحد</option>
                    <option value={7}>7 أيام</option>
                    <option value={30}>30 يومًا</option>
                  </select>
                </label>
                <label className="share-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  راجعت النص كاملًا وأملك حق نشره، وأوافق على إتاحته لكل من يحمل
                  الرابط.
                </label>
                <button
                  className="primary"
                  disabled={busy || !consent || !title.trim()}
                >
                  إنشاء رابط للنسخة المعاينة
                </button>
              </form>
            </>
          )}
          {link && (
            <div role="status">
              <label>
                رابط المشاركة الجديد
                <input
                  readOnly
                  value={link}
                  dir="ltr"
                  onClick={(e) => e.currentTarget.select()}
                />
              </label>
              <p className="field-hint">
                انسخه الآن. لن نعيد إظهار رمز الرابط بعد تحديث الصفحة. تعديل
                بطاقاتك لاحقًا لا يغيّر النسخة المنشورة.
              </p>
              <a href={link} target="_blank" rel="noopener noreferrer">
                فتح النسخة المشتركة
              </a>
            </div>
          )}
          {rows.length > 0 && (
            <div className="share-list">
              <h4>روابط هذا الدفتر (آخر 100)</h4>
              {rows.map((row) => (
                <article key={row.id}>
                  <span>
                    {row.title} ·{" "}
                    {row.active
                      ? "نشط حتى " +
                        new Date(row.expires_at).toLocaleDateString("ar-EG")
                      : "غير نشط"}
                  </span>
                  {row.active && (
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={() => setRevoke(row.id)}
                      aria-label={"إلغاء رابط: " + row.title}
                    >
                      إلغاء الرابط
                    </button>
                  )}
                </article>
              ))}
              {revoke && (
                <div>
                  <p>
                    إلغاء الرابط وحذف نص نسخته المحفوظة؟ لا يمكن محو نسخ سبق
                    تنزيلها.
                  </p>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await api(`/v1/shares/${revoke}`, token, {
                          method: "DELETE",
                        });
                        setRevoke("");
                        await list();
                      } catch (e) {
                        setError(message(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    تأكيد إلغاء الرابط
                  </button>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() => setRevoke("")}
                  >
                    رجوع
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type SharedView = Snapshot & { title: string; expires_at: string };
type Grade = {
  correct: number;
  total: number;
  questions: { correct: boolean; correct_index: number; explanation: string }[];
};
function SharedActions({ token, kind }: { token: string; kind: string }) {
  const [session] = useState(() => sessionStorage.getItem("knowlm-token"));
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [imported, setImported] = useState(false),
    [reported, setReported] = useState(false),
    [reason, setReason] = useState("privacy"),
    [requestId] = useState(() => crypto.randomUUID());
  async function act(action: "import" | "report") {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/shared/${action}`, session, {
        ...json(
          action === "import" ? { consent, request_id: requestId } : { reason },
        ),
        headers: { "X-KnowLM-Share": token },
      });
      if (action === "import") setImported(true);
      else setReported(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sharing-box" aria-label="حفظ وإبلاغ">
      <h2>الحفظ والإبلاغ</h2>
      {!session ? (
        <p>
          لحفظ نسخة أو إرسال بلاغ، افتح مساحة الدراسة وسجّل الدخول، ثم افتح هذا
          الرابط مجددًا في نفس علامة التبويب.
        </p>
      ) : (
        <>
          {kind === "cards" &&
            (imported ? (
              <p role="status">
                حُفظت نسخة مستقلة في دفتر جديد بمكتبتك. يمكنك تعديلها ومراجعتها
                من مساحة الدراسة.
              </p>
            ) : (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    disabled={busy}
                  />
                  أفهم أنها نسخة غير مدققة بلا مراجع خاصة، وأملك حق حفظها. ستبقى
                  بمكتبتي حتى لو أُلغي الرابط الأصلي، ولن تتزامن تعديلاتها.
                </label>
                <button
                  className="primary"
                  disabled={busy || !consent}
                  onClick={() => void act("import")}
                >
                  حفظ البطاقات في مكتبتي
                </button>
              </>
            ))}
          {reported ? (
            <p role="status">
              استُلم البلاغ للمراجعة البشرية. لا يعني ذلك تعطيل الرابط أو ثبوت
              المخالفة.
            </p>
          ) : (
            <>
              <label>
                سبب الإبلاغ
                <select
                  aria-label="سبب الإبلاغ"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
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
                onClick={() => void act("report")}
              >
                إرسال بلاغ للمراجعة
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="field-hint">
        البلاغ يرسل السبب المحدد فقط؛ لا تكتب معلومات حساسة. قد تُحذف سجلاته عند
        حذف الحساب أو المحتوى. لا توجد مراجعة فورية مضمونة.
      </p>
    </section>
  );
}

export default function SharedLearning() {
  const [token, setToken] = useState(() => window.location.hash.slice(1)),
    [data, setData] = useState<SharedView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [index, setIndex] = useState(0),
    [flipped, setFlipped] = useState(false),
    [answers, setAnswers] = useState<Record<number, number>>({}),
    [grade, setGrade] = useState<Grade | null>(null),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const change = () => setToken(window.location.hash.slice(1));
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
    const controller = new AbortController();
    setData(null);
    setGrade(null);
    setAnswers({});
    setIndex(0);
    setFlipped(false);
    setError("");
    setBusy(true);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setError("الرابط غير متاح أو غير صالح.");
      setBusy(false);
      return () => controller.abort();
    }
    api<SharedView>("/v1/shared/view", null, {
      headers: { "X-KnowLM-Share": token },
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [token, refresh]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      setGrade(
        await api<Grade>("/v1/shared/grade", null, {
          ...json({ answers: data.items.map((_, i) => answers[i]) }),
          headers: { "X-KnowLM-Share": token },
        }),
      );
    } catch (e) {
      setError(message(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }
  const card = data?.items[index];
  return (
    <main className="shared-page" dir="rtl">
      <header>
        <a href="/">KnowLM · مساحة الدراسة</a>
        <span>نسخة برابط غير مُدرج</span>
      </header>
      <p className="external-warning">
        هذا محتوى نشره صاحبه للمراجعة. ليس مدققًا علميًا، ومراجع المصادر الخاصة
        محذوفة. لا يفتح الرابط الدفتر الأصلي. نتائج الزائر غير محفوظة.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">جارٍ التحميل…</p>}
      <button
        className="outline"
        disabled={busy}
        onClick={() => setRefresh((v) => v + 1)}
      >
        إعادة التحقق من الرابط
      </button>
      {data && (
        <>
          <h1>{data.title}</h1>
          <SharedActions key={token} token={token} kind={data.kind} />
          <p className="field-hint">
            الصلاحية حتى {new Date(data.expires_at).toLocaleString("ar-EG")}
          </p>
          {data.kind === "cards" && card ? (
            <section aria-label="البطاقات المشتركة">
              <p>
                بطاقة {index + 1} من {data.items.length}
              </p>
              <button
                className="flashcard"
                onClick={() => setFlipped((v) => !v)}
                aria-label={flipped ? "إخفاء الإجابة" : "إظهار الإجابة"}
              >
                <small>{flipped ? "الإجابة" : "السؤال"}</small>
                <p dir="auto">{flipped ? card.back : card.front}</p>
              </button>
              <div className="tools-row">
                <button
                  className="outline"
                  disabled={index === 0}
                  onClick={() => {
                    setIndex((i) => i - 1);
                    setFlipped(false);
                  }}
                >
                  السابقة
                </button>
                <button
                  className="outline"
                  disabled={index >= data.items.length - 1}
                  onClick={() => {
                    setIndex((i) => i + 1);
                    setFlipped(false);
                  }}
                >
                  التالية
                </button>
              </div>
            </section>
          ) : (
            <form onSubmit={submit}>
              {grade && (
                <div className="quiz-score" role="status">
                  نتيجتك: {grade.correct} من {grade.total} · غير محفوظة
                </div>
              )}
              {data.items.map((q, i) => (
                <fieldset className="quiz-question" key={i}>
                  <legend>
                    {i + 1}. {q.prompt}
                  </legend>
                  {q.choices?.map((choice, j) => (
                    <label key={j}>
                      <input
                        type="radio"
                        name={"shared-" + i}
                        disabled={busy || !!grade}
                        checked={answers[i] === j}
                        onChange={() => setAnswers((a) => ({ ...a, [i]: j }))}
                      />
                      {choice}
                    </label>
                  ))}
                  {grade && (
                    <p>
                      {grade.questions[i].correct ? "صحيح" : "راجع الإجابة"}:{" "}
                      {grade.questions[i].explanation}
                    </p>
                  )}
                </fieldset>
              ))}
              {!grade && (
                <button
                  className="primary"
                  disabled={
                    busy || Object.keys(answers).length !== data.items.length
                  }
                >
                  تصحيح الاختبار المشترك
                </button>
              )}
            </form>
          )}
        </>
      )}
    </main>
  );
}
