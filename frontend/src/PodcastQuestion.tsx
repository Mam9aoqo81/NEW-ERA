import { useEffect, useRef, useState } from "react";
import { api, json, type Answer, type Citation } from "./api";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export default function PodcastQuestion({
  notebookId,
  token,
  sourceIds,
  onCitation,
}: {
  notebookId: string;
  token: string;
  sourceIds: string[];
  onCitation: (c: Citation) => void;
}) {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("ar-EG");
  const [consent, setConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const request = useRef<AbortController | null>(null);
  const retry = useRef<{ signature: string; id: string } | null>(null);
  const Constructor =
    (window as SpeechWindow).SpeechRecognition ||
    (window as SpeechWindow).webkitSpeechRecognition;
  const canListen = !!Constructor && window.isSecureContext;
  function interrupt() {
    window.dispatchEvent(
      new CustomEvent("knowlm-audio-start", { detail: "question" }),
    );
  }
  function cancelMic() {
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
      current.abort();
    }
    setListening(false);
  }
  useEffect(
    () => () => {
      const current = recognition.current;
      if (current) {
        current.onresult = null;
        current.onerror = null;
        current.onend = null;
        current.abort();
      }
      request.current?.abort();
    },
    [],
  );
  function start() {
    if (!canListen || !consent || listening || !Constructor) return;
    interrupt();
    setError("");
    setAnswer(null);
    const instance = new Constructor();
    recognition.current = instance;
    instance.lang = language;
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      if (recognition.current !== instance) return;
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .slice(0, 2000);
      setText(transcript);
    };
    instance.onerror = () => {
      if (recognition.current === instance) {
        setError("تعذر التقاط السؤال. تحقق من إذن الميكروفون أو اكتب السؤال.");
        cancelMic();
      }
    };
    instance.onend = () => {
      if (recognition.current === instance) {
        recognition.current = null;
        setListening(false);
      }
    };
    try {
      instance.start();
      setListening(true);
    } catch {
      cancelMic();
      setError("تعذر بدء الميكروفون. اكتب سؤالك بدلًا من ذلك.");
    }
  }
  async function ask() {
    if (!text.trim() || !sourceIds.length || busy) return;
    cancelMic();
    interrupt();
    setBusy(true);
    setError("");
    setAnswer(null);
    const controller = new AbortController();
    request.current = controller;
    const signature = JSON.stringify([text.trim(), sourceIds]);
    if (retry.current?.signature !== signature)
      retry.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await api<Answer>(
        `/v1/notebooks/${notebookId}/ask`,
        token,
        {
          ...json({
            question: text.trim(),
            source_ids: sourceIds,
            mode: "extractive",
            request_id: retry.current.id,
          }),
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted) {
        setAnswer(result);
        retry.current = null;
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "تعذر البحث في المصادر");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section aria-label="اسأل أثناء الاستماع" className="podcast-question">
      <h4>قاطع الاستماع بسؤال من مصادرك</h4>
      <p>
        يتوقف الصوت عند بدء السؤال. راجع النص ثم أرسله صراحةً؛ البحث محلي في
        المصادر المحددة، والسؤال وإجابته محفوظان في سجل محادثتك الخاص. ليس حوار
        Realtime؛ ارجع للمشغّل واضغط تشغيل للاستئناف (قراءة المتصفح تبدأ الدور
        مجددًا).
      </p>
      {!canListen ? (
        <p>الإملاء الصوتي غير متاح هنا؛ اكتب السؤال أدناه.</p>
      ) : (
        <>
          <label>
            لغة الإملاء
            <select
              value={language}
              disabled={listening}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="ar-EG">العربية</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                if (!e.target.checked) cancelMic();
              }}
            />
            أوافق على استخدام الميكروفون وخدمة تعرف الكلام في المتصفح، وقد تعالج
            الصوت خارجيًا
          </label>
          <button
            type="button"
            disabled={!consent || busy || listening}
            onClick={start}
          >
            ابدأ السؤال بالميكروفون
          </button>
          {listening && (
            <button type="button" onClick={() => recognition.current?.stop()}>
              إنهاء الإملاء
            </button>
          )}
        </>
      )}
      <label>
        سؤال أثناء الاستماع
        <textarea
          maxLength={2000}
          value={text}
          disabled={busy}
          onFocus={interrupt}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || listening || !text.trim() || !sourceIds.length}
        onClick={() => void ask()}
      >
        {busy ? "جارٍ البحث…" : "ابحث في المصادر المحددة"}
      </button>
      {listening && <p role="status">الميكروفون يستمع…</p>}
      {error && <p role="alert">{error}</p>}
      {answer && (
        <article aria-label="إجابة سؤال الاستماع">
          <p dir="auto">{answer.answer}</p>
          <small>{answer.notice}</small>
          {answer.citations.map((c, i) => (
            <button
              type="button"
              key={i}
              onClick={() => {
                interrupt();
                onCitation(c);
              }}
            >
              مرجع إجابة الاستماع {i + 1} · {c.title}
            </button>
          ))}
        </article>
      )}
    </section>
  );
}
