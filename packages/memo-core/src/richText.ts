type RichTextNode = {
  type?: string;
  text?: string;
  content?: RichTextNode[];
};

export function extractPlainText(content: unknown): string {
  if (!content || typeof content !== "object") {
    return "";
  }

  const node = content as RichTextNode | RichTextNode[];

  const getText = (target: unknown): string => {
    if (!target || typeof target !== "object") {
      return "";
    }

    const candidate = target as RichTextNode;

    if (candidate.type === "text") {
      return typeof candidate.text === "string" ? candidate.text : "";
    }

    const children = Array.isArray(candidate.content) ? candidate.content : [];
    return children.map((child) => getText(child)).join("");
  };

  const getParagraphLines = (target: unknown): string[] => {
    if (!target || typeof target !== "object") {
      return [];
    }

    const candidate = target as RichTextNode;
    if (candidate.type === "paragraph") {
      return [getText(candidate)];
    }

    if (!Array.isArray(candidate.content)) {
      return [];
    }

    return candidate.content.flatMap((child) => getParagraphLines(child));
  };

  const lines = Array.isArray(node)
    ? node.flatMap((child) => getParagraphLines(child))
    : getParagraphLines(node);

  const normalized = lines
    .filter((line) => line.length > 0)
    .join("\n");

  if (normalized.length > 0) {
    return normalized;
  }

  if (Array.isArray(node)) {
    return "";
  }

  return getText(node);
}
