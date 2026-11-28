import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotebookChat } from "./useNotebookChat";
import { api } from "./api";

vi.mock("./api", () => ({
  api: vi.fn(),
  json: (body: unknown) => ({ method: "POST", body: JSON.stringify(body) }),
}));
const mock = vi.mocked(api);
const answer = {
  mode: "extractive" as const,
  answered: true,
  answer: "A stored answer [1]",
  citations: [],
  notice: "Source excerpt",
};
const stored = (id: number) => ({
  id,
  request_id: `request-${id}`,
  question: `Question ${id}`,
  mode: "extractive",
  created_at: "2026-11-27T00:00:00+00:00",
  answer,
});
beforeEach(() => {
  mock.mockReset();
});

describe("durable notebook chat", () => {
  it("restores history and prepends older pages without duplicating turns", async () => {
    mock.mockResolvedValueOnce({
      turns: [stored(3), stored(4)],
      next_before: 3,
    });
    const { result } = renderHook(() => useNotebookChat("notebook", "token"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.turns.map((t) => t.id)).toEqual([
      "request-3",
      "request-4",
    ]);
    expect(result.current.turns.every((t) => t.saved)).toBe(true);
    const scroll = result.current.scrollRequest;
    mock.mockResolvedValueOnce({
      turns: [stored(1), stored(2), stored(3)],
      next_before: null,
    });
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(mock).toHaveBeenLastCalledWith(
      "/v1/notebooks/notebook/history?limit=40&before=3",
      "token",
      expect.any(Object),
    );
    expect(result.current.turns.map((t) => t.id)).toEqual([
      "request-1",
      "request-2",
      "request-3",
      "request-4",
    ]);
    expect(result.current.scrollRequest).toBe(scroll);
  });
  it("does not send when history could not be loaded and allows reloading", async () => {
    mock.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useNotebookChat("notebook", "token"));
    await waitFor(() => expect(result.current.error).toBe("offline"));
    expect(result.current.loaded).toBe(false);
    await act(async () => {
      expect(
        await result.current.send("question", ["source"], "extractive"),
      ).toBe(false);
    });
    expect(mock).toHaveBeenCalledTimes(1);
    mock.mockResolvedValueOnce({ turns: [], next_before: null });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toBe("");
  });
  it("reuses the same idempotency key and original sources after a lost response", async () => {
    mock.mockResolvedValueOnce({ turns: [], next_before: null });
    const { result } = renderHook(() => useNotebookChat("notebook", "token"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    mock.mockRejectedValueOnce(new Error("Connection lost"));
    await act(async () => {
      await result.current.send(
        "my question",
        ["selected-source"],
        "extractive",
      );
    });
    const failed = result.current.turns[0];
    expect(failed.error).toBe("Connection lost");
    expect(failed.saved).toBe(false);
    const first = JSON.parse(String(mock.mock.calls[1][2]?.body));
    mock.mockResolvedValueOnce(answer);
    await act(async () => {
      await result.current.retry(failed.id);
    });
    const retried = JSON.parse(String(mock.mock.calls[2][2]?.body));
    expect(retried).toEqual(first);
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]).toMatchObject({
      saved: true,
      answer,
      error: undefined,
      payload: undefined,
    });
  });
  it("keeps history visible if deletion fails and clears only after server success", async () => {
    mock.mockResolvedValueOnce({ turns: [stored(1)], next_before: null });
    const { result } = renderHook(() => useNotebookChat("notebook", "token"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    mock.mockRejectedValueOnce(new Error("could not delete"));
    await act(async () => {
      expect(await result.current.clear()).toBe(false);
    });
    expect(result.current.turns).toHaveLength(1);
    mock.mockResolvedValueOnce(undefined);
    await act(async () => {
      expect(await result.current.clear()).toBe(true);
    });
    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBe("");
    expect(mock).toHaveBeenLastCalledWith(
      "/v1/notebooks/notebook/history",
      "token",
      { method: "DELETE" },
    );
  });
  it("aborts history fetch when leaving a notebook", () => {
    mock.mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderHook(() =>
      useNotebookChat("private-notebook", "token"),
    );
    const signal = mock.mock.calls[0][2]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

it("sends semantic consent only when explicit, preserving it on retry", async () => {
  mock.mockResolvedValueOnce({ turns: [], next_before: null });
  const { result } = renderHook(() => useNotebookChat("notebook", "token"));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  mock.mockRejectedValueOnce(new Error("provider offline"));
  await act(async () => {
    await result.current.send("food", ["selected"], "extractive", true);
  });
  const payload = JSON.parse(String(mock.mock.calls.at(-1)?.[2]?.body));
  expect(payload.semantic_consent).toBe(true);
  expect(payload.source_ids).toEqual(["selected"]);
  mock.mockResolvedValueOnce(answer);
  await act(async () => {
    await result.current.retry(payload.request_id);
  });
  expect(JSON.parse(String(mock.mock.calls.at(-1)?.[2]?.body))).toEqual(
    payload,
  );
});
