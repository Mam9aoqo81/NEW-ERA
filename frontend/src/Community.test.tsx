import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import Community, { PublicPublisher } from "./Community";
const catalog = {
  countries: { EG: "مصر", SA: "السعودية" },
  stages: { secondary: "ثانوي" },
  subjects: { biology: "الأحياء" },
};
const post = {
  id: "public-id",
  title: "مراجعة عامة",
  kind: "cards",
  publisher: { id: "author", username: "author" },
  country: "EG",
  stage: "secondary",
  subject: "biology",
  curriculum: "منهج 2026",
  expires_at: "2030-01-01",
};
const respond = (data: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
it("requires a second public preview and explicit identity/publication consent", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const path = String(input);
      calls.push({ path, init });
      if (path.endsWith("/catalog")) return respond(catalog);
      if (path.endsWith("/public-preview"))
        return respond({
          title: "title",
          snapshot: {
            kind: "cards",
            items: [{ front: "question", back: "answer" }],
          },
          preview_hash: "b".repeat(64),
        });
      return respond(post, 201);
    }),
  );
  const user = userEvent.setup();
  render(
    <PublicPublisher shareId={"s".repeat(36)} token="owner" title="مراجعة" />,
  );
  expect(calls).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "نشر للمجتمع: مراجعة" }));
  const publish = await screen.findByRole("button", {
    name: "تأكيد النشر العام",
  });
  expect(publish).toBeDisabled();
  await screen.findByText(/question/);
  await user.type(
    screen.getByRole("textbox", { name: "اسم المنهج وإصداره" }),
    "منهج 2026",
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: /راجعت كل النص وأملك حق نشره للعامة/,
    }),
  );
  await user.click(publish);
  expect(
    await screen.findByRole("link", { name: "فتح المنشور العام" }),
  ).toHaveAttribute("href", `${window.location.origin}/community#public-id`);
  expect(
    JSON.parse(
      String(calls.find((c) => c.path === "/v1/community/posts")!.init.body),
    ),
  ).toMatchObject({
    consent: true,
    preview_hash: "b".repeat(64),
    curriculum: "منهج 2026",
  });
});
it("reads a public post without a session and safely renders text rather than HTML", async () => {
  window.history.replaceState({}, "", "/community#public-id");
  const requests: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      requests.push(init);
      const path = String(input);
      if (path.endsWith("/catalog")) return respond(catalog);
      if (path.endsWith("/comments"))
        return respond([
          {
            id: 1,
            user_id: "reader",
            username: "reader",
            text: "<img src=x onerror=alert(1)>",
          },
        ]);
      return respond({ ...post, items: [{ front: "سؤال", back: "إجابة" }] });
    }),
  );
  const user = userEvent.setup();
  const { container } = render(<Community auth={() => null} />);
  await screen.findByRole("heading", { name: "مراجعة عامة" });
  expect(container.querySelector("img")).toBeNull();
  expect(
    requests.every((r) => new Headers(r.headers).get("Authorization") === null),
  ).toBe(true);
  await user.click(screen.getByText("سؤال", { exact: true }));
  expect(screen.getByText("إجابة")).toBeVisible();
  expect(screen.getByText(/الحظر يفلتر الحسابات/)).toBeVisible();
});
it("keeps saves private and requires affirmative consent for public comments", async () => {
  window.history.replaceState({}, "", "/community#public-id");
  sessionStorage.setItem("knowlm-token", "reader-session");
  let saved = false,
    commentBody: unknown;
  const comments: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const path = String(input);
      if (path.endsWith("/catalog")) return respond(catalog);
      if (path === "/v1/community/me")
        return respond({
          saved: saved ? ["public-id"] : [],
          following: [],
          blocked: [],
        });
      if (path.endsWith("/auth/me"))
        return respond({ id: "reader", username: "reader" });
      if (path.endsWith("/save")) {
        saved = true;
        return respond(null, 204);
      }
      if (path.endsWith("/comments")) {
        if (init.method === "POST") {
          commentBody = JSON.parse(String(init.body));
          comments.push({
            id: 1,
            user_id: "reader",
            username: "reader",
            text: "تعليق للمراجعة",
          });
          return respond(comments[0], 201);
        }
        return respond(comments);
      }
      return respond({ ...post, items: [{ front: "سؤال", back: "إجابة" }] });
    }),
  );
  const user = userEvent.setup();
  render(<Community auth={() => null} />);
  await screen.findByRole("heading", { name: "مراجعة عامة" });
  await user.click(screen.getByRole("button", { name: /^حفظ المنشور$/ }));
  expect(
    await screen.findByRole("button", { name: "إلغاء حفظ المنشور" }),
  ).toBeVisible();
  const publish = screen.getByRole("button", { name: "نشر التعليق العام" });
  expect(publish).toBeDisabled();
  await user.type(
    screen.getByRole("textbox", { name: "تعليق عام" }),
    "تعليق للمراجعة",
  );
  expect(publish).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", { name: /أوافق على نشر التعليق واسم حسابي/ }),
  );
  await user.click(publish);
  await waitFor(() =>
    expect(commentBody).toEqual({ text: "تعليق للمراجعة", consent: true }),
  );
  expect(
    await screen.findByText("تعليق للمراجعة", { exact: true }),
  ).toBeVisible();
});
