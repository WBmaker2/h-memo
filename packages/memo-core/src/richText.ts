type RichTextNode = {
  type?: string;
  text?: string;
  content?: RichTextNode[];
};

export function extractPlainText(content: unknown): string {
  if (!content || typeof content !== "object") {
    return "";
  }

  const node = content as RichTextNode;

  const walk = (target: RichTextNode): string => {
    if (target.type === "text") {
      return target.text ?? "";
    }

    const children = Array.isArray(target.content) ? target.content : [];
    const result = children.map((child) => walk(child)).join("");

    if (target.type === "doc" || target.type === "paragraph") {
      return result;
    }

    return result;
  };

  const lines = Array.isArray(node.content)
    ? node.content
        .map((child) => walk(child as RichTextNode))
        .filter((line) => line.length > 0 || true)
        .join("\n")
    : walk(node);

  return lines;
}
