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
