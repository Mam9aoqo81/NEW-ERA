import { useEffect, useRef, useState } from "react";
import { api, json } from "./api";

export default function ServerAudio({
  artifactId,
  token,
}: {
  artifactId: string;
  token: string;
}) {
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  async function generate() {
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
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "knowlm-review.wav";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "تعذر تنزيل الصوت");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="تنزيل صوت الحوار">
      <h4>ملف صوتي WAV</h4>
      {!enabled ? (
        <p>توليد الملفات الصوتية الخادمي غير مفعّل في هذه البيئة.</p>
      ) : (
        <>
          <p>
            التوليد يرسل نص الحوار إلى مزود الصوت الذي يحدده المشغل، وقد تترتب
            عليه تكلفة. متاح لمالك الدفتر فقط، بحد 3 طلبات في الدقيقة. الملف لا
            يُحفظ على الخادم؛ النسخة المنزلة لن تُمحى عند حذف الدفتر.
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
            disabled={!checked || busy}
            onClick={() => void generate()}
          >
            {busy ? "جارٍ توليد الصوت…" : "توليد وتنزيل WAV"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
