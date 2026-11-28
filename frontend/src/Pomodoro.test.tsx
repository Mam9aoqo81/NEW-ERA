import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import Pomodoro from "./Pomodoro";
const initial = {
  version: 0,
  phase: "work",
  running: false,
  remaining_seconds: 1500,
  finished: false,
  can_control: true,
  server_now: new Date().toISOString(),
  ends_at: null,
};
afterEach(() => vi.unstubAllGlobals());
it("loads only when opened and sends the observed version for shared controls", async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: unknown, init: RequestInit = {}) => {
      calls.push(init);
      return new Response(
        JSON.stringify(
          init.method === "POST"
            ? { ...initial, version: 1, running: true }
            : initial,
        ),
      );
    }),
  );
  render(<Pomodoro notebookId="book" token="token" />);
  expect(calls).toHaveLength(0);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "مؤقت Pomodoro المشترك 25/5" }),
  );
  await screen.findByRole("button", { name: "بدء المؤقت" });
  expect(screen.getByLabelText("الوقت المتبقي")).toHaveTextContent("25:00");
  await user.click(screen.getByRole("button", { name: "بدء المؤقت" }));
  await screen.findByRole("button", { name: "إيقاف المؤقت مؤقتًا" });
  expect(JSON.parse(String(calls[1].body))).toEqual({
    action: "start",
    version: 0,
  });
});
it("does not expose timer mutations to a viewer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ...initial, can_control: false })),
    ),
  );
  render(<Pomodoro notebookId="book" token="token" />);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "مؤقت Pomodoro المشترك 25/5" }));
  await screen.findByText(/أنت قارئ/);
  expect(
    screen.queryByRole("button", { name: "بدء المؤقت" }),
  ).not.toBeInTheDocument();
});
it("hides stale state after a conflict until the next server refresh", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_path: unknown, init: RequestInit = {}) =>
        new Response(
          JSON.stringify(
            init.method === "POST" ? { detail: "conflict" } : initial,
          ),
          { status: init.method === "POST" ? 409 : 200 },
        ),
    ),
  );
  render(<Pomodoro notebookId="book" token="token" />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "مؤقت Pomodoro المشترك 25/5" }),
  );
  await user.click(await screen.findByRole("button", { name: "بدء المؤقت" }));
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(screen.queryByLabelText("الوقت المتبقي")).not.toBeInTheDocument(),
  );
});
