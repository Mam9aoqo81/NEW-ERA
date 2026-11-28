import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
afterEach(() => vi.unstubAllGlobals());
function mock(
  detail: string,
  status: number,
  headers: Record<string, string> = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail }), {
          status,
          headers: { "Content-Type": "application/json", ...headers },
        }),
    ),
  );
}
describe("usage-limit messages", () => {
  it("shows the retry delay without expiring a valid session", async () => {
    mock("Request rate limit reached", 429, { "Retry-After": "18" });
    const expired = vi.fn();
    window.addEventListener("knowlm:expired", expired);
    try {
      await expect(
        api("/v1/notebooks", "token", { method: "POST" }),
      ).rejects.toThrow("يمكنك المحاولة بعد 18 ثانية");
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("knowlm:expired", expired);
    }
  });
  it("does not echo malformed retry headers", async () => {
    mock("Request rate limit reached", 429, {
      "Retry-After": "<script>bad</script>",
    });
    await expect(api("/v1/notebooks")).rejects.toThrow("حاول مجددًا بعد قليل");
  });
  it.each([
    ["Notebook quota reached", "للحد الأقصى لعدد الدفاتر"],
    ["Source quota reached", "للحد الأقصى من المصادر"],
    ["Active ingestion quota reached", "مهام المعالجة النشطة"],
    ["Request budget temporarily unavailable", "تعذّر التحقق من حدود الاستخدام"],
  ])("translates %s", async (detail, message) => {
    mock(detail, detail.includes("temporarily") ? 503 : 409);
    await expect(api("/v1/notebooks")).rejects.toThrow(message);
  });
});
