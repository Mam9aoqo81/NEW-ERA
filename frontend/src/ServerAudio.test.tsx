import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import ServerAudio from "./ServerAudio";
afterEach(() => vi.unstubAllGlobals());
it("requires separate external consent and displays generation errors without automatic retry", async () => {
  const fetcher = vi.fn(
    async (_url: unknown, init: RequestInit = {}) =>
      new Response(
        JSON.stringify(
          init.method === "POST" ? { detail: "limited" } : { enabled: true },
        ),
        { status: init.method === "POST" ? 429 : 200 },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<ServerAudio artifactId="saved" token="private-token" />);
  const button = await screen.findByRole("button", {
    name: "توليد ملف WAV",
  });
  expect(button).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(2);
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(/أوافق على إرسال نص الحوار/));
  await user.click(button);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("انتظر دقيقة");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
    consent: true,
    save: false,
  });
});
it("shows disabled environment without offering a fake download", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ enabled: false }))),
  );
  render(<ServerAudio artifactId="saved" token="token" />);
  await waitFor(() => expect(screen.getByText(/غير مفعّل/)).toBeVisible());
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("uses one generated blob for playback, seeking, citations and download then clears it", async () => {
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {});
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:generated"),
    revokeObjectURL: revoke,
  });
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit = {}) =>
    init.method === "POST"
      ? new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "Content-Type": "audio/wav",
            "X-KnowLM-Audio-Cues": JSON.stringify([
              { index: 0, start: 0, end: 2 },
              { index: 1, start: 2, end: 5 },
            ]),
          },
        })
      : new Response(JSON.stringify({ enabled: true })),
  );
  vi.stubGlobal("fetch", fetcher);
  const onCitation = vi.fn();
  const turns = [
    { heading: "المحاور", text: "q", reference: { title: "مصدر" } },
    { heading: "القارئ", text: "a", reference: { title: "مصدر" } },
  ] as import("./Podcast").PodcastTurn[];
  const { unmount } = render(
    <ServerAudio
      artifactId="saved"
      token="token"
      turns={turns}
      onCitation={onCitation}
    />,
  );
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "توليد ملف WAV" });
  await user.click(screen.getByLabelText(/أوافق على إرسال نص الحوار/));
  await user.click(screen.getByRole("button", { name: "توليد ملف WAV" }));
  const link = await screen.findByRole("link", { name: "تنزيل ملف WAV" });
  expect(link).toHaveAttribute("href", "blob:generated");
  const player = screen.getByLabelText("مشغل ملف الحوار") as HTMLAudioElement;
  await user.click(screen.getByRole("button", { name: /انتقل للمقطع 2/ }));
  expect(player.currentTime).toBe(2);
  await user.click(screen.getByRole("button", { name: "فتح مرجع الصوت 2" }));
  expect(onCitation).toHaveBeenCalledWith(turns[1].reference);
  expect(pause).toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: "مسح الصوت المؤقت" }));
  expect(revoke).toHaveBeenCalledWith("blob:generated");
  expect(screen.queryByLabelText("مشغل ملف الحوار")).not.toBeInTheDocument();
  unmount();
  pause.mockRestore();
});

it("rejects malformed and noncontiguous cue metadata", async () => {
  const { parseAudioCues } = await import("./ServerAudio");
  for (const raw of [
    null,
    "not json",
    "{}",
    '[{"index":0,"start":1,"end":2}]',
    '[{"index":0,"start":0,"end":601}]',
    '[{"index":0,"start":0,"end":-1}]',
  ])
    expect(parseAudioCues(raw, 1)).toEqual([]);
  expect(parseAudioCues('[{"index":0,"start":0,"end":1}]', 1)).toHaveLength(1);
  expect(parseAudioCues('[{"index":0,"start":0,"end":1}]', 2)).toEqual([]);
});
