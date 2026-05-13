import { describe, expect, it } from "vitest";
import { extractPlainText } from "./richText";

describe("extractPlainText", () => {
  it("extracts text from ProseMirror-like JSON", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "첫 줄" }] },
        { type: "paragraph", content: [{ type: "text", text: "둘째 줄" }] },
      ],
    };

    expect(extractPlainText(content)).toBe("첫 줄\n둘째 줄");
  });

  it("normalizes paragraph line breaks through nested nodes", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "제목" }] },
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "인용문" }] },
          ],
        },
        { type: "paragraph", content: [] },
      ],
    };

    expect(extractPlainText(content)).toBe("제목\n인용문");
  });

  it("returns empty text for invalid rich content", () => {
    expect(extractPlainText(null)).toBe("");
    expect(extractPlainText("plain")).toBe("");
    expect(extractPlainText({ type: "doc", content: "bad" })).toBe("");
  });

  it("ignores malformed children in content array", () => {
    const content = {
      type: "doc",
      content: [
        null,
        0,
        "text",
        { type: "paragraph", content: [{ type: "text", text: "good" }] },
        { type: "paragraph", content: null },
        { type: "blockquote", content: [{}, { type: "paragraph", content: [{ type: "text", text: "nested" }]}] },
        { type: "paragraph", content: [{ type: "text", text: 123 }] },
      ],
    };

    expect(extractPlainText(content)).toBe("good\nnested");
  });
});
