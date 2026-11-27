import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const nb = { id: "notebook-1", title: "دفتر الأحياء" };
const source = {
  id: "source-1",
  title: "محاضرة النباتات",
  kind: "text",
  status: "ready",
};
function respond(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function mockApi({
  sources = [source],
  notebooks = [nb],
  expired = false,
}: { sources?: unknown[]; notebooks?: (typeof nb)[]; expired?: boolean } = {}) {
  const calls: { path: string; init: RequestInit }[] = [];
  const mock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      calls.push({ path, init });
      if (path === "/health") return respond({ llm_configured: false });
      if (path === "/v1/auth/me")
        return expired
          ? respond({ detail: "Invalid or expired session" }, 401)
          : respond({ id: "user-1", username: "student" });
      if (path === "/v1/auth/login")
        return respond({ access_token: "test-session" });
      if (path === "/v1/auth/register")
        return respond({ id: "user-1", username: "student" }, 201);
      if (path === "/v1/auth/logout") return respond(null, 204);
      if (path === "/v1/notebooks" && init.method === "POST")
        return respond(
          { id: "created-1", title: JSON.parse(String(init.body)).title },
          201,
        );
      if (path === "/v1/notebooks") return respond(notebooks);
      if (path.endsWith("/sources/text")) {
        sources.push(source);
        return respond(source, 201);
      }
      if (path.endsWith("/sources/pdf-jobs"))
        return respond(
          { id: "job-1", source_id: "pdf-1", status: "pending" },
          202,
        );
      if (path.endsWith("/sources")) return respond(sources);
      if (path.endsWith("/pages/1"))
        return respond({
          source_id: source.id,
          page: 1,
          chunks: [
            {
              id: "chunk-1",
              text: "تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء.",
            },
          ],
        });
      if (path.endsWith("/ask"))
        return respond({
          mode: "extractive",
          answered: true,
          answer: "تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء. [1]",
          notice: "مقتطفات بحث نصي.",
          citations: [
            {
              chunk_id: "chunk-1",
              source_id: source.id,
              title: source.title,
              page: 1,
              quote: "البناء الضوئي داخل البلاستيدات",
              url: "/v1/notebooks/notebook-1/sources/source-1/pages/1",
            },
          ],
        });
      throw new Error(`Unhandled ${path}`);
    },
  );
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
function signedIn() {
  sessionStorage.setItem("knowlm-token", "test-session");
}

describe("KnowLM study flow", () => {
  it("shows Arabic login without creating a demo account", async () => {
    const { calls } = mockApi();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "كل مصادرك",
    );
    expect(screen.getByLabelText("اسم المستخدم")).toBeRequired();
    await waitFor(() =>
      expect(calls.some((c) => c.path === "/health")).toBe(true),
    );
    expect(calls.some((c) => c.path.includes("/auth/"))).toBe(false);
  });
  it("registers, logs in and loads private notebooks", async () => {
    mockApi();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: "حساب جديد" }));
    await user.type(screen.getByLabelText("اسم المستخدم"), "student");
    await user.type(
      screen.getByLabelText("كلمة المرور"),
      "secure-password-123",
    );
    await user.click(screen.getByRole("button", { name: "أنشئ مساحة تعلّمك" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: nb.title }),
    ).toBeVisible();
    expect(sessionStorage.getItem("knowlm-token")).toBe("test-session");
  });
  it("creates the first notebook rather than showing fabricated content", async () => {
    signedIn();
    const { calls } = mockApi({ notebooks: [], sources: [] });
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await user.click(
      await screen.findByRole("button", { name: "إنشاء أول دفتر" }),
    );
    await user.type(screen.getByLabelText("اسم الدفتر"), "دفتر الفيزياء");
    await user.click(screen.getByRole("button", { name: "إنشاء الدفتر" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "دفتر الفيزياء" }),
    ).toBeVisible();
    expect(
      calls.some((c) => c.path === "/v1/notebooks" && c.init.method === "POST"),
    ).toBe(true);
  });
  it("sends only selected sources and opens authenticated citations", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const input = await screen.findByRole("textbox", {
      name: "سؤالك عن المصادر",
    });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "البناء الضوئي");
    await user.click(screen.getByRole("button", { name: "إرسال السؤال" }));
    const cite = await screen.findByRole("button", {
      name: /محاضرة النباتات.*ص 1/,
    });
    const request = calls.find((c) => c.path.endsWith("/ask"))!;
    expect(JSON.parse(String(request.init.body))).toEqual({
      question: "البناء الضوئي",
      source_ids: ["source-1"],
      mode: "extractive",
    });
    await user.click(cite);
    expect(
      await screen.findByRole("heading", { name: "العودة إلى المصدر" }),
    ).toBeVisible();
    expect(await screen.findByText("الصفحة 1 · نص مستخرج")).toBeVisible();
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/pages/1"))).toBe(true),
    );
    const page = calls.find((c) => c.path.endsWith("/pages/1"))!;
    expect(new Headers(page.init.headers).get("Authorization")).toBe(
      "Bearer test-session",
    );
    expect(screen.getByText("إجابة مولّدة · غير مفعّلة")).toBeDisabled();
  });
  it("disables questions when all sources are deselected", async () => {
    signedIn();
    mockApi();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const all = await screen.findByRole("checkbox", {
      name: /تحديد كل المصادر/,
    });
    await user.click(all);
    expect(
      screen.getByRole("textbox", { name: "سؤالك عن المصادر" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "إرسال السؤال" })).toBeDisabled();
  });
  it("uploads a PDF through the background-job endpoint", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await user.click(await screen.findByRole("button", { name: "إضافة مصدر" }));
    const file = new File(["%PDF-example"], "biology.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText("ملف PDF"), file);
    // jsdom does not implement file-input constraint validation for synthetic FileLists.
    fireEvent.submit(screen.getByLabelText("ملف PDF").closest("form")!);
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/pdf-jobs"))).toBe(true),
    );
    expect(
      calls.find((c) => c.path.endsWith("/pdf-jobs"))!.init.body,
    ).toBeInstanceOf(FormData);
  });
  it("validates oversized files before uploading", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await user.click(await screen.findByRole("button", { name: "إضافة مصدر" }));
    const file = new File(["%PDF"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 11 * 1024 * 1024 });
    await user.upload(screen.getByLabelText("ملف PDF"), file);
    // jsdom does not implement file-input constraint validation for synthetic FileLists.
    fireEvent.submit(screen.getByLabelText("ملف PDF").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("10 ميجابايت");
    expect(calls.some((c) => c.path.endsWith("/pdf-jobs"))).toBe(false);
  });
  it("clears an expired session and returns to authentication", async () => {
    signedIn();
    mockApi({ expired: true });
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(
      await screen.findByRole("button", { name: "ادخل إلى مساحتك" }),
    ).toBeVisible();
    expect(sessionStorage.getItem("knowlm-token")).toBeNull();
  });
  it("toggles focus mode and revokes the session on logout", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const focus = await screen.findByRole("button", { name: "وضع التركيز" });
    await user.click(focus);
    expect(focus).toHaveAttribute("aria-pressed", "true");
    await user.click(focus);
    await user.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
    expect(
      await screen.findByRole("button", { name: "ادخل إلى مساحتك" }),
    ).toBeVisible();
    expect(calls.some((c) => c.path === "/v1/auth/logout")).toBe(true);
    expect(sessionStorage.getItem("knowlm-token")).toBeNull();
  });
});
