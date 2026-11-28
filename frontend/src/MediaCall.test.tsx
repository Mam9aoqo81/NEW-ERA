import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import MediaCall from "./MediaCall";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function environment(getUserMedia: ReturnType<typeof vi.fn>) {
  const nav = Object.create(navigator);
  Object.defineProperty(nav, "mediaDevices", { value: { getUserMedia } });
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("RTCPeerConnection", class {});
  return vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const path = String(input);
      if (init.method === "DELETE" || path.endsWith("/heartbeat"))
        return new Response(null, { status: 204 });
      if (path.endsWith("/config"))
        return new Response(
          JSON.stringify({ iceServers: [], has_turn: false }),
        );
      if (path.endsWith("/sessions"))
        return new Response(JSON.stringify({ id: "session" }), { status: 201 });
      return new Response(
        JSON.stringify({ peers: [], signals: [], next_after: 0 }),
      );
    }),
  );
}
it("never opens devices before consent and stops all tracks on explicit leave", async () => {
  const stop = vi.fn();
  const track = { stop, enabled: true };
  const media = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  };
  const acquire = vi.fn(async () => media);
  environment(acquire);
  render(<MediaCall notebookId="book" token="token" />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "مكالمة صوت وفيديو · شخصان" }),
  );
  const join = await screen.findByRole("button", { name: "انضم للمكالمة" });
  expect(join).toBeDisabled();
  expect(acquire).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText(/أوافق على تشغيل الأجهزة/));
  await waitFor(() => expect(join).toBeEnabled());
  await user.click(join);
  await screen.findByRole("button", { name: "إنهاء المكالمة وإيقاف الأجهزة" });
  expect(acquire).toHaveBeenCalledWith({ audio: true, video: false });
  await user.click(screen.getByRole("button", { name: "كتم الميكروفون" }));
  expect(track.enabled).toBe(false);
  await user.click(
    screen.getByRole("button", { name: "إنهاء المكالمة وإيقاف الأجهزة" }),
  );
  expect(stop).toHaveBeenCalled();
});
it("stops a late permission result after the component has been closed", async () => {
  let resolve!: (value: unknown) => void;
  const stop = vi.fn();
  const acquire = vi.fn(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  environment(acquire);
  const { unmount } = render(<MediaCall notebookId="book" token="token" />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "مكالمة صوت وفيديو · شخصان" }),
  );
  await user.click(screen.getByLabelText(/أوافق على تشغيل الأجهزة/));
  const join = screen.getByRole("button", { name: "انضم للمكالمة" });
  await waitFor(() => expect(join).toBeEnabled());
  await user.click(join);
  await waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  unmount();
  await act(async () => resolve({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce();
});
