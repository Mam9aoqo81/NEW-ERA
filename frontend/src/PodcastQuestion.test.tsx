import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import PodcastQuestion from "./PodcastQuestion";
afterEach(() => vi.unstubAllGlobals());
it("pauses playback and asks only selected sources after explicit text submission", async () => {
  const interrupted = vi.fn();
  window.addEventListener("knowlm-audio-start", interrupted);
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          answered: true,
          answer: "من المصدر فقط",
          notice: "محلي",
          citations: [],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <PodcastQuestion
      notebookId="book"
      token="token"
      sourceIds={["selected"]}
      onCitation={() => {}}
    />,
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("سؤال أثناء الاستماع"),
    "البناء الضوئي",
  );
  expect(interrupted).toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "ابحث في المصادر المحددة" }),
  );
  await screen.findByText("من المصدر فقط");
  expect(
    JSON.parse(
      String(
        (fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].body,
      ),
    ),
  ).toMatchObject({
    source_ids: ["selected"],
    mode: "extractive",
    question: "البناء الضوئي",
  });
  window.removeEventListener("knowlm-audio-start", interrupted);
});
it("microphone requires consent and recognized text is never auto-submitted", async () => {
  const start = vi.fn(),
    abort = vi.fn();
  let instance: { onresult: ((e: unknown) => void) | null };
  class Recognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult = null;
    onerror = null;
    onend = null;
    start = start;
    stop = vi.fn();
    abort = abort;
    constructor() {
      instance = this;
    }
  }
  vi.stubGlobal("SpeechRecognition", Recognition);
  vi.stubGlobal("isSecureContext", true);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { unmount } = render(
    <PodcastQuestion
      notebookId="book"
      token="token"
      sourceIds={["selected"]}
      onCitation={() => {}}
    />,
  );
  const user = userEvent.setup();
  const button = screen.getByRole("button", {
    name: "ابدأ السؤال بالميكروفون",
  });
  expect(button).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(button);
  expect(start).toHaveBeenCalledOnce();
  act(() =>
    instance.onresult?.({ results: [[{ transcript: "سؤال بالصوت" }]] }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("سؤال أثناء الاستماع")).toHaveValue(
      "سؤال بالصوت",
    ),
  );
  expect(fetcher).not.toHaveBeenCalled();
  unmount();
  expect(abort).toHaveBeenCalled();
});
