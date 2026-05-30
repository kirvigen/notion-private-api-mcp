import crypto from "node:crypto";
import { parseInlineMarkdown } from "./markdown.js";

const BLOCK_TYPE_MAP = {
  paragraph: "text",
  heading_1: "header",
  heading_2: "sub_header",
  heading_3: "sub_sub_header",
  bulleted_list_item: "bulleted_list",
  numbered_list_item: "numbered_list",
  to_do: "to_do",
  toggle: "toggle",
  quote: "quote",
  callout: "callout",
  code: "code",
  divider: "divider",
};

function titleValue(text) {
  // Code blocks store text verbatim without inline parsing.
  return [[String(text ?? "")]];
}

function richTextValue(text) {
  const runs = parseInlineMarkdown(String(text ?? ""));
  if (!runs.length) {
    return [[""]];
  }
  return runs;
}

function normalizeBlock(block) {
  if (!block || typeof block !== "object") {
    throw new Error("Each block must be an object.");
  }

  const type = block.type;
  if (!BLOCK_TYPE_MAP[type]) {
    throw new Error(`Unsupported block type: ${String(type)}`);
  }

  return {
    type,
    text: block.text ?? "",
    checked: Boolean(block.checked),
    language: block.language ?? "plain text",
    icon: block.icon ?? "💡",
    children: Array.isArray(block.children) ? block.children : [],
  };
}

function blockProperties(block) {
  switch (block.type) {
    case "divider":
      return undefined;
    case "to_do":
      return {
        title: richTextValue(block.text),
        checked: [[block.checked ? "Yes" : "No"]],
      };
    case "code":
      // Code blocks keep raw text — inline markdown shouldn't be parsed inside code.
      return {
        title: titleValue(block.text),
        language: titleValue(block.language),
      };
    default:
      return {
        title: richTextValue(block.text),
      };
  }
}

function blockFormat(block) {
  if (block.type === "callout") {
    return {
      page_icon: block.icon,
    };
  }

  return undefined;
}

function createBlockPayload({ block, id, parentId, spaceId, now, childIds }) {
  const payload = {
    id,
    version: 1,
    type: BLOCK_TYPE_MAP[block.type],
    parent_id: parentId,
    parent_table: "block",
    alive: true,
    created_time: now,
    last_edited_time: now,
    space_id: spaceId,
  };

  const properties = blockProperties(block);
  if (properties) {
    payload.properties = properties;
  }

  const format = blockFormat(block);
  if (format) {
    payload.format = format;
  }

  if (childIds.length) {
    payload.content = childIds;
  }

  return payload;
}

function walkBlocks(inputBlocks, parentId, spaceId, setOps, rootIds, depth = 0) {
  if (depth > 50) {
    throw new Error("Block nesting is too deep.");
  }

  for (const rawBlock of inputBlocks) {
    const block = normalizeBlock(rawBlock);
    const id = crypto.randomUUID();
    const childIds = [];

    if (block.children.length) {
      walkBlocks(block.children, id, spaceId, setOps, childIds, depth + 1);
    }

    const payload = createBlockPayload({
      block,
      id,
      parentId,
      spaceId,
      now: Date.now(),
      childIds,
    });

    setOps.push({
      id,
      table: "block",
      path: [],
      command: "set",
      args: payload,
    });

    rootIds.push(id);
  }
}

export function buildBlockTree(blocks, pageId, spaceId) {
  const inputBlocks = Array.isArray(blocks) ? blocks : [];
  const setOps = [];
  const rootIds = [];

  walkBlocks(inputBlocks, pageId, spaceId, setOps, rootIds);

  return {
    rootIds,
    setOps,
  };
}
