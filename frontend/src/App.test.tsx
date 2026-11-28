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
  history = [],
  semantic = false,
  ocr = false,
  deleteFails = false,
  deleteResponseLost = false,
}: {
  semantic?: boolean;
  ocr?: boolean;
  deleteFails?: boolean;
  deleteResponseLost?: boolean;
  history?: unknown[];
  sources?: unknown[];
  notebooks?: (typeof nb)[];
  expired?: boolean;
} = {}) {
  const calls: { path: string; init: RequestInit }[] = [];
  const mock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      calls.push({ path, init });
      if (path === "/health")
        return respond({
          llm_configured: false,
          semantic_configured: semantic,
        });
      if (path === "/v1/auth/me")
        return expired
          ? respond({ detail: "Invalid or expired session" }, 401)
          : respond({ id: "user-1", username: "student" });
      if (path === "/v1/auth/login")
        return respond({ access_token: "test-session" });
      if (path === "/v1/auth/register")
        return respond({ id: "user-1", username: "student" }, 201);
      if (path === "/v1/auth/logout") return respond(null, 204);
      if (path === "/v1/auth/delete-account") {
        return JSON.parse(String(init.body)).password === "correct-password-123"
          ? respond(null, 204)
          : respond({ detail: "Password confirmation failed" }, 403);
      }
      if (path === "/v1/notebooks/notebook-1" && init.method === "DELETE") {
        if (deleteFails) return respond({ detail: "Deletion failed" }, 503);
        if (deleteResponseLost) {
          notebooks.splice(0);
          throw new TypeError("Network lost after commit");
        }
        return respond(null, 204);
      }
      if (path === "/v1/notebooks" && init.method === "POST")
        return respond(
          { id: "created-1", title: JSON.parse(String(init.body)).title },
          201,
        );
      if (path === "/v1/notebooks") return respond(notebooks);
      if (path.includes("/history")) {
        if (init.method === "DELETE") {
          history.splice(0);
          return respond(null, 204);
        }
        return respond({ turns: history, next_before: null });
      }
      if (path.endsWith("/sources/text")) {
        sources.push(source);
        return respond(source, 201);
      }
      if (
        path.endsWith("/sources/pdf-jobs") ||
        path.endsWith("/sources/docx-jobs") ||
        path.endsWith("/sources/youtube-jobs")
      )
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
              ocr,
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
  it("requires separate semantic consent and resets it when selected sources change", async () => {
    signedIn();
    const { calls } = mockApi({ semantic: true });
    const user = userEvent.setup();
    render(<App />);
    const consent = await screen.findByRole("checkbox", {
      name: /أوافق على إرسال السؤال وكل مقاطع/,
    });
    expect(consent).not.toBeChecked();
    await user.click(consent);
    await user.type(
      screen.getByRole("textbox", { name: "سؤالك عن المصادر" }),
      "البناء الضوئي",
    );
    await user.click(screen.getByRole("button", { name: "إرسال السؤال" }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/ask"))).toBe(true),
    );
    expect(
      JSON.parse(String(calls.find((c) => c.path.endsWith("/ask"))!.init.body))
        .semantic_consent,
    ).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /محاضرة النباتات/ }));
    expect(consent).not.toBeChecked();
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
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
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
  it("marks OCR sources and warns before relying on a recognized page", async () => {
    signedIn();
    mockApi({
      ocr: true,
      sources: [{ ...source, kind: "pdf", ocr_pages: [1] }],
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/OCR محلي · صفحات 1/)).toBeVisible();
    const input = await screen.findByRole("textbox", {
      name: "سؤالك عن المصادر",
    });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "البناء الضوئي");
    await user.click(screen.getByRole("button", { name: "إرسال السؤال" }));
    await user.click(
      await screen.findByRole("button", { name: /محاضرة النباتات.*ص 1/ }),
    );
    expect(
      await screen.findByText(/هذا النص قُرئ آليًا من صورة بواسطة OCR/),
    ).toBeVisible();
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
  it("requires the notebook title before deleting and clears the deleted workspace", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /^حذف الدفتر$/ }),
    );
    const confirm = screen.getByRole("button", { name: "حذف الدفتر نهائيًا" });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByLabelText("اسم الدفتر لتأكيد الحذف"),
      "اسم خطأ",
    );
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText("اسم الدفتر لتأكيد الحذف"));
    await user.type(screen.getByLabelText("اسم الدفتر لتأكيد الحذف"), nb.title);
    await user.click(confirm);
    await screen.findByRole("button", { name: "إنشاء أول دفتر" });
    expect(
      calls.filter(
        (c) =>
          c.path === `/v1/notebooks/${nb.id}` && c.init.method === "DELETE",
      ),
    ).toHaveLength(1);
  });
  it("cancels deletion without a request and keeps the notebook after a server failure", async () => {
    signedIn();
    const { calls } = mockApi({ deleteFails: true });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /^حذف الدفتر$/ }),
    );
    await user.click(screen.getByRole("button", { name: "إلغاء الحذف" }));
    expect(calls.some((c) => c.init.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: /^حذف الدفتر$/ }));
    await user.type(screen.getByLabelText("اسم الدفتر لتأكيد الحذف"), nb.title);
    await user.click(screen.getByRole("button", { name: "حذف الدفتر نهائيًا" }));
    await screen.findByRole("alert");
    expect(
      screen.getByRole("heading", { level: 1, name: nb.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "حذف الدفتر نهائيًا" }),
    ).toBeEnabled();
  });
  it("reconciles a deletion whose response was lost after the server committed", async () => {
    signedIn();
    mockApi({ deleteResponseLost: true });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /^حذف الدفتر$/ }),
    );
    await user.type(screen.getByLabelText("اسم الدفتر لتأكيد الحذف"), nb.title);
    await user.click(screen.getByRole("button", { name: "حذف الدفتر نهائيًا" }));
    await screen.findByRole("button", { name: "إنشاء أول دفتر" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("reauthenticates before account deletion, clears failed passwords and then signs out", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /^حذف الحساب$/ }),
    );
    const confirm = screen.getByRole("button", {
      name: "حذف حسابي وكل دفاتري",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByLabelText("اسم المستخدم لتأكيد حذف الحساب"),
      "student",
    );
    await user.type(
      screen.getByLabelText("كلمة المرور الحالية"),
      "wrong-password",
    );
    await user.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "كلمة المرور غير صحيحة",
    );
    expect(screen.getByLabelText("كلمة المرور الحالية")).toHaveValue("");
    expect(sessionStorage.getItem("knowlm-token")).toBeTruthy();
    await user.type(
      screen.getByLabelText("كلمة المرور الحالية"),
      "correct-password-123",
    );
    await user.click(confirm);
    await screen.findByRole("button", { name: "حساب جديد" });
    expect(sessionStorage.getItem("knowlm-token")).toBeNull();
    expect(
      calls.filter((c) => c.path === "/v1/auth/delete-account"),
    ).toHaveLength(2);
  });
  it("can cancel account deletion without sending a destructive request", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /^حذف الحساب$/ }),
    );
    await user.click(screen.getByRole("button", { name: "إلغاء حذف الحساب" }));
    expect(calls.some((c) => c.path === "/v1/auth/delete-account")).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("knowlm-token")).toBeTruthy();
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
  it("uploads Word with a paragraph-locator warning to its own job endpoint", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "إضافة مصدر" }));
    await user.click(screen.getByRole("button", { name: /^Word$/ }));
    expect(
      screen.getByText(/رقم فقرة مستخرجة، وليس صفحة Word الأصلية/),
    ).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText("ملف Word"),
      new File(["PK"], "study.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    fireEvent.submit(screen.getByLabelText("ملف Word").closest("form")!);
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/docx-jobs"))).toBe(true),
    );
    expect(
      calls.find((c) => c.path.endsWith("/docx-jobs"))!.init.body,
    ).toBeInstanceOf(FormData);
    expect(calls.some((c) => c.path.endsWith("/pdf-jobs"))).toBe(false);
  });
  it("submits a YouTube URL with an explicitly supplied timed caption", async () => {
    signedIn();
    const { calls } = mockApi();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await user.click(await screen.findByRole("button", { name: "إضافة مصدر" }));
    await user.click(screen.getByRole("button", { name: "YouTube" }));
    await user.type(
      screen.getByLabelText("رابط فيديو YouTube"),
      "https://youtu.be/aB3dE5gH7jK",
    );
    await user.click(
      screen.getByRole("checkbox", { name: "لدي ترجمة موقّتة SRT أو VTT" }),
    );
    const captions =
      "WEBVTT\n\n00:00:15.000 --> 00:00:22.000\nنص الفيديو الخاص بي.";
    fireEvent.change(screen.getByLabelText("نص الترجمة الموقّت"), {
      target: { value: captions },
    });
    await user.click(screen.getByRole("button", { name: "إضافة إلى مصادري" }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/youtube-jobs"))).toBe(true),
    );
    const request = calls.find((c) => c.path.endsWith("/youtube-jobs"))!;
    expect(JSON.parse(String(request.init.body))).toEqual({
      url: "https://youtu.be/aB3dE5gH7jK",
      captions,
    });
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
