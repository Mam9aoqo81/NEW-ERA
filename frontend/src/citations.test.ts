import { describe, expect, it } from "vitest";
import { citationLabel, formatTime, safeVideoLink } from "./citations";
import type { Citation } from "./api";
describe("timestamp citations", () => {
  it("formats video ranges without inventing a page", () => {
    expect(formatTime(15.9)).toBe("0:15");
    expect(formatTime(3723)).toBe("1:02:03");
    const c: Citation = {
      chunk_id: "c",
      source_id: "s",
      title: "video",
      quote: "text",
      url: "/v1/chunk",
      page: null,
      locator_type: "timestamp",
      start_seconds: 15,
      end_seconds: 29,
    };
    expect(citationLabel(c)).toBe("0:15 – 0:29");
    expect(citationLabel({ ...c, locator_type: "page", page: 2 })).toBe("ص 2");
  });
  it("labels Word paragraph locations without inventing page numbers", () => {
    const ref: Citation = {
      source_id: "s",
      chunk_id: "c",
      title: "Word",
      quote: "text",
      page: null,
      paragraph: 3,
      locator_type: "paragraph",
      url: "/v1/paragraph",
    };
    expect(citationLabel(ref)).toBe("فقرة 3");
  });
  it("opens only canonical safe YouTube timestamp links", () => {
    expect(
      safeVideoLink("https://www.youtube.com/watch?v=aB3dE5gH7jK&t=15s"),
    ).toBe("https://www.youtube.com/watch?v=aB3dE5gH7jK&t=15s");
    for (const value of [
      "javascript:alert(1)",
      "https://evil.test/watch?v=aB3dE5gH7jK&t=15s",
      "https://www.youtube.com@evil.test/watch?v=aB3dE5gH7jK&t=15s",
      "http://www.youtube.com/watch?v=aB3dE5gH7jK&t=15s",
      "https://www.youtube.com/watch?v=bad&t=15s",
      "https://www.youtube.com/watch?v=aB3dE5gH7jK&t=999999s",
    ])
      expect(safeVideoLink(value)).toBeUndefined();
  });
});
