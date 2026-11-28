import { useEffect, useRef, useState } from "react";
import { api, json, type Citation } from "./api";
import type { PodcastTurn } from "./Podcast";

type Cue = { index: number; start: number; end: number };
export function parseAudioCues(raw: string | null, count: number): Cue[] {
  try {
    const cues: Cue[] = JSON.parse(raw || "null");
    if (
      !Array.isArray(cues) ||
      cues.length !== count ||
      cues.length > 20 ||
      !cues.length
    )
      return [];
    let end = 0;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (
        !cue ||
        cue.index !== i ||
        !Number.isFinite(cue.start) ||
        !Number.isFinite(cue.end) ||
        Math.abs(cue.start - end) > 0.000001 ||
        cue.end <= cue.start ||
        cue.end > 600
      )
        return [];
      end = cue.end;
    }
    return cues;
  } catch {
    return [];
  }
}
function timestamp(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export default function ServerAudio({
  artifactId,
  token,
  turns = [],
  onCitation,
}: {
  artifactId: string;
  token: string;
  turns?: PodcastTurn[];
  onCitation?: (reference: Citation) => void;
}) {
  const request = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [cues, setCues] = useState<Cue[]>([]);
  const [position, setPosition] = useState(0);
  useEffect(() => {
    const player = audio.current;
    return () => {
      player?.pause();
    };
  }, [url]);
  useEffect(() => {
    function otherAudio(event: Event) {
      if ((event as CustomEvent).detail !== "server") audio.current?.pause();
    }
    window.addEventListener("knowlm-audio-start", otherAudio);
    return () => {
      request.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      window.removeEventListener("knowlm-audio-start", otherAudio);
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    api<{ enabled: boolean }>("/v1/audio/config", token, { signal: c.signal })
      .then((r) => setEnabled(r.enabled))
      .catch(() => {
        if (!c.signal.aborted)
          setError("تعذر التحقق من توفر توليد الصوت الخادمي.");
      });
    return () => c.abort();
  }, [token]);
  function clear() {
    request.current?.abort();
    audio.current?.pause();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setUrl("");
    setCues([]);
    setPosition(0);
    setBusy(false);
  }
  async function generate() {
    if (request.current && busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/v1/study-artifacts/${artifactId}/audio`, {
        ...json({ consent: true }),
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "تجاوزت حد توليد الصوت. انتظر دقيقة قبل المحاولة."
            : "تعذر توليد الملف الصوتي. تحقق من الجلسة وإعداد المزود؛ لن تُعاد المحاولة تلقائيًا.",
        );
      if (
        !response.headers
          .get("Content-Type")
          ?.toLowerCase()
          .startsWith("audio/wav")
      )
        throw new Error("صيغة الملف الصوتي غير مدعومة.");
      const markers = parseAudioCues(
        response.headers.get("X-KnowLM-Audio-Cues"),
        turns.length,
      );
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (!blob.size || blob.size > 16_000_000)
        throw new Error("حجم الملف الصوتي غير صالح.");
      const nextUrl = URL.createObjectURL(blob);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = nextUrl;
      setUrl(nextUrl);
      setCues(markers);
      setPosition(0);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "تعذر تنزيل الصوت");
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }
  const active = cues.findIndex(
    (c, i) =>
      position >= c.start && (position < c.end || i === cues.length - 1),
  );
  return (
    <section aria-label="تنزيل صوت الحوار">
      <h4>ملف صوتي WAV</h4>
      {!enabled ? (
        <p>توليد الملفات الصوتية الخادمي غير مفعّل في هذه البيئة.</p>
      ) : (
        <>
          <p>
            التوليد يرسل نص الحوار إلى مزود الصوت الذي يحدده المشغل، وقد تترتب
            عليه تكلفة. متاح لمالك الدفتر فقط مع حدود للطلبات. الملف متاح هنا
            مؤقتًا ولا يُحفظ على الخادم؛ النسخة المنزلة لن تُمحى عند حذف الدفتر.
          </p>
          <label>
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(e) => setChecked(e.target.checked)}
            />
            أوافق على إرسال نص الحوار للمزود الخارجي لتوليد ملف صوتي
          </label>
          <button
            type="button"
            disabled={!checked || busy || !!url}
            onClick={() => void generate()}
          >
            {busy ? "جارٍ توليد الصوت…" : "توليد ملف WAV"}
          </button>
          {busy && (
            <button type="button" onClick={clear}>
              إلغاء انتظار الصوت
            </button>
          )}
        </>
      )}
      {url && (
        <>
          <audio
            ref={audio}
            controls
            preload="metadata"
            src={url}
            aria-label="مشغل ملف الحوار"
            onPlay={() =>
              window.dispatchEvent(
                new CustomEvent("knowlm-audio-start", { detail: "server" }),
              )
            }
            onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
            onSeeked={(e) => setPosition(e.currentTarget.currentTime)}
            onError={() =>
              setError("تعذر تشغيل WAV على هذا المتصفح. يمكنك تنزيل الملف.")
            }
          />
          <div className="tools-row">
            <a href={url} download="knowlm-review.wav">
              تنزيل ملف WAV
            </a>
            <button type="button" onClick={clear}>
              مسح الصوت المؤقت
            </button>
          </div>
          <p>
            لا يبدأ التشغيل تلقائيًا. التوقيت لحدود الأدوار من عينات الملف، وليس
            محاذاة كلمات. الملف المؤقت يختفي عند إغلاق هذا المخرج أو تحديث
            الصفحة.
          </p>
          {cues.length ? (
            <>
              <p role="status">
                المقطع الصوتي {Math.max(0, active) + 1} من {cues.length}
              </p>
              <ol aria-label="توقيت مقاطع الحوار">
                {cues.map((cue, i) => (
                  <li key={i} aria-current={active === i ? "step" : undefined}>
                    <button
                      type="button"
                      onClick={() => {
                        if (audio.current) {
                          audio.current.pause();
                          audio.current.currentTime = cue.start;
                          setPosition(cue.start);
                        }
                      }}
                    >
                      انتقل للمقطع {i + 1} ·{" "}
                      <bdi>
                        {timestamp(cue.start)}–{timestamp(cue.end)}
                      </bdi>{" "}
                      · {turns[i].heading}
                    </button>
                    {onCitation && (
                      <button
                        type="button"
                        onClick={() => {
                          audio.current?.pause();
                          onCitation(turns[i].reference);
                        }}
                      >
                        فتح مرجع الصوت {i + 1}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p>
              لا توجد علامات توقيت صالحة؛ مشغل الملف والتنزيل ما زالا متاحين.
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
