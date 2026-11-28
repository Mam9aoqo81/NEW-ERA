import { test, expect } from "@playwright/test";
import path from "node:path";

test("real account → notebook → source → cited question → PDF job", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "كل مصادرك",
  );
  await page.screenshot({
    path: `../backend/data/auth-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "حساب جديد" }).click();
  const username = `e2e_${info.project.name}_${Date.now()}`;
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill("development-test-password");
  await page.getByRole("button", { name: "أنشئ مساحة تعلّمك" }).click();
  await page.getByRole("button", { name: "إنشاء أول دفتر" }).click();
  await page.getByLabel("اسم الدفتر").fill("رحلة إلى عالم الأحياء");
  await page.getByRole("button", { name: "إنشاء الدفتر", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "رحلة إلى عالم الأحياء" }),
  ).toBeVisible();
  const sourcesTab = page.getByRole("button", { name: /^المصادر/ });
  if (info.project.name === "mobile") await sourcesTab.click();
  await page.getByRole("button", { name: "جرّب بمصدر تعليمي جاهز" }).click();
  await expect(
    page.getByRole("checkbox", { name: /البناء الضوئي · مصدر تجريبي/ }),
  ).toBeChecked();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "اسأل وافهم", exact: true }).click();
  await page
    .getByRole("textbox", { name: "سؤالك عن المصادر" })
    .fill("ما هي عملية البناء الضوئي؟");
  await page.getByRole("button", { name: "إرسال السؤال" }).click();
  const citation = page.getByRole("button", {
    name: /1.*البناء الضوئي · مصدر تجريبي.*ص 1/,
  });
  await citation.click();
  await expect(
    page.getByRole("heading", { name: "العودة إلى المصدر" }),
  ).toBeVisible();
  await expect(page.locator(".page-text .highlighted")).toContainText(
    "البلاستيدات الخضراء",
  );
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.screenshot({
    path: `../backend/data/study-${info.project.name}.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "رحلة إلى عالم الأحياء" }),
  ).toBeVisible();
  await expect(page.locator(".turn")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /1.*البناء الضوئي · مصدر تجريبي.*ص 1/ }),
  ).toBeVisible();
  // Switching to another notebook must not mix histories.
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "فتح القائمة", exact: true })
      .click();
  await page.getByRole("button", { name: "دفتر جديد", exact: true }).click();
  await page.getByLabel("اسم الدفتر").fill("دفتر منفصل");
  await page.getByRole("button", { name: "إنشاء الدفتر", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "دفتر منفصل" }),
  ).toBeVisible();
  await expect(page.locator(".turn")).toHaveCount(0);
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "فتح القائمة", exact: true })
      .click();
  await page
    .locator(".notebook-nav")
    .filter({ hasText: "رحلة إلى عالم الأحياء" })
    .click();
  await expect(page.locator(".turn")).toHaveCount(1);
  await page.getByRole("button", { name: "إضافة مصدر", exact: true }).click();
  await page
    .getByLabel("ملف PDF")
    .setInputFiles(path.resolve("e2e/fixtures/biology.pdf"));
  await page.getByRole("button", { name: "إضافة إلى مصادري" }).click();
  if (info.project.name === "mobile") await sourcesTab.click();
  const pdf = page.getByRole("checkbox", { name: /biology.pdf/ });
  await expect(pdf).toBeEnabled({ timeout: 20000 });
  await expect(pdf).toBeChecked();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "اسأل وافهم", exact: true }).click();
  await page
    .getByRole("textbox", { name: "سؤالك عن المصادر" })
    .fill("Photosynthesis sunlight");
  await page.getByRole("button", { name: "إرسال السؤال" }).click();
  await expect(
    page.getByRole("button", { name: /biology.pdf.*ص 1/ }),
  ).toBeVisible();
  // Clear is explicit, irreversible, and does not remove the underlying sources.
  await page.getByRole("button", { name: "مسح المحادثة", exact: true }).click();
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();
  await expect(page.locator(".turn")).toHaveCount(2);
  await page.getByRole("button", { name: "مسح المحادثة", exact: true }).click();
  await page
    .getByRole("button", { name: "مسح السجل نهائيًا", exact: true })
    .click();
  await expect(page.locator(".turn")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "رحلة إلى عالم الأحياء" }),
  ).toBeVisible();
  await expect(page.locator(".turn")).toHaveCount(0);
  if (info.project.name === "mobile") await sourcesTab.click();
  await expect(
    page.getByRole("checkbox", { name: /biology.pdf/ }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("YouTube link + user-owned timed captions → timestamp citation → history", async ({
  page,
}) => {
  await page.goto("/");
  const username = `yt_${Date.now()}`;
  const credentials = { username, password: "development-test-password" };
  expect(
    (
      await page.request.post("/v1/auth/register", { data: credentials })
    ).status(),
  ).toBe(201);
  const { access_token } = await (
    await page.request.post("/v1/auth/login", { data: credentials })
  ).json();
  const notebook = await (
    await page.request.post("/v1/notebooks", {
      headers: { Authorization: `Bearer ${access_token}` },
      data: { title: "دراسة فيديو YouTube" },
    })
  ).json();
  await page.evaluate(
    (token) => sessionStorage.setItem("knowlm-token", token),
    access_token,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: notebook.title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "إضافة مصدر", exact: true }).click();
  await page.getByRole("button", { name: "YouTube", exact: true }).click();
  await page
    .getByLabel("رابط فيديو YouTube")
    .fill("https://youtu.be/aB3dE5gH7jK?si=ignored");
  await page.getByLabel("عنوان الفيديو (اختياري)").fill("مقطع تعليمي اختباري");
  const manual = page.getByRole("checkbox", {
    name: "لدي ترجمة موقّتة SRT أو VTT",
  });
  if (!(await manual.isChecked())) await manual.check();
  const captions =
    "WEBVTT\n\n00:00:15.000 --> 00:00:29.000\nيساعد الانقسام المتساوي في نمو الأنسجة وتعويض الخلايا التالفة.\n";
  await page.getByLabel("استيراد ملف ترجمة (اختياري)").setInputFiles({
    name: "my-captions.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(captions),
  });
  await expect(page.getByLabel("نص الترجمة الموقّت")).toHaveValue(captions);
  await page.getByRole("button", { name: "إضافة إلى مصادري" }).click();
  const mobile = page.viewportSize()!.width < 650;
  if (mobile) await page.getByRole("button", { name: /^المصادر/ }).click();
  await expect(
    page.getByRole("checkbox", { name: /مقطع تعليمي اختباري/ }),
  ).toBeEnabled({ timeout: 20000 });
  await expect(
    page.getByText("نص مرفق يدويًا · غير مطابق آليًا للفيديو"),
  ).toBeVisible();
  if (mobile)
    await page.getByRole("button", { name: "اسأل وافهم", exact: true }).click();
  await page
    .getByRole("textbox", { name: "سؤالك عن المصادر" })
    .fill("الانقسام المتساوي");
  await page.getByRole("button", { name: "إرسال السؤال" }).click();
  const reference = page.getByRole("button", {
    name: /مقطع تعليمي اختباري.*0:15/,
  });
  await reference.click();
  await expect(
    page.getByRole("link", { name: "فتح الفيديو عند هذا التوقيت" }),
  ).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=aB3dE5gH7jK&t=15s",
  );
  await expect(
    page.getByText("هذا النص مرفق يدويًا، ولم يُتحقق من مطابقته للفيديو."),
  ).toBeVisible();
  await expect(page.locator(".page-text .highlighted")).toContainText(
    "تعويض الخلايا التالفة",
  );
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /مقطع تعليمي اختباري.*0:15/ }),
  ).toBeVisible();
});

