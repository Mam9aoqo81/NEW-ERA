export type Notebook = {
  id: string;
  title: string;
  role?: "owner" | "editor" | "viewer";
};
export type Source = {
  id: string;
  title: string;
  kind: string;
  external_url?: string | null;
  transcript_origin?: string | null;
  ocr_pages?: number[];
  status: string;
  job?: { id: string; attempts: number; error_code: string | null } | null;
};
export type Citation = {
  ocr?: boolean;
  chunk_id: string;
  source_id: string;
  title: string;
  page: number | null;
  quote: string;
  locator_type?: "page" | "timestamp" | "paragraph";
  paragraph?: number | null;
  start_seconds?: number | null;
  end_seconds?: number | null;
  media_url?: string | null;
  transcript_origin?: "youtube_captions" | "user_captions" | null;
  url: string;
};
export type Answer = {
  turn_id?: number;
  mode: "extractive" | "grounded";
  answered: boolean;
  answer: string;
  citations: Citation[];
  notice: string;
};
export type Page = {
  source_id: string;
  page: number | null;
  chunks: { id: string; text: string }[];
};
export type User = { id: string; username: string };

const translations: Record<string, string> = {
  "Notebook is read only":
    "صلاحيتك قارئ؛ تعديل الدفتر متاح للمحرر والمالك فقط.",
  "Invitation unavailable":
    "الدعوة غير متاحة لهذا الحساب، أو استُخدمت أو أُلغيت أو انتهت. تحقق من مساحة الدراسة إذا سبق قبولها.",
  "Explicit collaboration consent is required":
    "راجع حدود مشاركة الدفتر وأكد موافقتك أولًا.",
  "External processing requires notebook owner":
    "إرسال مصادر هذا الدفتر لمزوّد خارجي متاح لمالك الدفتر فقط.",
  "Invitation quota reached":
    "وصل الدفتر إلى حد 20 دعوة معلقة. ألغِ دعوات قديمة أولًا.",
  "Membership quota reached": "وصل الدفتر أو الحساب إلى حد 20 عضوية.",
  "Room message quota reached":
    "وصلت الغرفة إلى حد 1000 رسالة. احذف رسائل قديمة أولًا.",
  "Room message is empty": "اكتب رسالة أو اختر إجابة لنشرها.",
  "Explicit room publishing consent is required":
    "أكد موافقتك على نشر الرسالة والإجابة لأعضاء الدفتر.",
  "Room request ID already used":
    "تغير محتوى طلب النشر. أعد المحاولة بطلب جديد.",
  "Cannot invite notebook owner": "لا يمكن دعوة مالك الدفتر نفسه.",
  "Owner cannot leave notebook":
    "المالك لا يغادر دفتره؛ يمكنه حذفه بعد التأكيد.",

  "Explicit import consent is required":
    "أكد فهمك لطبيعة النسخة وحقك في حفظها أولًا.",
  "Only shared cards can be imported":
    "الحفظ في المكتبة متاح للبطاقات فقط حاليًا.",
  "Import request ID already used":
    "استُخدم طلب الحفظ لنسخة أخرى. أعد فتح الرابط.",
  "Pending report quota reached": "وصلت للحد الأقصى للبلاغات قيد المراجعة.",
  "Select sources explicitly for semantic retrieval":
    "حدد المصادر صراحة قبل استخدام البحث الدلالي.",
  "Semantic retrieval is not configured":
    "البحث الدلالي غير مفعّل. ألغِ اختياره لاستخدام البحث المحلي.",
  "Semantic retrieval unavailable; narrow selected sources or retry later":
    "البحث الدلالي غير متاح. قلّل المصادر المحددة أو أعد المحاولة لاحقًا؛ لم يتم التحويل إلى بحث محلي تلقائيًا.",
  "Shared content is unavailable":
    "النسخة المشتركة غير متاحة: قد يكون الرابط غير صالح أو منتهيًا أو مُلغًى.",
  "Explicit sharing consent is required":
    "راجع النص وأكد موافقتك على المشاركة أولًا.",
  "Content changed since sharing preview":
    "تغير المحتوى منذ المعاينة. حدّث المعاينة وراجعها قبل النشر.",
  "Active share quota reached":
    "لديك 20 رابط مشاركة نشطًا. ألغِ رابطًا قبل إنشاء آخر.",
  "Share requires 1 to 50 cards":
    "المشاركة تحتاج مجموعة بها من بطاقة واحدة إلى 50 بطاقة.",
  "Request rate limit reached": "طلبات كثيرة خلال فترة قصيرة.",
  "Request budget temporarily unavailable":
    "تعذّر التحقق من حدود الاستخدام مؤقتًا. حاول مجددًا بعد قليل.",
  "Notebook quota reached":
    "وصلت للحد الأقصى لعدد الدفاتر في حسابك. احذف دفترًا لم تعد تحتاجه قبل إنشاء آخر.",
  "Source quota reached":
    "وصل هذا الدفتر للحد الأقصى من المصادر. استخدم دفترًا آخر أو احذف الدفتر كاملًا إذا لم تعد تحتاجه.",
  "Active ingestion quota reached":
    "بلغ هذا الدفتر الحد الأقصى لمهام المعالجة النشطة. انتظر اكتمال مهمة قبل إضافة ملف أو إعادة المحاولة.",
  "Password confirmation failed":
    "كلمة المرور غير صحيحة. لم يُحذف الحساب؛ أعد إدخالها للمحاولة.",
  "Deck not found": "مجموعة البطاقات غير متاحة.",
  "Card not found": "البطاقة غير متاحة أو حُذفت.",
  "Quiz not found": "الاختبار غير متاح.",
  "Not enough source text to create deletion cards":
    "لا توجد مقاطع مناسبة كافية في المصادر المحددة. جرّب نصًا أطول أو أنشئ بطاقات يدويًا.",
  "At least two distinct card answers are required":
    "يحتاج الاختبار إلى بطاقتين بإجابتين مختلفتين على الأقل.",
  "Answer every quiz question with a valid choice":
    "أجب عن كل سؤال باختيار صالح قبل حفظ المحاولة.",
  "Card changed; refresh before editing":
    "عُدلت البطاقة في جلسة أخرى. حدّث البطاقات ثم أعد التحرير.",
  "Review changed; reload the cards":
    "تغيّرت حالة المراجعة. حدّث البطاقات قبل تقييمها مجددًا.",
  "Deck card limit reached": "الحد الحالي 200 بطاقة في المجموعة.",
  "No eligible source passages for this output":
    "لا توجد مقاطع مناسبة لهذا المخرج. للتسلسل الزمني يجب وجود سنوات مذكورة صراحةً في النص.",
  "Invalid YouTube video URL":
    "أدخل رابط فيديو YouTube صالحًا، وليس رابط قناة أو قائمة تشغيل.",
  "Expected valid timed SRT or WebVTT captions":
    "النص غير صالح. أضف ترجمة بصيغة SRT أو VTT مع توقيت صحيح لكل مقطع.",
  "Automatic YouTube captions are disabled on this server":
    "الاستيراد التلقائي من YouTube غير متاح على هذا الخادم. يمكنك إرفاق ترجمة موقّتة.",
  "Request ID was already used for a different question":
    "تعارض في معرّف الطلب. اكتب السؤال كطلب جديد.",
  "Invalid credentials": "اسم المستخدم أو كلمة المرور غير صحيحة.",
  "Username unavailable": "اسم المستخدم مستخدم بالفعل. جرّب اسمًا آخر.",
  "Authentication required": "سجّل الدخول للمتابعة.",
  "Invalid or expired session": "انتهت جلستك. سجّل الدخول مجددًا.",
  "PDF limit is 10 MiB": "حجم الملف أكبر من 10 ميجابايت.",
  "Expected a DOCX file": "اختر ملف Word بصيغة DOCX، وليست DOC أو DOCM.",
  "Document limit is 10 MiB": "الحد الأقصى للملف 10 ميجابايت.",
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
        youtube_network_disabled:
          "الاستيراد التلقائي غير مفعّل هنا؛ أضف المصدر مجددًا مع نص SRT أو VTT تملكه.",
        youtube_no_captions:
          "الفيديو لا يوفّر نصًا متاحًا. أضف رابط الفيديو مع ترجمة موقّتة تملك حق استخدامها.",
        youtube_unavailable:
          "الفيديو غير متاح أو خاص أو مقيّد. لا نتجاوز قيود الوصول.",
        youtube_access_blocked:
          "YouTube منع الوصول إلى النص من هذا الخادم. أرفق ترجمة موقّتة أو حاول من بيئة مسموحة.",
        youtube_network_error:
          "تعذّر الاتصال بـYouTube. تحقق من اتصال الخادم أو أرفق نصًا موقّتًا.",
        youtube_timeout: "استغرق جلب النص وقتًا أطول من المسموح. حاول مجددًا.",
        youtube_fetch_failed:
          "تعذّر استخراج نص الفيديو؛ قد تكون خدمة YouTube قد تغيّرت. يمكنك إرفاق ترجمة موقّتة.",
        invalid_timed_captions:
          "توقيت الترجمة غير صالح. استخدم SRT أو VTT صالحًا.",
        captions_too_large:
          "الترجمة تتجاوز الحد المسموح: 500 ألف محرف أو 20 ألف مقطع.",
        ocr_not_configured:
          "محرك OCR يحتاج نماذج العربي والإنجليزي لدى مشغّل الخادم.",
        ocr_unavailable: "مكتبات OCR المحلية غير مثبتة لدى مشغّل الخادم.",
        ocr_page_limit:
          "الحد الأقصى 10 صفحات تحتاج OCR في الملف الواحد. قسّم الملف.",
        ocr_page_too_large: "أبعاد صفحة مصوّرة تتجاوز حد OCR. قلّل حجم الصفحة.",
        ocr_low_confidence:
          "لم يثق OCR في قراءة بعض النص. استخدم نسخة أوضح؛ لم تُنشر قراءة جزئية.",
        ocr_failed: "تعذرت قراءة الملف بمحرك OCR المحلي. جرّب نسخة أوضح.",
        ocr_invalid_document: "تعذر التحقق من ترتيب صفحات الملف أثناء OCR.",
        ocr_required:
          "لم يُعثر على نص قابل للاستخراج؛ قد يحتاج الملف OCR محليًا مفعّلًا أو نسخة أوضح.",
        unreadable_docx: "تعذّر قراءة مستند Word. جرّب نسخة DOCX أخرى.",
        unsupported_docx_type:
          "نوع المستند غير مدعوم. استخدم DOCX عاديًا دون ماكرو.",
        macro_docx_not_supported: "مستندات الماكرو غير مدعومة.",
        unsafe_docx_archive:
          "بنية المستند أو حجمه بعد فك الضغط تتجاوز حدود الأمان.",
        docx_no_text:
          "المستند لا يحتوي نصًا في المتن. الصور تحتاج OCR غير المتاح بعد.",
        docx_text_too_large: "الحد الأقصى 5000 فقرة و500 ألف محرف.",
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
    if (response.status === 429) {
      const wait = Number(response.headers.get("Retry-After"));
      throw new Error(
        (translations[detail] || "تم تجاوز حد الطلبات.") +
          (Number.isFinite(wait) && wait > 0 && wait <= 3600
            ? ` يمكنك المحاولة بعد ${Math.ceil(wait)} ثانية.`
            : " حاول مجددًا بعد قليل."),
      );
    }
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
