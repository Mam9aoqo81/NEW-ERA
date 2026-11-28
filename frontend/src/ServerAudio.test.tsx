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
    name: "توليد وتنزيل WAV",
  });
  expect(button).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox"));
  await user.click(button);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("انتظر دقيقة");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    consent: true,
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