test("source-linked cards, review schedule, saved quiz and study output", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "حساب جديد" }).click();
  await page
    .getByLabel("اسم المستخدم")
    .fill(`learn_${info.project.name}_${Date.now()}`);
  await page.getByLabel("كلمة المرور").fill("development-test-password");
  await page.getByRole("button", { name: "أنشئ مساحة تعلّمك" }).click();
  await page.getByRole("button", { name: "إنشاء أول دفتر" }).click();
  await page.getByLabel("اسم الدفتر").fill("مراجعة العلوم");
  await page.getByRole("button", { name: "إنشاء الدفتر", exact: true }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /^المصادر/ }).click();
  await page.getByRole("button", { name: "جرّب بمصدر تعليمي جاهز" }).click();
  await expect(
    page.getByRole("checkbox", { name: /البناء الضوئي · مصدر تجريبي/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "أدوات المراجعة" }).click();
  await page.getByRole("button", { name: "إنشاء بطاقات من المصادر" }).click();
  await expect(
    page.getByRole("button", { name: "إظهار الإجابة" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "إظهار الإجابة" }).click();
  await page.getByRole("button", { name: "جيد", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("تم الحفظ");
  await page
    .getByRole("button", { name: "اختبار تفاعلي", exact: true })
    .click();
  await page.getByRole("button", { name: "إنشاء اختبار من البطاقات" }).click();
  await expect(page.locator(".quiz-question").first()).toBeVisible();
  for (const question of await page.locator(".quiz-question").all())
    await question.getByRole("radio").first().check();
  await page.getByRole("button", { name: "تصحيح وحفظ النتيجة" }).click();
  await expect(page.locator(".quiz-score")).toContainText("النتيجة محفوظة");
  const unintendedSubmissions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/quizzes\/[^/]+\/attempts$/.test(request.url())
    )
      unintendedSubmissions.push(request.url());
  });
  await page
    .locator(".quiz-explanation")
    .first()
    .getByRole("button", { name: /المرجع/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "العودة إلى المصدر" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page
    .getByRole("button", { name: "مخرجات الدراسة", exact: true })
    .click();
  await page
    .getByRole("button", { name: "إنشاء وحفظ من المصادر المحددة" })
    .click();
  await expect(
    page.locator(".artifact-blocks blockquote").first(),
  ).toBeVisible();
  await page.getByLabel("نوع المخرج").selectOption("mindmap");
  await page
    .getByRole("button", { name: "إنشاء وحفظ من المصادر المحددة" })
    .click();
  await expect(page.locator(".map-node").first()).toBeVisible();
  await page.getByRole("button", { name: "طي الكل", exact: true }).click();
  await expect(page.locator(".map-node").first()).not.toBeVisible();
  await page.getByRole("button", { name: "توسيع الكل", exact: true }).click();
  await page.locator(".map-node").first().click();
  await page.getByRole("button", { name: /فتح مرجع المقطع/ }).click();
  await expect(
    page.getByRole("heading", { name: "العودة إلى المصدر" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `../backend/data/mindmap-${info.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "أدوات المراجعة" }).click();
  await page
    .getByRole("button", { name: "مخرجات الدراسة", exact: true })
    .click();
  await expect(page.locator(".map-node").first()).toBeVisible();
  await page
    .getByRole("button", { name: "البطاقات والاختبارات", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "إظهار الإجابة" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "اختبار تفاعلي", exact: true })
    .click();
  await page.getByLabel("اختبار محفوظ").selectOption({ index: 1 });
  await page.getByRole("button", { name: "عرض آخر نتيجة محفوظة" }).click();
  await expect(page.locator(".quiz-score")).toBeVisible();
  expect(unintendedSubmissions).toEqual([]);
});

test("Word upload → private paragraph reference → persisted answer", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "حساب جديد" }).click();
  await page
    .getByLabel("اسم المستخدم")
    .fill(`word_${info.project.name}_${Date.now()}`);
  await page.getByLabel("كلمة المرور").fill("development-test-password");
  await page.getByRole("button", { name: "أنشئ مساحة تعلّمك" }).click();
  await page.getByRole("button", { name: "إنشاء أول دفتر" }).click();
  await page.getByLabel("اسم الدفتر").fill("دراسة مستند Word");
  await page.getByRole("button", { name: "إنشاء الدفتر", exact: true }).click();
  await page.getByRole("button", { name: "إضافة مصدر", exact: true }).click();
  await page.getByRole("button", { name: "Word", exact: true }).click();
  await page
    .getByLabel("ملف Word")
    .setInputFiles(path.resolve("e2e/fixtures/biology.docx"));
  await page.getByRole("button", { name: "إضافة إلى مصادري" }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /^المصادر/ }).click();
  const source = page.getByRole("checkbox", { name: /biology.docx/ });
  await expect(source).toBeEnabled({ timeout: 20000 });
  await expect(source).toBeChecked();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "اسأل وافهم", exact: true }).click();
  await page
    .getByRole("textbox", { name: "سؤالك عن المصادر" })
    .fill("أين تحدث عملية البناء الضوئي؟");
  await page.getByRole("button", { name: "إرسال السؤال" }).click();
  await page.getByRole("button", { name: /biology.docx.*فقرة 2/ }).click();
  await expect(page.getByText("الفقرة 2 · نص Word مستخرج")).toBeVisible();
  await expect(page.locator(".page-text .highlighted")).toContainText(
    "البلاستيدات الخضراء",
  );
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /biology.docx.*فقرة 2/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "حذف الدفتر", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "حذف الدفتر نهائيًا", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "إلغاء الحذف" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "دراسة مستند Word" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "حذف الدفتر", exact: true }).click();
  await page.getByLabel("اسم الدفتر لتأكيد الحذف").fill("دراسة مستند Word");
  await page
    .getByRole("button", { name: "حذف الدفتر نهائيًا", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "إنشاء أول دفتر" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "إنشاء أول دفتر" }),
  ).toBeVisible({ timeout: 20000 });
});

test("password-confirmed account deletion revokes all sessions", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "حساب جديد" }).click();
  const username = `erase_${info.project.name}_${Date.now()}`;
  const password = "development-test-password";
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "أنشئ مساحة تعلّمك" }).click();
  await page.getByRole("button", { name: "إنشاء أول دفتر" }).click();
  await page.getByLabel("اسم الدفتر").fill("دفتر سيُحذف مع الحساب");
  await page.getByRole("button", { name: "إنشاء الدفتر", exact: true }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /^المصادر/ }).click();
  await page.getByRole("button", { name: "جرّب بمصدر تعليمي جاهز" }).click();
  await expect(
    page.getByRole("checkbox", { name: /البناء الضوئي/ }),
  ).toBeChecked();
  const secondSession = await page.request.post("/v1/auth/login", {
    data: { username, password },
  });
  expect(secondSession.status()).toBe(200);
  const token = (await secondSession.json()).access_token;
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "فتح القائمة", exact: true })
      .click();
  await page.getByRole("button", { name: "حذف الحساب", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "حذف حسابي وكل دفاتري" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "إلغاء حذف الحساب" }).click();
  await page.getByRole("button", { name: "حذف الحساب", exact: true }).click();
  await page.getByLabel("اسم المستخدم لتأكيد حذف الحساب").fill(username);
  await page.getByLabel("كلمة المرور الحالية").fill("wrong-password");
  await page.getByRole("button", { name: "حذف حسابي وكل دفاتري" }).click();
  await expect(page.getByRole("alert")).toContainText("كلمة المرور غير صحيحة");
  await expect(page.getByLabel("كلمة المرور الحالية")).toHaveValue("");
  await page.getByLabel("كلمة المرور الحالية").fill(password);
  await page.getByRole("button", { name: "حذف حسابي وكل دفاتري" }).click();
  await expect(page.getByRole("button", { name: "حساب جديد" })).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("knowlm-token")),
  ).toBeNull();
  const stale = await page.request.get("/v1/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(stale.status()).toBe(401);
  expect(
    (
      await page.request.post("/v1/auth/login", {
        data: { username, password },
      })
    ).status(),
  ).toBe(401);
  await page.reload();
  await expect(page.getByRole("button", { name: "حساب جديد" })).toBeVisible({
    timeout: 20000,
  });
});

test("real per-user question budget displays an Arabic retry message", async ({
  page,
}, info) => {
  const username = `budget_${info.project.name}_${Date.now()}`,
    password = "development-test-password";
  const registered = await page.request.post("/v1/auth/register", {
    data: { username, password },
  });
  expect(registered.status()).toBe(201);
  const login = await page.request.post("/v1/auth/login", {
    data: { username, password },
  });
  const token = (await login.json()).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const notebook = await page.request.post("/v1/notebooks", {
    headers,
    data: { title: "اختبار حد الأسئلة" },
  });
  const nid = (await notebook.json()).id;
  // This suite uses the documented default of 30 questions per fixed minute.
  // Freeze no server clocks: if a minute boundary intervenes, refill its budget.
  let blocked: {
    status: number;
    body: string;
    headers: Record<string, string>;
  } | null = null;
  for (let i = 0; i < 65; i++) {
    const response = await page.request.post(`/v1/notebooks/${nid}/ask`, {
      headers,
      data: { question: "سؤال عن مصدر غير موجود" },
    });
    if (response.status() === 429) {
      blocked = {
        status: 429,
        body: await response.text(),
        headers: {
          "Content-Type": "application/json",
          "Retry-After": response.headers()["retry-after"],
        },
      };
      break;
    }
    expect(response.status()).toBe(200);
  }
  expect(blocked).not.toBeNull();
  // Replay the actual API rejection only for the UI submission so a minute
  // rollover during page load cannot make this assertion timing-dependent.
  await page.route(`**/v1/notebooks/${nid}/ask`, (route) =>
    route.fulfill(blocked!),
  );
  await page.addInitScript(
    (t) => sessionStorage.setItem("knowlm-token", t),
    token,
  );
  // Add a source before opening the UI: empty-source notebooks correctly
  // disable the question composer.
  const source = await page.request.post(`/v1/notebooks/${nid}/sources/text`, {
    headers,
    data: {
      title: "مصدر الحد",
      text: "هذه فقرة خاصة لاختبار حد الأسئلة في واجهة التطبيق.",
    },
  });
  expect(source.status()).toBe(201);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "سؤالك عن المصادر" })
    .fill("اختبار حد الأسئلة");
  await page.getByRole("button", { name: "إرسال السؤال" }).click();
  await expect(
    page.getByText(/طلبات كثيرة خلال فترة قصيرة/).last(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("knowlm-token")),
  ).toBe(token);
});
