import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SharedLearning, { SharePublisher } from "./Sharing";
const token = "a".repeat(43);
const expiry = "2030-01-01T00:00:00+00:00";
function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
describe("explicit learning sharing", () => {
  it("requires preview and affirmative consent before posting, without auto-sharing citations", async () => {
    const user = userEvent.setup(),
      calls: { path: string; init: RequestInit }[] = [];
    let published = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = String(input);
        calls.push({ path, init });
        if (path.endsWith("/share-preview"))
          return response({
            preview_hash: "b".repeat(64),
            snapshot: {
              kind: "cards",
              items: [
                { front: "<img src=x onerror=alert(1)>", back: "answer" },
              ],
            },
          });
        if (path === "/v1/notebooks/n/shares")
          return response(
            published
              ? [
                  {
                    id: "share-id",
                    title: "مراجعة مشتركة",
                    kind: "cards",
                    active: true,
                    expires_at: expiry,
                  },
                ]
              : [],
          );
        if (path === "/v1/decks/d/shares") {
          published = true;
          return response({ id: "share-id", token, expires_at: expiry }, 201);
        }
        if (path === "/v1/shares/share-id") return response(null, 204);
        throw new Error(path);
      }),
    );
    const { container } = render(
      <SharePublisher
        target="/v1/decks/d"
        notebookId="n"
        token="owner-token"
        kind="cards"
      />,
    );
    await user.click(screen.getByRole("button", { name: "مشاركة البطاقات" }));
    const publish = await screen.findByRole("button", {
      name: "إنشاء رابط للنسخة المعاينة",
    });
    expect(publish).toBeDisabled();
    expect(container.querySelector("img")).toBeNull();
    await user.click(
      screen.getByRole("checkbox", { name: /راجعت النص كاملًا/ }),
    );
    await user.click(publish);
    const link = await screen.findByLabelText("رابط المشاركة الجديد");
    expect(link).toHaveValue(`${window.location.origin}/share#${token}`);
    const sent = calls.find((c) => c.path === "/v1/decks/d/shares")!;
    expect(JSON.parse(String(sent.init.body))).toEqual({
      title: "مراجعة مشتركة",
      expires_days: 7,
      consent: true,
      preview_hash: "b".repeat(64),
    });
    await user.click(
      await screen.findByRole("button", { name: "إلغاء رابط: مراجعة مشتركة" }),
    );
    expect(calls.some((c) => c.init.method === "DELETE")).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "تأكيد إلغاء الرابط" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.path === "/v1/shares/share-id" && c.init.method === "DELETE",
        ),
      ).toBe(true),
    );
  });
  it("reads cards as a visitor using the capability header, never the login token", async () => {
    window.history.replaceState({}, "", `/share#${token}`);
    sessionStorage.setItem("knowlm-token", "private-session");
    const requests: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: unknown, init: RequestInit) => {
        requests.push(init);
        return response({
          kind: "cards",
          title: "نسخة",
          expires_at: expiry,
          items: [{ front: "سؤال", back: "جواب" }],
        });
      }),
    );
    const user = userEvent.setup();
    render(<SharedLearning />);
    await screen.findByRole("heading", { name: "نسخة" });
    expect(new Headers(requests[0].headers).get("Authorization")).toBeNull();
    expect(new Headers(requests[0].headers).get("X-KnowLM-Share")).toBe(token);
    await user.click(screen.getByRole("button", { name: "إظهار الإجابة" }));
    expect(screen.getByText("جواب")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /المرجع/ }),
    ).not.toBeInTheDocument();
  });
  it("removes the displayed snapshot when a refreshed link is no longer available", async () => {
    window.history.replaceState({}, "", `/share#${token}`);
    let available = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        available
          ? response({
              kind: "cards",
              title: "نسخة قديمة",
              expires_at: expiry,
              items: [{ front: "سؤال", back: "جواب" }],
            })
          : response({ detail: "Shared content is unavailable" }, 404),
      ),
    );
    const user = userEvent.setup();
    render(<SharedLearning />);
    await screen.findByRole("heading", { name: "نسخة قديمة" });
    available = false;
    await user.click(
      screen.getByRole("button", { name: "إعادة التحقق من الرابط" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("غير متاحة");
    expect(
      screen.queryByRole("heading", { name: "نسخة قديمة" }),
    ).not.toBeInTheDocument();
  });
  it("grades a guest quiz without exposing a key before submission or claiming saved results", async () => {
    window.history.replaceState({}, "", `/share#${token}`);
    let submitted: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init: RequestInit) => {
        if (String(input).endsWith("/view"))
          return response({
            kind: "quiz",
            title: "اختبار",
            expires_at: expiry,
            items: [
              { prompt: "سؤال 1", choices: ["أ", "ب"] },
              { prompt: "سؤال 2", choices: ["ج", "د"] },
            ],
          });
        submitted = JSON.parse(String(init.body));
        return response({
          correct: 2,
          total: 2,
          questions: [
            { correct: true, correct_index: 0, explanation: "أ" },
            { correct: true, correct_index: 0, explanation: "ج" },
          ],
        });
      }),
    );
    const user = userEvent.setup();
    render(<SharedLearning />);
    await screen.findByRole("heading", { name: "اختبار" });
    const submit = screen.getByRole("button", {
      name: "تصحيح الاختبار المشترك",
    });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "أ" }));
    await user.click(screen.getByRole("radio", { name: "ج" }));
    await user.click(submit);
    expect(await screen.findByText(/نتيجتك: 2 من 2/)).toHaveTextContent(
      "غير محفوظة",
    );
    expect(submitted).toEqual({ answers: [0, 0] });
  });
});
