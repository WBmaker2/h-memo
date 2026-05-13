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

  it("returns empty text for invalid rich content", () => {
    expect(extractPlainText(null)).toBe("");
    expect(extractPlainText("plain")).toBe("");
  });
});
