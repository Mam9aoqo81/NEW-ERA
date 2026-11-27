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
