export type Notebook = { id: string; title: string };
export type Source = {
  id: string;
  title: string;
  kind: string;
  status: string;
  job?: { id: string; attempts: number; error_code: string | null } | null;
};
export type Citation = {
  chunk_id: string;
  source_id: string;
  title: string;
  page: number;
  quote: string;
  url: string;
};
export type Answer = {
  mode: "extractive" | "grounded";
  answered: boolean;
  answer: string;
  citations: Citation[];
  notice: string;
};
export type Page = {
  source_id: string;
  page: number;
  chunks: { id: string; text: string }[];
};
export type User = { id: string; username: string };

const translations: Record<string, string> = {
  "Invalid credentials": "اسم المستخدم أو كلمة المرور غير صحيحة.",
  "Username unavailable": "اسم المستخدم مستخدم بالفعل. جرّب اسمًا آخر.",
  "Authentication required": "سجّل الدخول للمتابعة.",
  "Invalid or expired session": "انتهت جلستك. سجّل الدخول مجددًا.",
  "PDF limit is 10 MiB": "حجم الملف أكبر من 10 ميجابايت.",
  "Expected a PDF file": "اختر ملف PDF صالحًا.",
  "Notebook not found": "الدفتر غير موجود أو لا تملك صلاحية الوصول إليه.",
  "Source not found": "المصدر غير متاح.",
  "Generated mode is not configured; use extractive mode":
    "التوليد غير مفعّل على الخادم. استخدم البحث المحلي.",
  "Generation provider unavailable":
    "خدمة التوليد غير متاحة الآن. جرّب البحث المحلي.",
  "Generated answer rejected: invalid citation or structure":
    "لم تجتز الإجابة فحص الاستشهادات؛ لم يتم عرضها.",
  "Only failed jobs with fewer than 3 attempts may be retried":
    "لا يمكن إعادة هذه المهمة؛ الحد الأقصى ثلاث محاولات.",
};
export function jobError(code: string | null | undefined) {
  return (
    (
      {
        ocr_required: "الملف مصوّر ويحتاج OCR، وهو غير مدعوم بعد.",
        unreadable_pdf: "تعذّر قراءة الملف. جرّب نسخة PDF أخرى.",
        encrypted_pdf: "الملف محمي بكلمة مرور.",
        extraction_timeout: "تجاوز استخراج النص الوقت المسموح.",
        too_many_pages: "الحد الأقصى 200 صفحة.",
        text_too_large: "النص المستخرج يتجاوز الحد المسموح.",
        worker_lease_expired: "توقّف عامل المعالجة. يمكنك إعادة المحاولة.",
      } as Record<string, string>
    )[code || ""] || "تعذّرت المعالجة. جرّب ملفًا آخر أو أعد المحاولة."
  );
}
export async function api<T>(
  path: string,
  token?: string | null,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/v1/") && path !== "/health")
    throw new Error("مسار طلب غير مسموح.");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error("تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مجددًا.");
  }
  if (!response.ok) {
    if (response.status === 401 && token)
      window.dispatchEvent(new Event("knowlm:expired"));
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : "";
    throw new Error(
      translations[detail] ||
        (response.status === 422
          ? "راجع المدخلات؛ يوجد حقل غير صالح."
          : "تعذّر إكمال الطلب. حاول مجددًا."),
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const json = (value: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(value),
});
