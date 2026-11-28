import { useEffect, useRef, useState } from "react";
import { api, json, type Citation } from "./api";
import "./canvas.css";

type Point = { x: number; y: number };
type Stroke = { color: string; width: number; points: Point[] };
type Board = {
  version: number;
  notes: string;
  strokes: Stroke[];
  chunk_ids: string[];
  references: Citation[];
};
const empty = (): Board => ({
  version: 0,
  notes: "",
  strokes: [],
  chunk_ids: [],
  references: [],
});
export default function Canvas({
  notebookId,
  token,
  citation,
  onCitation,
}: {
  notebookId: string;
  token: string;
  citation: Citation | null;
  onCitation: (c: Citation) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [lastCitation, setLastCitation] = useState<Citation | null>(null);
  useEffect(() => {
    if (citation) setLastCitation(citation);
  }, [citation]);
  const [board, setBoard] = useState<Board>(empty);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const active = useRef<Stroke | null>(null);
  const pointer = useRef<number | null>(null);
  const [color, setColor] = useState("#164e63");
  const [width, setWidth] = useState(3);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const url = `/v1/notebooks/${notebookId}/canvas`;
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    api<Board>(url, token, { signal: controller.signal })
      .then((b) => {
        setBoard(b);
        setReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("تعذر تحميل اللوحة. أعد فتحها للمحاولة.");
      });
    return () => controller.abort();
  }, [url, token, opened]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function changed(next: Board) {
    setBoard(next);
    setDirty(true);
    setStatus("");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const { references: _, ...body } = board;
      const result = await api<Board>(url, token, {
        ...json(body),
        method: "PUT",
      });
      setBoard(result);
      setDirty(false);
      setStatus("تم حفظ اللوحة الخاصة");
    } catch {
      setError(
        "لم تُحفظ اللوحة. قد تكون نسخة أخرى تغيرت أو انتهت الجلسة. احتفظ بملاحظاتك قبل إعادة التحميل.",
      );
    } finally {
      setBusy(false);
    }
  }
  function finish(cancel = false) {
    if (active.current && !cancel)
      changed({ ...board, strokes: [...board.strokes, active.current] });
    active.current = null;
    pointer.current = null;
    setDraft(null);
  }
  return (
    <details
      className="ink-panel"
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary>لوحة المذاكرة بالقلم والملاحظات · خاصة بي</summary>
      <p>
        الرسم محفوظ في حسابك فقط، حتى داخل الدفتر المشترك. لا يوجد تعرف على خط
        اليد أو إجابة AI من الرسم. احفظ قبل تبديل الدفتر أو مغادرة الصفحة.
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={!ready || busy}>
        <legend>أدوات اللوحة</legend>
        <label>
          لون القلم{" "}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          سمك القلم{" "}
          <input
            type="range"
            min="1"
            max="12"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          disabled={!board.strokes.length}
          onClick={() =>
            changed({ ...board, strokes: board.strokes.slice(0, -1) })
          }
        >
          تراجع عن آخر خط
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                "مسح الرسم والملاحظات والمراجع؟ لن يُحفظ المسح حتى تضغط حفظ.",
              )
            )
              changed({ ...empty(), version: board.version });
          }}
        >
          مسح اللوحة
        </button>
        <svg
          role="img"
          aria-label="مساحة رسم بالقلم أو اللمس، والملاحظات النصية متاحة أدناه"
          viewBox="0 0 1000 600"
          onPointerDown={(e) => {
            if (
              busy ||
              !ready ||
              active.current ||
              board.strokes.length >= 200 ||
              e.button !== 0
            )
              return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pointer.current = e.pointerId;
            const r = e.currentTarget.getBoundingClientRect();
            active.current = {
              color,
              width,
              points: [
                {
                  x: Math.max(
                    0,
                    Math.min(1000, ((e.clientX - r.left) / r.width) * 1000),
                  ),
                  y: Math.max(
                    0,
                    Math.min(600, ((e.clientY - r.top) / r.height) * 600),
                  ),
                },
              ],
            };
            setDraft({ ...active.current });
          }}
          onPointerMove={(e) => {
            if (
              !active.current ||
              pointer.current !== e.pointerId ||
              active.current.points.length >= 1000
            )
              return;
            const r = e.currentTarget.getBoundingClientRect();
            active.current.points.push({
              x: Math.max(
                0,
                Math.min(1000, ((e.clientX - r.left) / r.width) * 1000),
              ),
              y: Math.max(
                0,
                Math.min(600, ((e.clientY - r.top) / r.height) * 600),
              ),
            });
            setDraft({ ...active.current });
          }}
          onPointerUp={(e) => {
            if (pointer.current === e.pointerId) finish();
          }}
          onPointerCancel={() => finish(true)}
          onLostPointerCapture={() => {
            if (active.current) finish();
          }}
        >
          {[...board.strokes, ...(draft ? [draft] : [])].map((s, i) =>
            s.points.length === 1 ? (
              <circle
                key={i}
                cx={s.points[0].x}
                cy={s.points[0].y}
                r={s.width / 2}
                fill={s.color}
              />
            ) : (
              <polyline
                key={i}
                points={s.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}
        </svg>
        <small>{board.strokes.length}/200 خط · حتى 1000 نقطة لكل خط</small>
        <label>
          ملاحظاتي النصية
          <textarea
            maxLength={10000}
            value={board.notes}
            onChange={(e) => changed({ ...board, notes: e.target.value })}
          />
        </label>
        <button
          type="button"
          disabled={
            !lastCitation ||
            board.chunk_ids.length >= 20 ||
            board.chunk_ids.includes(lastCitation.chunk_id)
          }
          onClick={() => {
            if (lastCitation)
              changed({
                ...board,
                chunk_ids: [...board.chunk_ids, lastCitation.chunk_id],
                references: [...board.references, lastCitation],
              });
          }}
        >
          ربط آخر مرجع فتحته باللوحة
        </button>
        <ul>
          {board.references.map((c) => (
            <li key={c.chunk_id}>
              <button type="button" onClick={() => onCitation(c)}>
                {c.title}
              </button>
              <button
                type="button"
                aria-label={`إزالة مرجع ${c.title}`}
                onClick={() =>
                  changed({
                    ...board,
                    references: board.references.filter(
                      (r) => r.chunk_id !== c.chunk_id,
                    ),
                    chunk_ids: board.chunk_ids.filter(
                      (id) => id !== c.chunk_id,
                    ),
                  })
                }
              >
                إزالة
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={!dirty || !!draft}
          onClick={() => void save()}
        >
          {busy ? "جارٍ الحفظ…" : "حفظ اللوحة"}
        </button>
        <span role="status">{dirty ? "تغييرات غير محفوظة" : status}</span>
      </fieldset>
    </details>
  );
}
