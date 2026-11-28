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

test("consented card and quiz links work for anonymous visitors and can be revoked", async ({
  page,
  browser,
}, info) => {
  const username = `share_${info.project.name}_${Date.now()}`,
    password = "development-test-password";
  expect(
    (
      await page.request.post("/v1/auth/register", {
        data: { username, password },
      })
    ).status(),
  ).toBe(201);
  const token = (
    await (
      await page.request.post("/v1/auth/login", {
        data: { username, password },
      })
    ).json()
  ).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const nid = (
    await (
      await page.request.post("/v1/notebooks", {
        headers,
        data: { title: "دفتر خاص لا يُنشر" },
      })
    ).json()
  ).id;
  const sid = (
    await (
      await page.request.post(`/v1/notebooks/${nid}/sources/text`, {
        headers,
        data: {
          title: "اسم ملف خاص",
          text: "تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية. تستخدم النباتات الطاقة الضوئية لتحويل الماء وثاني أكسيد الكربون إلى سكريات.",
        },
      })
    ).json()
  ).id;
  const deck = await (
    await page.request.post(`/v1/notebooks/${nid}/decks/generate`, {
      headers,
      data: { title: "مراجعة خاصة", source_ids: [sid] },
    })
  ).json();
  expect(
    (
      await page.request.post(`/v1/decks/${deck.id}/quizzes`, {
        headers,
        data: { count: 2 },
      })
    ).status(),
  ).toBe(201);
  await page.addInitScript(
    (t) => sessionStorage.setItem("knowlm-token", t),
    token,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "أدوات المراجعة" }).click();
  await page
    .getByRole("button", { name: "مشاركة البطاقات", exact: true })
    .click();
  await expect(page.getByLabel("النص الذي سيُنشر")).toContainText("____");
  await expect(
    page.getByRole("button", { name: "إنشاء رابط للنسخة المعاينة" }),
  ).toBeDisabled();
  await page.getByLabel("عنوان النسخة المشتركة").fill("بطاقات للزائر");
  await page.getByRole("checkbox", { name: /راجعت النص كاملًا/ }).check();
  await page
    .getByRole("button", { name: "إنشاء رابط للنسخة المعاينة" })
    .click();
  const cardLink = await page.getByLabel("رابط المشاركة الجديد").inputValue();
  expect(cardLink).toContain("/share#");
  const visitor = await browser.newContext({
    viewport: page.viewportSize()!,
    isMobile: info.project.name === "mobile",
  });
  try {
    const guest = await visitor.newPage();
    await guest.goto(cardLink);
    await expect(
      guest.getByRole("heading", { name: "بطاقات للزائر" }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "إظهار الإجابة" }).click();
    await expect(
      guest.getByRole("button", { name: "إخفاء الإجابة" }),
    ).toBeVisible();
    await expect(guest.getByText("اسم ملف خاص", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      guest.getByText("دفتر خاص لا يُنشر", { exact: true }),
    ).toHaveCount(0);
    expect(
      await guest.evaluate(() => sessionStorage.getItem("knowlm-token")),
    ).toBeNull();
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    await guest.screenshot({
      path: `../backend/data/shared-${info.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "مشاركة البطاقات", exact: true })
      .click();
    await page
      .getByRole("button", { name: "اختبار تفاعلي", exact: true })
      .click();
    await page.getByLabel("اختبار محفوظ").selectOption({ index: 1 });
    await page
      .getByRole("button", { name: "مشاركة الاختبار", exact: true })
      .click();
    await page.getByLabel("عنوان النسخة المشتركة").fill("اختبار للزائر");
    await page.getByRole("checkbox", { name: /راجعت النص كاملًا/ }).check();
    await page
      .getByRole("button", { name: "إنشاء رابط للنسخة المعاينة" })
      .click();
    const quizLink = await page.getByLabel("رابط المشاركة الجديد").inputValue();
    await guest.goto(quizLink);
    await expect(
      guest.getByRole("heading", { name: "اختبار للزائر" }),
    ).toBeVisible();
    for (const field of await guest.locator(".quiz-question").all())
      await field.getByRole("radio").first().check();
    await guest.getByRole("button", { name: "تصحيح الاختبار المشترك" }).click();
    await expect(guest.locator(".quiz-score")).toContainText("غير محفوظة");
    await page
      .getByRole("button", { name: "إلغاء رابط: اختبار للزائر" })
      .click();
    await page.getByRole("button", { name: "تأكيد إلغاء الرابط" }).click();
    await expect(
      page.getByRole("button", { name: "إلغاء رابط: اختبار للزائر" }),
    ).toHaveCount(0);
    await guest.reload();
    await expect(guest.getByRole("alert")).toContainText("غير متاحة");
    await guest.goto(cardLink);
    await expect(
      guest.getByRole("heading", { name: "بطاقات للزائر" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "إلغاء رابط: بطاقات للزائر" })
      .click();
    await page.getByRole("button", { name: "تأكيد إلغاء الرابط" }).click();
    await expect(
      page.getByRole("button", { name: "إلغاء رابط: بطاقات للزائر" }),
    ).toHaveCount(0);
    await guest.reload();
    await expect(guest.getByRole("alert")).toContainText("غير متاحة");
  } finally {
    await visitor.close();
  }
});

test("recipient saves independent cards and submits a report without gaining source access", async ({
  page,
}, info) => {
  const suffix = `${info.project.name}_${Date.now()}`;
  const password = "development-test-password";
  async function account(username: string) {
    expect(
      (
        await page.request.post("/v1/auth/register", {
          data: { username, password },
        })
      ).status(),
    ).toBe(201);
    return (
      await (
        await page.request.post("/v1/auth/login", {
          data: { username, password },
        })
      ).json()
    ).access_token;
  }
  const owner = { Authorization: `Bearer ${await account("pub_" + suffix)}` };
  const recipientToken = await account("save_" + suffix);
  const recipient = { Authorization: `Bearer ${recipientToken}` };
  const nid = (
    await (
      await page.request.post("/v1/notebooks", {
        headers: owner,
        data: { title: "أصل خاص" },
      })
    ).json()
  ).id;
  const deck = (
    await (
      await page.request.post(`/v1/notebooks/${nid}/decks`, {
        headers: owner,
        data: { title: "مجموعة للحفظ" },
      })
    ).json()
  ).id;
  expect(
    (
      await page.request.post(`/v1/decks/${deck}/cards`, {
        headers: owner,
        data: { front: "سؤال مستقل", back: "إجابة مستقلة" },
      })
    ).status(),
  ).toBe(201);
  const preview = await (
    await page.request.get(`/v1/decks/${deck}/share-preview`, {
      headers: owner,
    })
  ).json();
  const share = await (
    await page.request.post(`/v1/decks/${deck}/shares`, {
      headers: owner,
      data: {
        title: "للمراجعة والحفظ",
        consent: true,
        preview_hash: preview.preview_hash,
      },
    })
  ).json();
  await page.addInitScript(
    (t) => sessionStorage.setItem("knowlm-token", t),
    recipientToken,
  );
  await page.goto(`/share#${share.token}`);
  await expect(
    page.getByRole("heading", { name: "للمراجعة والحفظ" }),
  ).toBeVisible();
  const save = page.getByRole("button", { name: "حفظ البطاقات في مكتبتي" });
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: /أفهم أنها نسخة/ }).check();
  await save.click();
  await expect(page.getByText(/حُفظت نسخة مستقلة/)).toBeVisible();
  await page
    .getByRole("combobox", { name: "سبب الإبلاغ" })
    .selectOption("incorrect");
  await page.getByRole("button", { name: "إرسال بلاغ للمراجعة" }).click();
  await expect(page.getByText(/استُلم البلاغ للمراجعة البشرية/)).toBeVisible();
  expect(
    (
      await page.request.get(`/v1/notebooks/${nid}/sources`, {
        headers: recipient,
      })
    ).status(),
  ).toBe(404);
  const copies = await (
    await page.request.get("/v1/notebooks", { headers: recipient })
  ).json();
  expect(copies).toHaveLength(1);
  expect(
    (
      await page.request.delete(`/v1/notebooks/${nid}`, { headers: owner })
    ).status(),
  ).toBe(204);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: copies[0].title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "أدوات المراجعة" }).click();
  await expect(page.getByText("نسخة مشتركة · غير مدققة").first()).toBeVisible();
  await expect(
    page.getByText("سؤال مستقل", { exact: true }).first(),
  ).toBeVisible();
});

