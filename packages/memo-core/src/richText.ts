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

  const getText = (target: RichTextNode): string => {
    if (target.type === "text") {
      return target.text ?? "";
    }

    const children = Array.isArray(target.content) ? target.content : [];
    return children.map((child) => getText(child)).join("");
  };

  const getParagraphLines = (target: RichTextNode): string[] => {
    if (target.type === "paragraph") {
      return [getText(target)];
    }

    if (!Array.isArray(target.content)) {
      return [];
    }

    return target.content.flatMap((child) => getParagraphLines(child));
  };

  const lines = Array.isArray(node)
    ? node.flatMap((child) => getParagraphLines(child))
    : getParagraphLines(node);

  const normalized = lines
    .map((line) => line)
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
