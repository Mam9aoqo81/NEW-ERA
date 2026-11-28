import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import Canvas from "./Canvas";
afterEach(() => vi.unstubAllGlobals());
it("loads only on demand and saves notes using optimistic version", async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit = {}) => {
      calls.push(init);
      return new Response(
        JSON.stringify({
          version: init.method === "PUT" ? 1 : 0,
          notes: init.method === "PUT" ? "ملاحظاتي" : "",
          strokes: [],
          chunk_ids: [],
          references: [],
        }),
      );
    }),
  );
  render(
    <Canvas
      notebookId="book"
      token="token"
      citation={null}
      onCitation={() => {}}
    />,
  );
  expect(calls).toHaveLength(0);
  const user = userEvent.setup();
  await user.click(screen.getByText(/لوحة المذاكرة بالقلم/));
  await waitFor(() =>
    expect(screen.getByLabelText("ملاحظاتي النصية")).toBeEnabled(),
  );
  await user.type(screen.getByLabelText("ملاحظاتي النصية"), "ملاحظاتي");
  await user.click(screen.getByRole("button", { name: "حفظ اللوحة" }));
  await screen.findByText("تم حفظ اللوحة الخاصة");
  expect(JSON.parse(String(calls[1].body))).toMatchObject({
    version: 0,
    notes: "ملاحظاتي",
  });
  expect(calls[1].method).toBe("PUT");
});
it("preserves notes and displays save conflict", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: unknown, init: RequestInit = {}) =>
        new Response(
          JSON.stringify(
            init.method === "PUT"
              ? { detail: "conflict" }
              : {
                  version: 1,
                  notes: "",
                  strokes: [],
                  chunk_ids: [],
                  references: [],
                },
          ),
          { status: init.method === "PUT" ? 409 : 200 },
        ),
    ),
  );
  render(
    <Canvas
      notebookId="book"
      token="token"
      citation={null}
      onCitation={() => {}}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText(/لوحة المذاكرة بالقلم/));
  await waitFor(() =>
    expect(screen.getByLabelText("ملاحظاتي النصية")).toBeEnabled(),
  );
  await user.type(screen.getByLabelText("ملاحظاتي النصية"), "keep");
  await user.click(screen.getByRole("button", { name: "حفظ اللوحة" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("ملاحظاتي النصية")).toHaveValue("keep");
});
