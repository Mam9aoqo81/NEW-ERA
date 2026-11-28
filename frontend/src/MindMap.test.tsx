import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import MindMap, { type StudyGraph } from "./MindMap";
import type { Citation } from "./api";

const reference: Citation = {
  source_id: "s",
  chunk_id: "c",
  title: "علم النبات",
  quote: "اقتباس حرفي من المصدر",
  page: 1,
  url: "/v1/private/page",
};
const graph: StudyGraph = {
  relation_semantics: "source_containment_only",
  nodes: [
    { id: "root", kind: "root", label: "المصادر المحددة" },
    { id: "source:s", kind: "source", label: "علم النبات" },
    { id: "passage:0", kind: "passage", label: reference.quote, reference },
  ],
  edges: [
    { from: "root", to: "source:s", relation: "contains" },
    { from: "source:s", to: "passage:0", relation: "contains" },
  ],
};
describe("source mind map", () => {
  it("selects a literal passage and delegates private citation viewing", async () => {
    const user = userEvent.setup(),
      open = vi.fn();
    render(<MindMap graph={graph} onCitation={open} />);
    expect(screen.getByText(/لا تمثل علاقات سببية/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /مقطع 1/ }));
    expect(screen.getByRole("button", { name: /مقطع 1/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: /فتح مرجع المقطع/ }));
    expect(open).toHaveBeenCalledExactlyOnceWith(reference);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("collapses and expands branches with accessible state", async () => {
    const user = userEvent.setup();
    render(<MindMap graph={graph} onCitation={() => {}} />);
    const branch = screen.getByRole("button", { name: /علم النبات.*1 مقاطع/ });
    expect(branch).toHaveAttribute("aria-expanded", "true");
    await user.click(branch);
    expect(branch).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /مقطع 1/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "توسيع الكل" }));
    expect(branch).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /مقطع 1/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "طي الكل" }));
    expect(branch).toHaveAttribute("aria-expanded", "false");
  });
  it("renders source content as plain text, not executable markup", () => {
    const malicious = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.kind === "passage"
          ? { ...n, label: "<img src=x onerror=alert(1)>" }
          : n,
      ),
    };
    const { container } = render(
      <MindMap graph={malicious} onCitation={() => {}} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      within(screen.getByRole("button", { name: /مقطع 1/ })).getByText(
        "<img src=x onerror=alert(1)>",
      ),
    ).toBeInTheDocument();
  });
});
