import { useEffect, useRef, useState } from "react";
import { api, json } from "./api";
import "./pomodoro.css";

type Timer = {
  version: number;
  phase: "work" | "break";
  running: boolean;
  remaining_seconds: number;
  finished: boolean;
  can_control: boolean;
  server_now: string;
  ends_at: string | null;
};
export default function Pomodoro({
  notebookId,
  token,
}: {
  notebookId: string;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Timer | null>(null);
  const [left, setLeft] = useState(1500);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef<{ state: Timer; at: number; left: number } | null>(
    null,
  );
  const post = useRef<AbortController | null>(null);
  const url = `/v1/notebooks/${notebookId}/pomodoro`;
  function apply(next: Timer, started: number) {
    if (latest.current && next.version < latest.current.state.version) return;
    const received = performance.now();
    const seconds = Math.max(
      0,
      next.remaining_seconds - (next.running ? (received - started) / 2000 : 0),
    );
    latest.current = { state: next, at: received, left: seconds };
    setState(next);
    setLeft(Math.ceil(seconds));
    setError("");
  }
  useEffect(() => {
    if (!open) return;
    let stopped = false,
      pending = false;
    const controller = new AbortController();
    async function load() {
      if (pending || document.hidden) return;
      pending = true;
      const started = performance.now();
      try {
        const next = await api<Timer>(url, token, {
          signal: controller.signal,
        });
        if (!stopped) apply(next, started);
      } catch {
        if (!stopped) {
          setState(null);
          setError(
            "تعذر مزامنة المؤقت أو لم تعد لديك صلاحية. أعد فتحه للمحاولة.",
          );
        }
      } finally {
        pending = false;
      }
    }
    void load();
    const poll = setInterval(() => void load(), 5000);
    const tick = setInterval(() => {
      const current = latest.current;
      if (current)
        setLeft(
          Math.ceil(
            Math.max(
              0,
              current.left -
                (current.state.running
                  ? (performance.now() - current.at) / 1000
                  : 0),
            ),
          ),
        );
    }, 250);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      controller.abort();
      post.current?.abort();
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [open, url, token]);
  async function act(action: "start" | "pause" | "reset" | "next") {
    if (!state || busy) return;
    if (
      action === "reset" &&
      !window.confirm("إعادة ضبط مؤقت الدفتر لكل الأعضاء؟")
    )
      return;
    const controller = new AbortController();
    post.current = controller;
    setBusy(true);
    const started = performance.now();
    try {
      const next = await api<Timer>(url, token, {
        ...json({ action, version: state.version }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) apply(next, started);
    } catch {
      if (!controller.signal.aborted) {
        setState(null);
        setError(
          "تعذر تأكيد نتيجة الطلب. قد يكون عضو آخر سبَقك أو انقطع الاتصال؛ ستُجلب الحالة مجددًا.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const time = `${Math.floor(left / 60)
    .toString()
    .padStart(2, "0")}:${(left % 60).toString().padStart(2, "0")}`;
  return (
    <section className="pomodoro" aria-label="مؤقت المذاكرة المشترك">
      <button
        type="button"
        className="outline"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setBusy(false);
        }}
      >
        مؤقت Pomodoro المشترك 25/5
      </button>
      {open && (
        <div>
          <p>
            25 دقيقة تركيز ثم 5 دقائق راحة. المؤقت واحد لكل الدفتر، ويتحكم فيه
            المالك والمحررون. يتزامن كل 5 ثوانٍ؛ ليس بثًا لحظيًا أو غرفة صوت/فيديو.
            لا انتقال تلقائي ولا تنبيه بالخلفية.
          </p>
          {error && <p role="alert">{error}</p>}
          {state && (
            <>
              <h3>{state.phase === "work" ? "وقت التركيز" : "وقت الراحة"}</h3>
              <output aria-label="الوقت المتبقي" aria-live="off" dir="ltr">
                {time}
              </output>
              <p role="status">
                {left <= 0
                  ? "انتهت الفترة — انتقل يدويًا للفترة التالية"
                  : state.running
                    ? "المؤقت يعمل"
                    : "المؤقت متوقف"}
              </p>
              {state.can_control ? (
                <div className="tools-row">
                  <button
                    type="button"
                    disabled={busy || left <= 0}
                    onClick={() => void act(state.running ? "pause" : "start")}
                  >
                    {state.running ? "إيقاف المؤقت مؤقتًا" : "بدء المؤقت"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act("reset")}
                  >
                    إعادة ضبط الفترة
                  </button>
                  <button
                    type="button"
                    disabled={busy || left > 0}
                    onClick={() => void act("next")}
                  >
                    الفترة التالية
                  </button>
                </div>
              ) : (
                <p>أنت قارئ: يمكنك متابعة الوقت، والتحكم للمالك والمحررين.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
