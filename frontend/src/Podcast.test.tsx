import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import Podcast, { type PodcastTurn } from "./Podcast";
import type { Citation } from "./api";
const turns: PodcastTurn[] = [
  {
    heading: "المحاور",
    text: "ماذا يقول المقطع؟",
    speaker: "host",
    language: "ar",
    reference: { title: "مصدر", page: 1 } as Citation,
  },
  {
    heading: "القارئ",
    text: "هذا نص حرفي من المصدر",
    speaker: "reader",
    language: "ar",
    reference: { title: "مصدر", page: 1 } as Citation,
  },
];
afterEach(() => vi.unstubAllGlobals());
function speech() {
  class Utterance {
    text: string;
    voice: unknown;
    lang = "";
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    getVoices: () => [
      { voiceURI: "voice1", name: "A", lang: "ar-EG", localService: true },
      { voiceURI: "voice2", name: "B", lang: "ar-SA", localService: false },
    ],
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  return synth;
}
it("does not send text to speech without consent; alternates available voices and stops on unmount", async () => {
  const synth = speech();
  const user = userEvent.setup();
  const { unmount } = render(<Podcast turns={turns} onCitation={() => {}} />);
  const play = screen.getByRole("button", { name: "تشغيل الحوار" });
  expect(play).toBeDisabled();
  expect(synth.speak).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(play);
  expect(synth.speak.mock.calls[0][0].text).toBe(turns[0].text);
  expect(synth.speak.mock.calls[0][0].voice.voiceURI).toBe("voice1");
  await user.click(screen.getByRole("button", { name: "إيقاف مؤقت" }));
  expect(synth.pause).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "استئناف الصوت" }));
  expect(synth.resume).toHaveBeenCalled();
  synth.speak.mock.calls[0][0].onend();
  await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(2));
  expect(synth.speak.mock.calls[1][0].text).toBe(turns[1].text);
  expect(synth.speak.mock.calls[1][0].voice.voiceURI).toBe("voice2");
  const stale = synth.speak.mock.calls[1][0].onend;
  unmount();
  stale();
  expect(synth.speak).toHaveBeenCalledTimes(2);
  expect(synth.cancel).toHaveBeenCalled();
});
it("stops speech before opening a private citation and ignores stale callbacks", async () => {
  const synth = speech(),
    onCitation = vi.fn(),
    user = userEvent.setup();
  render(<Podcast turns={turns} onCitation={onCitation} />);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "تشغيل الحوار" }));
  const stale = synth.speak.mock.calls[0][0].onend;
  await user.click(screen.getByRole("button", { name: "فتح مرجع المقطع 1" }));
  stale();
  expect(onCitation).toHaveBeenCalledWith(turns[0].reference);
  expect(synth.speak).toHaveBeenCalledTimes(1);
});
it("keeps transcript available without browser audio", () => {
  vi.stubGlobal("speechSynthesis", undefined);
  vi.stubGlobal("SpeechSynthesisUtterance", undefined);
  render(<Podcast turns={turns} onCitation={() => {}} />);
  expect(screen.getByText(/المتصفح لا يدعم/)).toBeInTheDocument();
  expect(screen.getByText(turns[1].text)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "تنزيل نص الحوار" })).toBeEnabled();
});
