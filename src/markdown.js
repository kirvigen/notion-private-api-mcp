import path from "node:path";

// Parses inline markdown into Notion's title rich-text runs:
//   [[text]] | [[text, [["b"]]]] | [[text, [["a", "href"]]]]
// Handles: **bold**, __bold__, *italic*, _italic_, `code`, [text](url).
// Nesting is supported via a shared annotations stack.
export function parseInlineMarkdown(input) {
  const text = String(input ?? "");
  if (!text) {
    return [];
  }

  const runs = [];
  let buffer = "";
  const stack = []; // array of annotation tuples like ["b"] / ["i"] / ["c"]
  let i = 0;

  const flush = () => {
    if (!buffer) {
      return;
    }
    const annotations = stack.slice();
    if (annotations.length) {
      runs.push([buffer, annotations]);
    } else {
      runs.push([buffer]);
    }
    buffer = "";
  };

  const pushRun = (value, annotations) => {
    if (!value) {
      return;
    }
    if (annotations && annotations.length) {
      runs.push([value, annotations]);
    } else {
      runs.push([value]);
    }
  };

  const peek = (offset = 0) => text[i + offset];

  while (i < text.length) {
    const ch = text[i];

    // Escape: backslash keeps the next character literal.
    if (ch === "\\" && i + 1 < text.length) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    // Inline code: `...`
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        const code = text.slice(i + 1, end);
        pushRun(code, [["c"]]);
        i = end + 1;
        continue;
      }
    }

    // Link: [text](url)
    if (ch === "[") {
      const closeBracket = findMatching(text, i, "[", "]");
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          flush();
          const linkText = text.slice(i + 1, closeBracket);
          const href = text.slice(closeBracket + 2, closeParen).trim();
          // Parse inline markdown inside the link text too, so **bold [link]** works.
          const innerRuns = parseInlineMarkdown(linkText);
          for (const run of innerRuns) {
            const [rt, attrs = []] = run;
            pushRun(rt, [...attrs, ["a", href]]);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Bold: ** or __
    if ((ch === "*" && peek(1) === "*") || (ch === "_" && peek(1) === "_")) {
      const marker = ch + ch;
      const close = findClosingMarker(text, i + 2, marker);
      if (close !== -1) {
        flush();
        stack.push(["b"]);
        const inner = text.slice(i + 2, close);
        const innerRuns = parseInlineMarkdown(inner);
        for (const run of innerRuns) {
          const [rt, attrs = []] = run;
          pushRun(rt, [["b"], ...attrs]);
        }
        stack.pop();
        i = close + 2;
        continue;
      }
    }

    // Italic: * or _
    if (ch === "*" || ch === "_") {
      const close = findClosingMarker(text, i + 1, ch);
      if (close !== -1 && close !== i + 1) {
        flush();
        const inner = text.slice(i + 1, close);
        const innerRuns = parseInlineMarkdown(inner);
        for (const run of innerRuns) {
          const [rt, attrs = []] = run;
          pushRun(rt, [["i"], ...attrs]);
        }
        i = close + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return runs;
}

function findClosingMarker(text, startIndex, marker) {
  let i = startIndex;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      // Skip code spans so markers inside them don't match.
      const end = text.indexOf("`", i + 1);
      if (end === -1) {
        return -1;
      }
      i = end + 1;
      continue;
    }
    if (marker.length === 2) {
      if (text[i] === marker[0] && text[i + 1] === marker[1]) {
        return i;
      }
    } else if (text[i] === marker) {
      return i;
    }
    i += 1;
  }
  return -1;
}

function findMatching(text, openIndex, openCh, closeCh) {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === openCh) {
      depth += 1;
    } else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

function pushParagraph(blocks, lines) {
  if (!lines.length) {
    return;
  }

  blocks.push({
    type: "paragraph",
    text: lines.join(" ").trim(),
  });
  lines.length = 0;
}

export function parseMarkdownToBlocks(markdown) {
  const normalized = String(markdown ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks = [];
  const paragraph = [];
  let codeFence = null;
  let codeLines = [];

  for (const rawLine of lines) {
    const line = rawLine ?? "";

    if (codeFence) {
      if (line.startsWith("```")) {
        blocks.push({
          type: "code",
          text: codeLines.join("\n"),
          language: codeFence.language,
        });
        codeFence = null;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      pushParagraph(blocks, paragraph);
      continue;
    }

    const codeMatch = trimmed.match(/^```(\S+)?\s*$/);
    if (codeMatch) {
      pushParagraph(blocks, paragraph);
      codeFence = { language: codeMatch[1] || "plain text" };
      codeLines = [];
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      pushParagraph(blocks, paragraph);
      blocks.push({ type: "divider" });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      pushParagraph(blocks, paragraph);
      blocks.push({
        type: `heading_${headingMatch[1].length}`,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    const todoMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (todoMatch) {
      pushParagraph(blocks, paragraph);
      blocks.push({
        type: "to_do",
        text: todoMatch[2].trim(),
        checked: todoMatch[1].toLowerCase() === "x",
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bulletMatch) {
      pushParagraph(blocks, paragraph);
      blocks.push({
        type: "bulleted_list_item",
        text: bulletMatch[1].trim(),
      });
      continue;
    }

    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      pushParagraph(blocks, paragraph);
      blocks.push({
        type: "numbered_list_item",
        text: numberedMatch[1].trim(),
      });
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      pushParagraph(blocks, paragraph);
      blocks.push({
        type: "quote",
        text: quoteMatch[1].trim(),
      });
      continue;
    }

    paragraph.push(trimmed);
  }

  if (codeFence) {
    blocks.push({
      type: "code",
      text: codeLines.join("\n"),
      language: codeFence.language,
    });
  }

  pushParagraph(blocks, paragraph);

  return blocks;
}

export function inferTitleFromMarkdown(markdown, fallbackPath = "") {
  const normalized = String(markdown ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^#\s+(.+)$/);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
  }

  if (fallbackPath) {
    return path.basename(fallbackPath, path.extname(fallbackPath));
  }

  return "Untitled";
}
