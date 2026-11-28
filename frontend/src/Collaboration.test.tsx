import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import Collaboration, { JoinNotebook } from "./Collaboration";
const capability = "a".repeat(43);
const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
it("does not create a notebook invitation before explicit owner consent", async () => {
  const requests: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const path = String(input);
      requests.push({ path, init });
      if (path.endsWith("/collaboration"))
        return respond({ role: "owner", members: [], invitations: [] });
      if (path.includes("/room"))
        return respond({ messages: [], next_after: 0 });
      if (path.endsWith("/auth/me"))
        return respond({ id: "owner", username: "owner" });
      if (path.endsWith("/invitations"))
        return respond({ token: capability }, 201);
      throw new Error(path);
    }),
  );
  const user = userEvent.setup();
  render(
    <Collaboration
      notebookId="n"
      token="session"
      turns={[]}
      onRole={vi.fn()}
      onLeave={vi.fn()}
    />,
  );
  expect(requests).toHaveLength(0);
  await user.click(
    screen.getByRole("button", { name: "التعاون وغرفة الدفتر" }),
  );
  const create = await screen.findByRole("button", {
    name: "إنشاء دعوة لمدة 7 أيام",
  });
  expect(create).toBeDisabled();
  await user.type(
    screen.getByRole("textbox", { name: "اسم المستخدم المدعو" }),
    "member",
  );
  await user.click(
    screen.getByRole("checkbox", { name: /أوافق على إتاحة كل مصادر/ }),
  );
  await user.click(create);
  expect(
    await screen.findByRole("textbox", { name: "رابط دعوة جديد" }),
  ).toHaveValue(`${window.location.origin}/join#${capability}`);
  const request = requests.find((r) => r.path.endsWith("/invitations"))!;
  expect(JSON.parse(String(request.init.body))).toEqual({
    username: "member",
    role: "viewer",
    consent: true,
  });
});
it("publishes only a deliberately selected personal answer and renders room text as data", async () => {
  let sent: unknown;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const path = String(input);
      if (path.endsWith("/collaboration")) return respond({ role: "viewer" });
      if (path.endsWith("/auth/me"))
        return respond({ id: "me", username: "member" });
      if (init.method === "POST") {
        sent = JSON.parse(String(init.body));
        return respond({ id: 1 }, 201);
      }
      return respond({
        messages: [
          {
            id: 1,
            user_id: "other",
            username: "other",
            created_at: "2030-01-01",
            content: { text: "<img src=x onerror=alert(1)>" },
          },
        ],
        next_after: 1,
      });
    }),
  );
  const user = userEvent.setup();
  const { container } = render(
    <Collaboration
      notebookId="n"
      token="session"
      turns={[
        {
          id: "request",
          question: "private question",
          mode: "extractive",
          saved: true,
          answer: {
            turn_id: 42,
            mode: "extractive",
            answered: true,
            answer: "private answer",
            citations: [],
            notice: "test",
          },
        },
      ]}
      onRole={vi.fn()}
      onLeave={vi.fn()}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "التعاون وغرفة الدفتر" }),
  );
  const publish = await screen.findByRole("button", {
    name: "نشر في غرفة الدفتر",
  });
  expect(publish).toBeDisabled();
  expect(sent).toBeUndefined();
  expect(container.querySelector("img")).toBeNull();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "إرفاق إجابة من محادثتي الخاصة" }),
    "42",
  );
  await user.click(
    screen.getByRole("checkbox", { name: /راجعت الرسالة والإجابة المرفقة/ }),
  );
  await user.click(publish);
  await waitFor(() =>
    expect(sent).toEqual({
      text: "",
      turn_id: 42,
      consent: true,
      request_id: expect.any(String),
    }),
  );
  expect(screen.queryByText("private answer")).not.toBeInTheDocument();
});
it("shows invitation only after account authentication and requires recipient consent", async () => {
  window.history.replaceState({}, "", `/join#${capability}`);
  sessionStorage.setItem("knowlm-token", "recipient-session");
  const requests: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      requests.push(init);
      return String(input).endsWith("/invitation")
        ? respond({ title: "دفتر مشترك", role: "viewer" })
        : respond({ notebook_id: "n" });
    }),
  );
  const user = userEvent.setup();
  render(<JoinNotebook auth={() => <p>login</p>} />);
  const accept = await screen.findByRole("button", {
    name: "قبول دعوة الدفتر",
  });
  expect(accept).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", { name: /أقبل الوصول لمصادر/ }),
  );
  await user.click(accept);
  expect(await screen.findByRole("status")).toHaveTextContent("انضممت للدفتر");
  expect(new Headers(requests[0].headers).get("X-KnowLM-Invite")).toBe(
    capability,
  );
  expect(new Headers(requests[0].headers).get("Authorization")).toBe(
    "Bearer recipient-session",
  );
});

it("clears invitation consent and old preview when the fragment changes", async () => {
  window.history.replaceState({}, "", `/join#${capability}`);
  sessionStorage.setItem("knowlm-token", "recipient-session");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => respond({ title: "دفتر", role: "viewer" })),
  );
  const user = userEvent.setup();
  render(<JoinNotebook auth={() => null} />);
  await screen.findByRole("button", { name: "قبول دعوة الدفتر" });
  await user.click(
    screen.getByRole("checkbox", { name: /أقبل الوصول لمصادر/ }),
  );
  expect(
    screen.getByRole("button", { name: "قبول دعوة الدفتر" }),
  ).toBeEnabled();
  window.location.hash = "b".repeat(43);
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: /أقبل الوصول لمصادر/ }),
    ).not.toBeChecked(),
  );
  expect(
    screen.getByRole("button", { name: "قبول دعوة الدفتر" }),
  ).toBeDisabled();
});
