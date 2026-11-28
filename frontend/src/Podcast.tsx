import { useEffect, useRef, useState } from "react";
import type { Citation } from "./api";

export type PodcastTurn = {
  heading: string;
  text: string;
  reference: Citation;
  speaker?: "host" | "reader";
  language?: "ar" | "en";
  origin?: string;
};

export default function Podcast({
  turns,
  onCitation,
}: {
  turns: PodcastTurn[];
  onCitation: (c: Citation) => void;
}) {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined";
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [host, setHost] = useState("");
  const [reader, setReader] = useState("");
  const [consent, setConsent] = useState(false);
  const [rate, setRate] = useState(1);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const language = turns[0]?.language || "ar";
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    function load() {
      setVoices(
        synth
          .getVoices()
          .filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === language),
      );
    }
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      generation.current++;
      current.current = null;
      synth.cancel();
      synth.removeEventListener("voiceschanged", load);
    };
  }, [supported, language]);
  function stop() {
    generation.current++;
    if (supported) window.speechSynthesis.cancel();
    current.current = null;
    setPlaying(false);
    setPaused(false);
  }
  useEffect(() => {
    function otherAudio(event: Event) {
      if ((event as CustomEvent).detail !== "browser") stop();
    }
    window.addEventListener("knowlm-audio-start", otherAudio);
    return () => window.removeEventListener("knowlm-audio-start", otherAudio);
  }, [supported]);
  function speak(at: number, id: number) {
    if (id !== generation.current) return;
    if (at >= turns.length) {
      setPlaying(false);
      current.current = null;
      return;
    }
    setIndex(at);
    const turn = turns[at];
    const utterance = new SpeechSynthesisUtterance(turn.text);
    const selected = turn.speaker === "host" ? host : reader;
    utterance.voice =
      voices.find((v) => v.voiceURI === selected) ||
      voices[turn.speaker === "host" ? 0 : Math.min(1, voices.length - 1)];
    utterance.lang = utterance.voice?.lang || language;
    utterance.rate = rate;
    utterance.onend = () => {
      if (id === generation.current) speak(at + 1, id);
    };
    utterance.onerror = () => {
      if (id === generation.current) {
        generation.current++;
        current.current = null;
        window.speechSynthesis.cancel();
        setPlaying(false);
        setPaused(false);
        setError("تعذر تشغيل الصوت. النص والمراجع متاحان؛ جرّب صوتًا آخر.");
      }
    };
    current.current = utterance;
    window.speechSynthesis.speak(utterance);
  }
  function play(at = index) {
    window.dispatchEvent(
      new CustomEvent("knowlm-audio-start", { detail: "browser" }),
    );
    stop();
    setError("");
    setPlaying(true);
    speak(at, generation.current);
  }
  function download() {
    const text = turns
      .map(
        (t, i) =>
          `${i + 1}. ${t.heading}: ${t.text}\n[${t.reference.title}] ${t.reference.locator_type === "timestamp" ? `${t.reference.start_seconds}s` : t.reference.paragraph || t.reference.page}\n`,
      )
      .join("\n");
    const link = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    link.href = url;
    link.download = "knowlm-review-dialogue.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section aria-label="مشغل حوار المراجعة" className="podcast-player">
      <p>
        حوار اقتباسي: سؤال ثابت من المحاور، ثم قراءة حرفية من المصدر. ليس شرحًا
        مولدًا أو تحققًا علميًا. النص محفوظ؛ قراءة المتصفح لا تُحفظ كملف؛ تنزيل WAV
        خيار خادمي منفصل إن فُعّل.
      </p>
      <p>
        أصوات الجهاز تعتمد على المتصفح وقد تستخدم خدمة خارجية. لا نضمن لهجات أو
        صوتين مختلفين، ولا توقيتًا صوتيًا دقيقًا. اختيار الإنجليزية يغير سؤال
        المحاور فقط ولا يترجم المصدر.
      </p>
      {!supported && (
        <p role="status">
          المتصفح لا يدعم القراءة الصوتية؛ يمكنك قراءة النص وتنزيله.
        </p>
      )}
      {supported && (
        <>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                if (!e.target.checked) stop();
              }}
            />
            أوافق على قراءة النص بصوت المتصفح، وقد يعالج مزود الصوت النص خارج
            الجهاز
          </label>
          <fieldset disabled={playing}>
            <legend>أصوات الحوار المتاحة</legend>
            <label>
              صوت المحاور
              <select value={host} onChange={(e) => setHost(e.target.value)}>
                <option value="">تلقائي</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} · {v.lang} ·{" "}
                    {v.localService ? "على الجهاز" : "خدمة صوت"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              صوت القارئ
              <select
                value={reader}
                onChange={(e) => setReader(e.target.value)}
              >
                <option value="">تلقائي</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} · {v.lang} ·{" "}
                    {v.localService ? "على الجهاز" : "خدمة صوت"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              سرعة القراءة
              <select
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              >
                {[0.75, 1, 1.25, 1.5].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          {!voices.length && (
            <p>
              لا توجد أصوات متاحة للغة الحوار على هذا المتصفح. النص يظل متاحًا.
            </p>
          )}
          <div className="tools-row">
            <button
              type="button"
              disabled={!consent || !voices.length || playing || !turns.length}
              onClick={() => play()}
            >
              تشغيل الحوار
            </button>
            <button
              type="button"
              disabled={!playing}
              onClick={() => {
                if (paused) window.speechSynthesis.resume();
                else window.speechSynthesis.pause();
                setPaused(!paused);
              }}
            >
              {paused ? "استئناف الصوت" : "إيقاف مؤقت"}
            </button>
            <button type="button" disabled={!playing} onClick={stop}>
              إيقاف الصوت
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p role="status">
        المقطع {index + 1} من {turns.length}
        {playing ? (paused ? " · متوقف مؤقتًا" : " · قيد القراءة") : ""}
      </p>
      <button type="button" onClick={download}>
        تنزيل نص الحوار
      </button>
      <ol>
        {turns.map((turn, i) => (
          <li key={i} aria-current={i === index ? "step" : undefined}>
            <h4>{turn.heading}</h4>
            <blockquote dir="auto">{turn.text}</blockquote>
            <button
              type="button"
              onClick={() => {
                stop();
                onCitation(turn.reference);
              }}
            >
              فتح مرجع المقطع {i + 1}
            </button>
            <button
              type="button"
              disabled={!supported || !consent || !voices.length}
              onClick={() => play(i)}
            >
              استمع من المقطع {i + 1}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