test("local Arabic/English scanned PDF → OCR page 2 → persisted private citation", async ({
  page,
}, info) => {
  const health = await (await page.request.get("/health")).json();
  test.skip(
    !health.ocr_enabled,
    "Requires the optional local OCR worker and models",
  );
  const username = `ocr_${info.project.name}_${Date.now()}`,
    password = "development-test-password";
  expect(
    (
      await page.request.post("/v1/auth/register", {
        data: { username, password },
      })
    ).status(),
  ).toBe(201);
  const token = (
    await (
      await page.request.post("/v1/auth/login", {
        data: { username, password },
      })
    ).json()
  ).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  await page.request.post("/v1/notebooks", {
    headers,
    data: { title: "قراءة صورة عربية وإنجليزية" },
  });
  await page.addInitScript(
    (t) => sessionStorage.setItem("knowlm-token", t),
    token,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "إضافة مصدر", exact: true }).click();
  await page
    .getByLabel("ملف PDF", { exact: true })
    .setInputFiles(path.resolve("../backend/tests/fixtures/ocr-bilingual.pdf"));
  await page.getByRole("button", { name: "إضافة إلى مصادري" }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /^المصادر/ }).click();
  await expect(
    page.getByRole("checkbox", { name: /ocr-bilingual.pdf/ }),
  ).toBeEnabled({ timeout: 25000 });
  await expect(page.getByText(/OCR محلي · صفحات 2/)).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "اسأل وافهم", exact: true }).click();
  await page
    .getByRole("textbox", { name: "سؤالك عن المصادر" })
    .fill("النباتات الشمس");
  await page.getByRole("button", { name: "إرسال السؤال" }).click();
  await page.getByRole("button", { name: /ocr-bilingual.pdf.*ص 2/ }).click();
  await expect(
    page.getByText(/هذا النص قُرئ آليًا من صورة بواسطة OCR/),
  ).toBeVisible();
  await expect(page.locator(".page-text .highlighted")).toContainText("الشمس");
  await expect(page.locator(".page-text")).toContainText("Photosynthesis");
  await page.screenshot({
    path: `../backend/data/ocr-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /ocr-bilingual.pdf.*ص 2/ }).click();
  await expect(
    page.getByText(/هذا النص قُرئ آليًا من صورة بواسطة OCR/),
  ).toBeVisible();
});

test("targeted notebook invitation → private chats → explicit room answer → role change and removal", async ({
  page,
  browser,
}, info) => {
  const suffix = `${info.project.name}_${Date.now()}`,
    password = "development-test-password";
  const ownerName = "team_owner_" + suffix,
    memberName = "team_member_" + suffix;
  async function register(username: string) {
    expect(
      (
        await page.request.post("/v1/auth/register", {
          data: { username, password },
        })
      ).status(),
    ).toBe(201);
    return (
      await (
        await page.request.post("/v1/auth/login", {
          data: { username, password },
        })
      ).json()
    ).access_token;
  }
  const ownerToken = await register(ownerName);
  await register(memberName);
  const owner = { Authorization: `Bearer ${ownerToken}` };
  const nid = (
    await (
      await page.request.post("/v1/notebooks", {
        headers: owner,
        data: { title: "دفتر الفريق التجريبي" },
      })
    ).json()
  ).id;
  expect(
    (
      await page.request.post(`/v1/notebooks/${nid}/sources/text`, {
        headers: owner,
        data: {
          title: "مصدر الفريق",
          text: "تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء. تستخدم النباتات ضوء الشمس لتحويل الماء وثاني أكسيد الكربون إلى سكريات.",
        },
      })
    ).status(),
  ).toBe(201);
  await page.addInitScript(
    (t) => sessionStorage.setItem("knowlm-token", t),
    ownerToken,
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "التعاون وغرفة الدفتر", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "اسم المستخدم المدعو" })
    .fill(memberName);
  await expect(
    page.getByRole("button", { name: "إنشاء دعوة لمدة 7 أيام" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /أوافق على إتاحة كل مصادر/ })
    .check();
  await page.getByRole("button", { name: "إنشاء دعوة لمدة 7 أيام" }).click();
  const link = await page
    .getByRole("textbox", { name: "رابط دعوة جديد" })
    .inputValue();
  const context = await browser.newContext({
    viewport: page.viewportSize()!,
    isMobile: info.project.name === "mobile",
  });
  try {
    const member = await context.newPage();
    await member.goto(link);
    await member
      .getByRole("textbox", { name: "اسم المستخدم", exact: true })
      .fill(memberName);
    await member.getByLabel("كلمة المرور", { exact: true }).fill(password);
    await member
      .getByRole("button", { name: "ادخل إلى مساحتك", exact: true })
      .click();
    await expect(
      member.getByRole("heading", { name: "دفتر الفريق التجريبي" }),
    ).toBeVisible();
    await member.getByRole("checkbox", { name: /أقبل الوصول لمصادر/ }).check();
    await member.getByRole("button", { name: "قبول دعوة الدفتر" }).click();
    await expect(member.getByRole("status")).toContainText("انضممت للدفتر");
    await member.getByRole("link", { name: "KnowLM · مساحة الدراسة" }).click();
    await expect(
      member.getByRole("heading", { level: 1, name: "دفتر الفريق التجريبي" }),
    ).toBeVisible();
    await expect(
      member.getByRole("button", { name: "حذف الدفتر", exact: true }),
    ).toHaveCount(0);
    await member
      .getByRole("button", { name: "التعاون وغرفة الدفتر", exact: true })
      .click();
    await expect(
      member.getByText("صلاحيتك: قارئ", { exact: true }),
    ).toBeVisible();
    if (info.project.name === "mobile")
      await page
        .getByRole("button", { name: "اسأل وافهم", exact: true })
        .click();
    await page
      .getByRole("textbox", { name: "سؤالك عن المصادر" })
      .fill("البناء الضوئي");
    await page.getByRole("button", { name: "إرسال السؤال" }).click();
    await expect(
      page.getByRole("button", { name: /مصدر الفريق.*ص 1/ }),
    ).toBeVisible();
    await member
      .getByRole("button", { name: "تحديث الغرفة", exact: true })
      .click();
    await expect(member.locator(".room-message")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "إرفاق إجابة من محادثتي الخاصة" })
      .selectOption({ index: 1 });
    await page
      .getByRole("textbox", { name: "رسالة لأعضاء الدفتر" })
      .fill("إجابة اخترت نشرها للفريق");
    await page
      .getByRole("checkbox", { name: /راجعت الرسالة والإجابة المرفقة/ })
      .check();
    await page
      .getByRole("button", { name: "نشر في غرفة الدفتر", exact: true })
      .click();
    await member
      .getByRole("button", { name: "تحديث الغرفة", exact: true })
      .click();
    await expect(member.locator(".room-message")).toContainText(
      "إجابة اخترت نشرها للفريق",
    );
    await expect(member.locator(".room-message")).toContainText(
      "البلاستيدات الخضراء",
    );
    const memberToken = await member.evaluate(() =>
      sessionStorage.getItem("knowlm-token"),
    );
    const memberHeaders = { Authorization: `Bearer ${memberToken}` };
    expect(
      (
        await (
          await member.request.get(`/v1/notebooks/${nid}/history`, {
            headers: memberHeaders,
          })
        ).json()
      ).turns,
    ).toHaveLength(0);
    await member
      .getByRole("textbox", { name: "رسالة لأعضاء الدفتر" })
      .fill("مشاركة من القارئ");
    await member
      .getByRole("checkbox", { name: /راجعت الرسالة والإجابة المرفقة/ })
      .check();
    await member
      .getByRole("button", { name: "نشر في غرفة الدفتر", exact: true })
      .click();
    await page
      .getByRole("button", { name: "تحديث الغرفة", exact: true })
      .click();
    await expect(page.locator(".room-message")).toContainText([
      "إجابة اخترت نشرها للفريق",
      "مشاركة من القارئ",
    ]);
    await page
      .getByRole("combobox", { name: `صلاحية ${memberName}` })
      .selectOption("editor");
    await member
      .getByRole("button", { name: "تحديث الغرفة", exact: true })
      .click();
    await expect(
      member.getByText("صلاحيتك: محرر", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await member.request.post(`/v1/notebooks/${nid}/sources/text`, {
          headers: memberHeaders,
          data: { title: "إضافة محرر", text: "مصدر أضافه عضو الفريق" },
        })
      ).status(),
    ).toBe(201);
    await member.screenshot({
      path: `../backend/data/collaboration-${info.project.name}.png`,
      fullPage: true,
    });
    expect(
      await member.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: `إزالة ${memberName}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: `تأكيد إزالة ${memberName}`, exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: `صلاحية ${memberName}` }),
    ).toHaveCount(0);
    expect(
      (
        await member.request.get(`/v1/notebooks/${nid}/sources`, {
          headers: memberHeaders,
        })
      ).status(),
    ).toBe(404);
    await member
      .getByRole("button", { name: "تحديث الغرفة", exact: true })
      .click();
    await expect(
      member.locator(".collaboration-body [role=alert]"),
    ).toContainText("لا تملك صلاحية");
    await expect(member.locator(".room-message")).toHaveCount(0);
  } finally {
    await context.close().catch(() => {});
  }
});

