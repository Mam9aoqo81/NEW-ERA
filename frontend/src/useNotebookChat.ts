import { useCallback, useEffect, useRef, useState } from "react";
import { api, json, type Answer } from "./api";

type Payload = {
  question: string;
  source_ids: string[];
  mode: "extractive" | "grounded";
  request_id: string;
  semantic_consent?: boolean;
};
export type Turn = {
  id: string;
  question: string;
  mode: Payload["mode"];
  answer?: Answer;
  error?: string;
  saved: boolean;
  payload?: Payload;
};
type StoredTurn = {
  id: number;
  request_id: string;
  question: string;
  mode: Payload["mode"];
  answer: Answer;
  created_at: string;
};
type HistoryPage = { turns: StoredTurn[]; next_before: number | null };
const message = (e: unknown) =>
  e instanceof Error ? e.message : "تعذّر تحميل المحادثة.";
const restore = (t: StoredTurn): Turn => ({
  id: t.request_id,
  question: t.question,
  mode: t.mode,
  answer: { ...t.answer, turn_id: t.id },
  saved: true,
});

/** Each workspace instance owns its requests; no history is stored in the browser. */
export function useNotebookChat(notebookId: string, token: string) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const active = useRef(false),
    locked = useRef(false),
    historyController = useRef<AbortController | null>(null);
  const sendController = useRef<AbortController | null>(null);
  const base = `/v1/notebooks/${notebookId}`;

  const load = useCallback(
    async (cursor?: number) => {
      historyController.current?.abort();
      const controller = new AbortController();
      historyController.current = controller;
      setLoading(true);
      setError("");
      try {
        const page = await api<HistoryPage>(
          `${base}/history?limit=40${cursor ? `&before=${cursor}` : ""}`,
          token,
          { signal: controller.signal },
        );
        if (controller.signal.aborted || !active.current) return;
        setTurns((current) =>
          cursor
            ? [...page.turns.map(restore), ...current].filter(
                (t, i, all) => all.findIndex((x) => x.id === t.id) === i,
              )
            : page.turns.map(restore),
        );
        setBefore(page.next_before);
        setLoaded(true);
        if (!cursor) setScrollRequest((v) => v + 1);
      } catch (e) {
        if (!controller.signal.aborted && active.current) setError(message(e));
      } finally {
        if (!controller.signal.aborted && active.current) setLoading(false);
      }
    },
    [base, token],
  );

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      historyController.current?.abort();
      sendController.current?.abort();
    };
  }, [load]);

  async function perform(payload: Payload, retry = false) {
    if (locked.current || !loaded || loading) return false;
    locked.current = true;
    setBusy(true);
    if (retry)
      setTurns((old) =>
        old.map((t) =>
          t.id === payload.request_id ? { ...t, error: undefined } : t,
        ),
      );
    else
      setTurns((old) => [
        ...old,
        {
          id: payload.request_id,
          question: payload.question,
          mode: payload.mode,
          saved: false,
          payload,
        },
      ]);
    setScrollRequest((v) => v + 1);
    const controller = new AbortController();
    sendController.current = controller;
    try {
      const answer = await api<Answer>(`${base}/ask`, token, {
        ...json(payload),
        signal: controller.signal,
      });
      if (active.current)
        setTurns((old) =>
          old.map((t) =>
            t.id === payload.request_id
              ? {
                  ...t,
                  answer,
                  saved: true,
                  error: undefined,
                  payload: undefined,
                }
              : t,
          ),
        );
    } catch (e) {
      if (!controller.signal.aborted && active.current)
        setTurns((old) =>
          old.map((t) =>
            t.id === payload.request_id ? { ...t, error: message(e) } : t,
          ),
        );
    } finally {
      locked.current = false;
      if (active.current) {
        setBusy(false);
        setScrollRequest((v) => v + 1);
      }
    }
    return true;
  }

  async function send(
    question: string,
    source_ids: string[],
    mode: Payload["mode"],
    semanticConsent = false,
  ) {
    return perform({
      question,
      ...(semanticConsent ? { semantic_consent: true } : {}),
      source_ids: [...source_ids],
      mode,
      request_id: crypto.randomUUID(),
    });
  }
  async function retry(id: string) {
    const turn = turns.find((t) => t.id === id);
    if (turn?.payload) await perform(turn.payload, true);
  }
  async function clear() {
    if (locked.current || loading) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`${base}/history`, token, { method: "DELETE" });
      if (active.current) {
        setTurns([]);
        setBefore(null);
        setLoaded(true);
      }
      return true;
    } catch (e) {
      if (active.current) setError(message(e));
      return false;
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  return {
    turns,
    loaded,
    loading,
    error,
    before,
    busy,
    scrollRequest,
    send,
    retry,
    clear,
    reload: () => load(),
    loadOlder: () => (before && !loading ? load(before) : Promise.resolve()),
  };
}
