import { SharePublisher } from "./Sharing";
import MindMap, { type StudyGraph } from "./MindMap";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  Layers3,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api, json, type Citation } from "./api";
import "./study-tools.css";

type Deck = { id: string; title: string };
type Card = {
  id: string;
  front: string;
  back: string;
  origin: string;
  version: number;
  reference: Citation | null;
  review: {
    version: number;
    due_at: string | null;
    interval_days: number;
    due: boolean;
  };
};
type Question = { id: string; prompt: string; choices: string[] };
type Quiz = { id: string; title: string; questions: Question[] };
type Result = {
  quiz_id: string;
  correct: number;
  total: number;
  questions: {
    id: string;
    correct: boolean;
    selected_index: number;
    correct_index: number;
    explanation: string;
    reference: Citation | null;
    origin: string;
  }[];
};
type Artifact = {
  id: string;
  kind: string;
  blocks: {
    heading: string;
    text: string;
    year: number | null;
    reference: Citation;
  }[];
  created_at: string;
  graph?: StudyGraph;
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : "تعذّر إكمال العملية.";
const labels: Record<string, string> = {
  shared: "نسخة مشتركة · غير مدققة",
  manual: "يدوية",
  extractive: "حذف كلمة من المصدر",
  edited: "معدّلة يدويًا",
};
const artifactLabels: Record<string, string> = {
  study_guide: "دليل دراسة اقتباسي",
  faq: "أسئلة ومقاطع",
  briefing: "موجز اقتباسي",
  timeline: "تسلسل السنوات المذكورة",
  mindmap: "خريطة المصادر التفاعلية",
};
function Spinner() {
  return <LoaderCircle size={16} className="spin" />;
}
function Reference({
  value,
  open,
}: {
  value: Citation | null;
  open: (c: Citation) => void;
}) {
  return value ? (
    <button
      type="button"
      className="study-reference"
      onClick={() => open(value)}
    >
      <FileText size={13} /> المرجع: {value.title}
    </button>
  ) : (
    <small className="muted">محتوى يدوي دون توثيق آلي</small>
  );
}

const Permissions = createContext({ readOnly: false, publish: true });
export default function StudyTools({
  role = "owner",
  notebookId,
  token,
  sourceIds,
  onCitation,
}: {
  role?: "owner" | "editor" | "viewer";
  notebookId: string;
  token: string;
  sourceIds: string[];
  onCitation: (c: Citation) => void;
}) {
  const readOnly = role === "viewer";
  const [decks, setDecks] = useState<Deck[]>([]),
    [chosen, setChosen] = useState(""),
    [title, setTitle] = useState("بطاقات المراجعة"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"cards" | "artifacts">("cards");
  const base = `/v1/notebooks/${notebookId}`;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const rows = await api<Deck[]>(base + "/decks", token, { signal });
        if (signal?.aborted) return;
        setDecks(rows);
        setChosen((old) =>
          rows.some((d) => d.id === old) ? old : rows[0]?.id || "",
        );
        setError("");
      } catch (e) {
        if (!signal?.aborted) setError(message(e));
      }
    },
    [base, token],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  async function create(generated: boolean) {
    setBusy(true);
    setError("");
    try {
      const deck = await api<Deck>(
        base + (generated ? "/decks/generate" : "/decks"),
        token,
        json(
          generated
            ? { title: title.trim(), source_ids: sourceIds, count: 12 }
            : { title: title.trim() },
        ),
      );
      await load();
      setChosen(deck.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Permissions.Provider value={{ readOnly, publish: role === "owner" }}>
      <section className="study-tools" aria-label="أدوات الدراسة">
        <header className="tools-heading">
          <span className="tools-icon">
            <Layers3 size={23} />
          </span>
          <div>
            <h2>حوّل المعرفة إلى ممارسة.</h2>
            <p>بطاقات واختبارات ومقاطع دراسة محفوظة في دفترك.</p>
          </div>
        </header>
        <div className="tools-tabs">
          <button
            aria-pressed={tab === "cards"}
            onClick={() => setTab("cards")}
          >
            <Layers3 size={16} /> البطاقات والاختبارات
          </button>
          <button
            aria-pressed={tab === "artifacts"}
            onClick={() => setTab("artifacts")}
          >
            <BookOpen size={16} /> مخرجات الدراسة
          </button>
        </div>
        {tab === "artifacts" ? (
          <Artifacts
            key={notebookId}
            base={base}
            token={token}
            sourceIds={sourceIds}
            onCitation={onCitation}
          />
        ) : (
          <>
            <div className="tools-notice">
              التوليد المحلي يصنع بطاقات حذف كلمة من النص حرفيًا، وليس أسئلة
              مؤلّفة بنموذج AI. راجعها وعدّلها قبل الاعتماد عليها. النطاق الحالي:{" "}
              {sourceIds.length} مصادر محددة.
            </div>
            <div className="deck-create">
              <label>
                اسم مجموعة البطاقات
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
              </label>
              <button
                className="primary"
                disabled={
                  readOnly || busy || !title.trim() || !sourceIds.length
                }
                onClick={() => void create(true)}
              >
                {busy ? <Spinner /> : <Layers3 size={16} />} إنشاء بطاقات من
                المصادر
              </button>
              <button
                className="outline"
                disabled={readOnly || busy || !title.trim()}
                onClick={() => void create(false)}
              >
                <Plus size={16} /> مجموعة يدوية
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
                <button className="history-retry" onClick={() => void load()}>
                  تحديث المجموعات
                </button>
              </div>
            )}
            {decks.length ? (
              <>
                <label className="deck-choice">
                  المجموعة الحالية
                  <select
                    value={chosen}
                    onChange={(e) => setChosen(e.target.value)}
                  >
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
                {chosen && (
                  <DeckPanel
                    key={chosen}
                    deckId={chosen}
                    notebookId={notebookId}
                    token={token}
                    onCitation={onCitation}
                  />
                )}
              </>
            ) : (
              <div className="tools-empty">
                <Layers3 size={32} />
                <h3>فهمك يستحق أن يبقى.</h3>
                <p>
                  أنشئ مجموعة يدويًا، أو أضف مصادر وحددها ثم أنشئ بطاقات
                  اقتباسية.
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </Permissions.Provider>
  );
}
function DeckPanel({
  notebookId,
  deckId,
  token,
  onCitation,
}: {
  notebookId: string;
  deckId: string;
  token: string;
  onCitation: (c: Citation) => void;
}) {
  const { readOnly, publish } = useContext(Permissions);
  const [cards, setCards] = useState<Card[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<"practice" | "edit" | "quiz">("practice"),
    [flipped, setFlipped] = useState(false),
    [index, setIndex] = useState(0),
    [dueOnly, setDueOnly] = useState(false),
    [editing, setEditing] = useState<Card | null>(null),
    [front, setFront] = useState(""),
    [back, setBack] = useState(""),
    [deleteId, setDeleteId] = useState(""),
    [note, setNote] = useState("");
  const pendingReview = useRef<{ id: string; payload: object } | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const rows = await api<Card[]>(`/v1/decks/${deckId}/cards`, token, {
          signal,
        });
        if (signal?.aborted) return;
        setCards(rows);
        setLoaded(true);
        setFlipped(false);
        setIndex(0);
      } catch (e) {
        if (!signal?.aborted) setError(message(e));
      }
    },
    [deckId, token],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  useEffect(() => {
    if (readOnly && tab === "edit") setTab("practice");
  }, [readOnly, tab]);
  const eligible = cards.filter((c) => !dueOnly || c.review.due),
    card = eligible[index] || eligible[0];
  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [dueOnly]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        editing ? `/v1/cards/${editing.id}` : `/v1/decks/${deckId}/cards`,
        token,
        {
          ...json({
            front: front.trim(),
            back: back.trim(),
            ...(editing ? { version: editing.version } : {}),
          }),
          method: editing ? "PUT" : "POST",
        },
      );
      setEditing(null);
      setFront("");
      setBack("");
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api(`/v1/cards/${deleteId}`, token, { method: "DELETE" });
      setDeleteId("");
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function rate(rating?: string) {
    if (!card || busy) return;
    const request = pendingReview.current || {
      id: card.id,
      payload: {
        rating,
        card_version: card.version,
        state_version: card.review.version,
        request_id: crypto.randomUUID(),
      },
    };
    pendingReview.current = request;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ due_at: string }>(
        `/v1/cards/${request.id}/reviews`,
        token,
        json(request.payload),
      );
      pendingReview.current = null;
      setNote(
        "تم الحفظ. المراجعة التالية: " +
          new Date(result.due_at).toLocaleString("ar-EG"),
      );
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="deck-panel">
      {publish && (
        <SharePublisher
          key={deckId}
          target={`/v1/decks/${deckId}`}
          notebookId={notebookId}
          token={token}
          kind="cards"
        />
      )}
      <div className="practice-tabs">
        <button
          aria-pressed={tab === "practice"}
          onClick={() => setTab("practice")}
        >
          مراجعة البطاقات <b>{cards.length}</b>
        </button>
        <button
          disabled={readOnly}
          aria-pressed={tab === "edit"}
          onClick={() => setTab("edit")}
        >
          إنشاء وتحرير
        </button>
        <button aria-pressed={tab === "quiz"} onClick={() => setTab("quiz")}>
          اختبار تفاعلي
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          {pendingReview.current && (
            <button
              className="history-retry"
              disabled={busy}
              onClick={() => void rate()}
            >
              إعادة حفظ التقييم نفسه
            </button>
          )}
          <button
            className="history-retry"
            disabled={busy}
            onClick={() => {
              pendingReview.current = null;
              setError("");
              void load();
            }}
          >
            تحديث البطاقات من الخادم
          </button>
        </div>
      )}
      {tab === "quiz" ? (
        <QuizPanel
          key={deckId}
          deckId={deckId}
          notebookId={notebookId}
          token={token}
          onCitation={onCitation}
        />
      ) : tab === "edit" ? (
        <div className="card-editor">
          <form onSubmit={save}>
            <h3>{editing ? "تحرير البطاقة" : "أضف بطاقتك"}</h3>
            <label>
              السؤال أو وجه البطاقة
              <textarea
                value={front}
                onChange={(e) => setFront(e.target.value)}
                required
                maxLength={2000}
                rows={3}
              />
            </label>
            <label>
              الإجابة أو ظهر البطاقة
              <textarea
                value={back}
                onChange={(e) => setBack(e.target.value)}
                required
                maxLength={2000}
                rows={3}
              />
            </label>
            <p className="field-hint">
              التعديل يوسم البطاقة بأنها معدّلة يدويًا ويعيد جدولة تعلّمها من
              البداية. المرجع يبقى للاستئناس وليس ختم صحة.
            </p>
            <div className="tools-row">
              <button
                className="primary"
                disabled={busy || !front.trim() || !back.trim()}
              >
                {busy ? <Spinner /> : <Check size={16} />} حفظ البطاقة
              </button>
              {editing && (
                <button
                  type="button"
                  className="outline"
                  onClick={() => {
                    setEditing(null);
                    setFront("");
                    setBack("");
                  }}
                >
                  إلغاء التحرير
                </button>
              )}
            </div>
          </form>
          <div className="editable-list">
            {cards.map((c) => (
              <article key={c.id}>
                <p>{c.front}</p>
                <small>{labels[c.origin]}</small>
                <div>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() => {
                      setEditing(c);
                      setFront(c.front);
                      setBack(c.back);
                    }}
                  >
                    تحرير
                  </button>
                  <button
                    className="icon-button"
                    aria-label={"حذف البطاقة " + c.front}
                    disabled={busy}
                    onClick={() => setDeleteId(c.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {deleteId && (
            <div className="delete-card-confirm">
              <p>
                إخفاء البطاقة من المراجعة؟ تبقى نتائج الاختبارات السابقة محفوظة.
              </p>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                تأكيد حذف البطاقة
              </button>
              <button className="outline" onClick={() => setDeleteId("")}>
                إلغاء
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="review-toolbar">
            <label>
              <input
                type="checkbox"
                checked={dueOnly}
                onChange={(e) => setDueOnly(e.target.checked)}
              />{" "}
              المستحقة الآن فقط ({cards.filter((c) => c.review.due).length})
            </label>
            <small>جدولة SM-2، وليست توقعًا بالذكاء الاصطناعي.</small>
          </div>
          {!loaded ? (
            <div className="loading-line">
              <Spinner /> نفتح بطاقاتك…
            </div>
          ) : !card ? (
            <div className="tools-empty">
              <Check size={32} />
              <h3>
                {cards.length
                  ? "أنجزت المستحق الآن."
                  : "المجموعة تنتظر أول بطاقة."}
              </h3>
              <p>
                {cards.length
                  ? "يمكنك إلغاء الفلتر للتدرب على الجميع."
                  : "انتقل إلى إنشاء وتحرير لإضافة بطاقات."}
              </p>
            </div>
          ) : (
            <>
              <div className="card-position">
                <span>
                  بطاقة {Math.min(index + 1, eligible.length)} من{" "}
                  {eligible.length}
                </span>
                <span>{labels[card.origin]}</span>
              </div>
              <button
                className={`flashcard ${flipped ? "is-flipped" : ""}`}
                onClick={() => setFlipped(!flipped)}
                aria-label={flipped ? "إخفاء الإجابة" : "إظهار الإجابة"}
              >
                <small>
                  {flipped ? "الإجابة" : "تذكّر قبل أن تقلب البطاقة"}
                </small>
                <p dir="auto">{flipped ? card.back : card.front}</p>
                <span>
                  <RotateCcw size={15} /> اضغط لقلب البطاقة
                </span>
              </button>
              <Reference value={card.reference} open={onCitation} />
              <div className="rating-buttons">
                {[
                  ["again", "لم أتذكر"],
                  ["hard", "صعب"],
                  ["good", "جيد"],
                  ["easy", "سهل"],
                ].map(([rating, label]) => (
                  <button
                    key={rating}
                    disabled={!flipped || busy || !!pendingReview.current}
                    onClick={() => void rate(rating)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="card-navigation">
                <button
                  className="outline"
                  disabled={index <= 0}
                  onClick={() => {
                    setIndex((i) => Math.max(0, i - 1));
                    setFlipped(false);
                  }}
                >
                  <ArrowRight size={15} /> السابقة
                </button>
                <span>
                  {card.review.due
                    ? "جاهزة للمراجعة"
                    : "الموعد القادم: " +
                      new Date(card.review.due_at!).toLocaleDateString("ar-EG")}
                </span>
                <button
                  className="outline"
                  disabled={index >= eligible.length - 1}
                  onClick={() => {
                    setIndex((i) => i + 1);
                    setFlipped(false);
                  }}
                >
                  التالية <ArrowLeft size={15} />
                </button>
              </div>
            </>
          )}
          {note && (
            <p className="review-saved" role="status">
              {note}
            </p>
          )}
        </>
      )}
    </div>
  );
}
function QuizPanel({
  notebookId,
  deckId,
  token,
  onCitation,
}: {
  notebookId: string;
  deckId: string;
  token: string;
  onCitation: (c: Citation) => void;
}) {
  const { readOnly, publish } = useContext(Permissions);
  const [list, setList] = useState<
      { id: string; title: string; count: number }[]
    >([]),
    [quiz, setQuiz] = useState<Quiz | null>(null),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [result, setResult] = useState<Result | null>(null),
    [attempts, setAttempts] = useState<Result[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{
    request_id: string;
    answers: Record<string, number>;
  } | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const rows = await api<typeof list>(
          `/v1/decks/${deckId}/quizzes`,
          token,
          { signal },
        );
        if (!signal?.aborted) setList(rows);
      } catch (e) {
        if (!signal?.aborted) setError(message(e));
      }
    },
    [deckId, token],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      const [q, a] = await Promise.all([
        api<Quiz>(`/v1/quizzes/${id}`, token),
        api<Result[]>(`/v1/quizzes/${id}/attempts`, token),
      ]);
      setQuiz(q);
      setAttempts(a);
      setAnswers({});
      setResult(null);
      pending.current = null;
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      const q = await api<Quiz>(
        `/v1/decks/${deckId}/quizzes`,
        token,
        json({ count: 8 }),
      );
      setQuiz(q);
      setAnswers({});
      setResult(null);
      setAttempts([]);
      pending.current = null;
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!quiz || busy || result) return;
    setBusy(true);
    setError("");
    const body = pending.current || {
      request_id: crypto.randomUUID(),
      answers: { ...answers },
    };
    pending.current = body;
    try {
      const graded = await api<Result>(
        `/v1/quizzes/${quiz.id}/attempts`,
        token,
        json(body),
      );
      setResult(graded);
      pending.current = null;
      setAttempts(
        await api<Result[]>(`/v1/quizzes/${quiz.id}/attempts`, token),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="quiz-panel">
      <div className="tools-notice">
        اختبار تدريبي من بطاقات هذه المجموعة. تُصحّح الإجابات وتُحفظ النتيجة على
        الخادم. ليس اختبارًا رسميًا أو نظام مراقبة امتحانات.
      </div>
      <div className="tools-row">
        <button
          className="primary"
          disabled={readOnly || busy}
          onClick={() => void create()}
        >
          {busy ? <Spinner /> : <Plus size={16} />} إنشاء اختبار من البطاقات
        </button>
        {list.length > 0 && (
          <label>
            اختبار محفوظ
            <select
              aria-label="اختبار محفوظ"
              value={quiz?.id || ""}
              disabled={busy}
              onChange={(e) => void open(e.target.value)}
            >
              <option value="" disabled>
                اختر اختبارًا
              </option>
              {list.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title} · {q.count} أسئلة
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {quiz && (
        <>
          {publish && (
            <SharePublisher
              key={quiz.id}
              target={`/v1/quizzes/${quiz.id}`}
              notebookId={notebookId}
              token={token}
              kind="quiz"
            />
          )}
          <div className="quiz-attempts">
            {attempts.length > 0 && (
              <button
                className="outline"
                disabled={busy}
                onClick={() => setResult(attempts[0])}
              >
                عرض آخر نتيجة محفوظة
              </button>
            )}
            {result && (
              <button
                className="outline"
                onClick={() => {
                  setResult(null);
                  setAnswers({});
                  pending.current = null;
                }}
              >
                بدء محاولة جديدة
              </button>
            )}
          </div>
          {result && (
            <div className="quiz-score" role="status">
              <Check size={24} />
              <strong>
                نتيجتك: {result.correct} من {result.total}
              </strong>
              <p>النتيجة محفوظة في حسابك.</p>
            </div>
          )}
          <form onSubmit={submit}>
            {quiz.questions.map((q, index) => {
              const grade = result?.questions.find((g) => g.id === q.id);
              return (
                <fieldset className="quiz-question" key={q.id}>
                  <legend>
                    {index + 1}. {q.prompt}
                  </legend>
                  {q.choices.map((choice, i) => (
                    <label
                      key={i}
                      className={
                        grade?.correct_index === i ? "correct-choice" : ""
                      }
                    >
                      <input
                        type="radio"
                        disabled={busy || !!result || !!pending.current}
                        name={q.id}
                        checked={
                          result
                            ? grade?.selected_index === i
                            : answers[q.id] === i
                        }
                        onChange={() =>
                          setAnswers((old) => ({ ...old, [q.id]: i }))
                        }
                      />
                      <span dir="auto">{choice}</span>
                    </label>
                  ))}
                  {grade && (
                    <div className="quiz-explanation">
                      <strong>
                        {grade.correct ? "إجابة صحيحة" : "راجع هذه المعلومة"}
                      </strong>
                      <p>الإجابة: {grade.explanation}</p>
                      <Reference value={grade.reference} open={onCitation} />
                    </div>
                  )}
                </fieldset>
              );
            })}
            {!result && (
              <button
                className="primary"
                disabled={
                  busy || Object.keys(answers).length !== quiz.questions.length
                }
              >
                {busy ? <Spinner /> : <Check size={16} />}{" "}
                {pending.current
                  ? "إعادة حفظ المحاولة نفسها"
                  : "تصحيح وحفظ النتيجة"}
              </button>
            )}
          </form>
        </>
      )}
    </section>
  );
}
function Artifacts({
  base,
  token,
  sourceIds,
  onCitation,
}: {
  base: string;
  token: string;
  sourceIds: string[];
  onCitation: (c: Citation) => void;
}) {
  const { readOnly, publish } = useContext(Permissions);
  const [items, setItems] = useState<Artifact[]>([]),
    [kind, setKind] = useState("study_guide"),
    [chosen, setChosen] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const rows = await api<Artifact[]>(base + "/study-artifacts", token, {
          signal,
        });
        if (signal?.aborted) return;
        setItems(rows);
        setChosen((old) =>
          rows.some((a) => a.id === old) ? old : rows[0]?.id || "",
        );
      } catch (e) {
        if (!signal?.aborted) setError(message(e));
      }
    },
    [base, token],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const item = await api<Artifact>(
        base + "/study-artifacts",
        token,
        json({ kind, source_ids: sourceIds }),
      );
      await load();
      setChosen(item.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const current = items.find((a) => a.id === chosen);
  return (
    <section className="artifacts-panel">
      <div className="tools-notice">
        مخرجات اقتباسية محلية: تنظم مقاطع حرفية ولا تؤلف شرحًا أو تحققًا دلاليًا
        بالذكاء الاصطناعي. الأسئلة عامة للمقاطع، والتسلسل الزمني يرتب السنوات
        المكتوبة دون استنتاج أحداث أو تحويل تقاويم.
      </div>
      <div className="tools-row">
        <label>
          نوع المخرج
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(artifactLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={readOnly || busy || !sourceIds.length}
          onClick={() => void create()}
        >
          {busy ? <Spinner /> : <Plus size={16} />} إنشاء وحفظ من المصادر
          المحددة
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <label className="deck-choice">
          مخرج محفوظ
          <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
            {items.map((a) => (
              <option key={a.id} value={a.id}>
                {artifactLabels[a.kind]} ·{" "}
                {new Date(a.created_at).toLocaleString("ar-EG")}
              </option>
            ))}
          </select>
        </label>
      )}
      {current ? (
        <div className="artifact-blocks">
          <h3>{artifactLabels[current.kind]}</h3>
          {current.kind === "mindmap" && current.graph ? (
            <MindMap
              key={current.id}
              graph={current.graph}
              onCitation={onCitation}
            />
          ) : (
            current.blocks.map((block, i) => (
              <article key={i}>
                <h4>{block.heading}</h4>
                <blockquote dir="auto">{block.text}</blockquote>
                <Reference value={block.reference} open={onCitation} />
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="tools-empty">
          <BookOpen size={32} />
          <p>اختر نوع المخرج وحدد مصادرك لبدء التنظيم.</p>
        </div>
      )}
    </section>
  );
}