test("explicit public publication → anonymous cards → save/follow/comment/report/block → unpublish", async ({
  page,
  browser,
}, info) => {
  const suffix = `${info.project.name}_${Date.now()}`,
    password = "development-test-password",
    title = `مراجعة عامة ${suffix}`;
  async function account(username: string) {
    expect(
      (
        await page.request.post("/v1/auth/register", {
          data: { username, password },
        })
      ).status(),
    ).toBe(201);
    return (
      await (
        await page.request.post("/v1/auth/login", {
          data: { username, password },
        })
      ).json()
    ).access_token;
  }
  const ownerToken = await account(`public_owner_${suffix}`),
    readerToken = await account(`public_reader_${suffix}`);
  const headers = { Authorization: `Bearer ${ownerToken}` };
  const nid = (
    await (
      await page.request.post("/v1/notebooks", {
        headers,
        data: { title: "دفتر لا يُنشر" },
      })
    ).json()
  ).id;
  const deck = (
    await (
      await page.request.post(`/v1/notebooks/${nid}/decks`, {
        headers,
        data: { title: "مجموعة عامة" },
      })
    ).json()
  ).id;
  expect(
    (
      await page.request.post(`/v1/decks/${deck}/cards`, {
        headers,
        data: { front: "سؤال للعامة", back: "إجابة للعامة" },
      })
    ).status(),
  ).toBe(201);
  const preview = await (
    await page.request.get(`/v1/decks/${deck}/share-preview`, { headers })
  ).json();
  const share = await (
    await page.request.post(`/v1/decks/${deck}/shares`, {
      headers,
      data: { title, consent: true, preview_hash: preview.preview_hash },
    })
  ).json();
  await page.addInitScript(
    (t) => sessionStorage.setItem("knowlm-token", t),
    ownerToken,
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "أدوات المراجعة", exact: true })
    .click();
  await page
    .getByRole("button", { name: "مشاركة البطاقات", exact: true })
    .click();
  await page
    .getByRole("button", { name: `نشر للمجتمع: ${title}`, exact: true })
    .click();
  const publish = page.getByRole("button", {
    name: "تأكيد النشر العام",
    exact: true,
  });
  await expect(publish).toBeDisabled();
  await page
    .getByLabel("اسم المنهج وإصداره", { exact: true })
    .fill(`منهج تجريبي ${suffix}`);
  await page
    .getByRole("checkbox", { name: /راجعت كل النص وأملك حق نشره للعامة/ })
    .check();
  await publish.click();
  const link = await page
    .getByRole("link", { name: "فتح المنشور العام", exact: true })
    .getAttribute("href");
  expect(link).not.toContain(share.token);
  const anonymous = await browser.newContext({
    viewport: page.viewportSize()!,
    isMobile: info.project.name === "mobile",
  });
  const recipient = await browser.newContext({
    viewport: page.viewportSize()!,
    isMobile: info.project.name === "mobile",
  });
  try {
    const guest = await anonymous.newPage();
    await guest.goto(link!);
    await expect(
      guest.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await guest.getByText("سؤال للعامة", { exact: true }).click();
    await expect(
      guest.getByText("إجابة للعامة", { exact: true }),
    ).toBeVisible();
    await expect(guest.getByText("دفتر لا يُنشر", { exact: true })).toHaveCount(
      0,
    );
    expect(
      await guest.evaluate(() => sessionStorage.getItem("knowlm-token")),
    ).toBeNull();
    await recipient.addInitScript(
      (t) => sessionStorage.setItem("knowlm-token", t),
      readerToken,
    );
    const reader = await recipient.newPage();
    await reader.goto(link!);
    await reader
      .getByRole("button", { name: "حفظ المنشور", exact: true })
      .click();
    await expect(
      reader.getByRole("button", { name: "إلغاء حفظ المنشور", exact: true }),
    ).toBeVisible();
    await reader
      .getByRole("button", { name: "متابعة الناشر", exact: true })
      .click();
    await expect(
      reader.getByRole("button", { name: "إلغاء متابعة الناشر", exact: true }),
    ).toBeVisible();
    await reader
      .getByRole("textbox", { name: "تعليق عام", exact: true })
      .fill("تعليق تجريبي ظاهر للعامة");
    await expect(
      reader.getByRole("button", { name: "نشر التعليق العام", exact: true }),
    ).toBeDisabled();
    await reader
      .getByRole("checkbox", {
        name: /أوافق على نشر التعليق واسم حسابي للعامة/,
      })
      .check();
    await reader
      .getByRole("button", { name: "نشر التعليق العام", exact: true })
      .click();
    await expect(reader.locator(".community-comment")).toContainText(
      "تعليق تجريبي ظاهر للعامة",
    );
    await reader
      .getByRole("button", { name: "إرسال بلاغ عن المنشور", exact: true })
      .click();
    await expect(reader.getByRole("status")).toContainText("استُلم البلاغ");
    await reader.screenshot({
      path: `../backend/data/community-${info.project.name}.png`,
      fullPage: true,
    });
    expect(
      await reader.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    await reader
      .getByRole("button", { name: "حظر الناشر", exact: true })
      .click();
    await reader
      .getByRole("button", { name: "تأكيد حظر الناشر", exact: true })
      .click();
    await expect(
      reader.getByRole("link", { name: title, exact: true }),
    ).toHaveCount(0);
    await reader
      .getByRole("button", {
        name: `إلغاء حظر public_owner_${suffix}`,
        exact: true,
      })
      .click();
    await reader
      .getByLabel("اسم المنهج وإصداره بالتطابق الكامل", { exact: true })
      .fill(`منهج تجريبي ${suffix}`);
    await reader.getByRole("link", { name: title, exact: true }).click();
    await expect(
      reader.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.goto(link!);
    await page
      .getByRole("button", { name: "إلغاء النشر العام", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "تأكيد إلغاء النشر العام وحذف تعليقاته وحفظه من القوائم",
        exact: true,
      })
      .click();
    await guest.reload();
    await expect(guest.getByRole("alert")).toContainText("المنشور غير متاح");
    expect(
      (
        await page.request.get("/v1/shared/view", {
          headers: { "X-KnowLM-Share": share.token },
        })
      ).status(),
    ).toBe(200);
  } finally {
    await anonymous.close().catch(() => {});
    await recipient.close().catch(() => {});
  }
});

test("private ink canvas persists real pointer strokes and notes", async ({
  page,
}, info) => {
  const username = `ink_${info.project.name}_${Date.now()}`,
    password = "development-test-password";
  expect(
    (
      await page.request.post("/v1/auth/register", {
        data: { username, password },
      })
    ).status(),
  ).toBe(201);
  const token = (
    await (
      await page.request.post("/v1/auth/login", {
        data: { username, password },
      })
    ).json()
  ).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const nid = (
    await (
      await page.request.post("/v1/notebooks", {
        headers,
        data: { title: "دفتر القلم" },
      })
    ).json()
  ).id;
  await page.goto("/");
  await page.evaluate((t) => sessionStorage.setItem("knowlm-token", t), token);
  await page.reload();
  await page.getByText("لوحة المذاكرة بالقلم والملاحظات · خاصة بي").click();
  const notes = page.getByLabel("ملاحظاتي النصية");
  await expect(notes).toBeEnabled();
  await notes.fill("ملاحظة محفوظة بالقلم");
  const ink = page.getByRole("img", { name: /مساحة رسم بالقلم/ });
  await ink.scrollIntoViewIfNeeded();
  const box = (await ink.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(ink.locator("polyline")).toHaveCount(1);
  await page.getByRole("button", { name: "حفظ اللوحة", exact: true }).click();
  await expect(page.getByText("تم حفظ اللوحة الخاصة")).toBeVisible();
  const saved = await (
    await page.request.get(`/v1/notebooks/${nid}/canvas`, { headers })
  ).json();
  expect(saved.strokes).toHaveLength(1);
  expect(saved.strokes[0].points.length).toBeGreaterThan(1);
  await page.reload();
  await page.getByText("لوحة المذاكرة بالقلم والملاحظات · خاصة بي").click();
  await expect(notes).toHaveValue("ملاحظة محفوظة بالقلم");
  await expect(ink.locator("polyline")).toHaveCount(1);
  await ink.screenshot({
    path: `../backend/data/canvas-${info.project.name}.png`,
  });
  await page.request.delete(`/v1/notebooks/${nid}`, { headers });
});

test("source-selected review dialogue persists with private citations and downloadable transcript", async ({
  page,
}, info) => {
  const username = `podcast_${info.project.name}_${Date.now()}`,
    password = "development-test-password";
  expect(
    (
      await page.request.post("/v1/auth/register", {
        data: { username, password },
      })
    ).status(),
  ).toBe(201);
  const token = (
    await (
      await page.request.post("/v1/auth/login", {
        data: { username, password },
      })
    ).json()
  ).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const nid = (
    await (
      await page.request.post("/v1/notebooks", {
        headers,
        data: { title: "دفتر الحوار" },
      })
    ).json()
  ).id;
  const text =
    "تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية.";
  await page.request.post(`/v1/notebooks/${nid}/sources/text`, {
    headers,
    data: { title: "مرجع الحوار", text },
  });
  await page.goto("/");
  await page.evaluate((t) => sessionStorage.setItem("knowlm-token", t), token);
  await page.reload();
  await page.getByRole("button", { name: "أدوات المراجعة" }).click();
  await page
    .getByRole("button", { name: "مخرجات الدراسة", exact: true })
    .click();
  await page.getByLabel("نوع المخرج").selectOption("podcast");
  await page
    .getByRole("button", { name: "إنشاء وحفظ من المصادر المحددة" })
    .click();
  const player = page.getByRole("region", { name: "مشغل حوار المراجعة" });
  await expect(player.getByText(text, { exact: true })).toBeVisible();
  await expect(
    player.getByText("ماذا يقول المقطع المختار؟", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await player.getByRole("button", { name: "تنزيل نص الحوار" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "knowlm-review-dialogue.txt",
  );
  await player
    .getByRole("button", { name: "فتح مرجع المقطع 2", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "العودة إلى المصدر" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "أدوات المراجعة" }).click();
  await page
    .getByRole("button", { name: "مخرجات الدراسة", exact: true })
    .click();
  await expect(player.getByText(text, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await player.screenshot({
    path: `../backend/data/podcast-${info.project.name}.png`,
  });
  await page.request.delete(`/v1/notebooks/${nid}`, { headers });
});
