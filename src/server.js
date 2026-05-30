#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { NotionClient } from "./notion-client.js";
import { inferTitleFromMarkdown, parseMarkdownToBlocks } from "./markdown.js";
import { getStyleDocumentation } from "./style-docs.js";

const BLOCK_SCHEMA = z.object({}).catchall(z.unknown());
const BLOCKS_SCHEMA = z.array(BLOCK_SCHEMA);

function textResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function toolError(message) {
  return {
    content: [
      {
        type: "text",
        text: String(message),
      },
    ],
    isError: true,
  };
}

function pickBlocks(args, { allowEmpty = false } = {}) {
  if (Array.isArray(args.blocks)) {
    return args.blocks;
  }

  if (typeof args.markdown === "string") {
    return parseMarkdownToBlocks(args.markdown);
  }

  if (allowEmpty) {
    return [];
  }

  throw new Error("Provide either `blocks` or `markdown`.");
}

async function readMarkdownFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, "utf8");
  return {
    absolutePath,
    content,
  };
}

async function runTool(handler) {
  try {
    return await handler();
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

function buildServer() {
  const notion = new NotionClient();
  const server = new McpServer({
    name: "notion-private-mcp",
    version: "0.2.0",
  });

  server.registerTool("get_page", {
    title: "Get Notion Page",
    description: "Read a Notion page through the Notion private API.",
    inputSchema: {
      page_id: z.string().describe("Notion page id or page URL."),
    },
  }, async ({ page_id }) => runTool(async () => textResult(await notion.getPage(page_id))));

  server.registerTool("get_block", {
    title: "Get Notion Block",
    description: "Read a single Notion block through the private API.",
    inputSchema: {
      block_id: z.string().describe("Block id or block URL."),
    },
  }, async ({ block_id }) => runTool(async () => textResult({
    block_id: notion.normalizeId(block_id),
    block: await notion.getBlock(block_id),
  })));

  server.registerTool("get_block_children", {
    title: "Get Notion Block Children",
    description: "Read direct child blocks for a page or block through the private API.",
    inputSchema: {
      block_id: z.string().describe("Parent block id or page id."),
    },
  }, async ({ block_id }) => runTool(async () => textResult(
    await notion.getBlockChildren(block_id),
  )));

  server.registerTool("get_style_documentation", {
    title: "Notion Style Documentation",
    description:
      "Return the catalog of supported block types, inline annotations (bold/italic/code/link/color/mention), Markdown-to-Notion mapping and block format hints used by this MCP server. Call this before composing complex pages to know what styles you can produce.",
    inputSchema: {},
  }, async () => runTool(async () => textResult(getStyleDocumentation())));

  server.registerTool("markdown_to_blocks", {
    title: "Markdown To Blocks",
    description: "Convert Markdown into the simplified block JSON format.",
    inputSchema: {
      markdown: z.string().describe("Markdown source."),
    },
  }, async ({ markdown }) => runTool(async () => textResult({
    blocks: parseMarkdownToBlocks(markdown),
  })));

  server.registerTool("create_page", {
    title: "Create Notion Page",
    description: "Create a child page under another page from blocks or Markdown.",
    inputSchema: {
      parent_page_id: z.string().describe("Parent page id or page URL."),
      title: z.string().describe("Title for the new page."),
      markdown: z.string().optional().describe("Markdown content to convert into blocks."),
      blocks: BLOCKS_SCHEMA.optional().describe("Simplified block JSON."),
    },
  }, async (args) => runTool(async () => textResult(
    await notion.createPage({
      parentPageId: args.parent_page_id,
      title: args.title,
      blocks: pickBlocks(args, { allowEmpty: true }),
    }),
  )));

  server.registerTool("append_blocks", {
    title: "Append Blocks",
    description: "Append simplified blocks or Markdown to a page. Inserts at the end by default; pass after_block_id to insert immediately after a specific direct child block.",
    inputSchema: {
      page_id: z.string().describe("Page id or page URL."),
      markdown: z.string().optional().describe("Markdown content to convert into blocks."),
      blocks: BLOCKS_SCHEMA.optional().describe("Simplified block JSON."),
      after_block_id: z.string().optional().describe("Optional id of an existing direct child block; new blocks are inserted immediately after it. Must be a direct child of page_id."),
    },
  }, async (args) => runTool(async () => textResult(
    await notion.appendBlocks({
      pageId: args.page_id,
      blocks: pickBlocks(args),
      afterBlockId: args.after_block_id,
    }),
  )));

  server.registerTool("replace_page_content", {
    title: "Replace Page Content",
    description: "Replace direct child blocks of a page with blocks or Markdown.",
    inputSchema: {
      page_id: z.string().describe("Page id or page URL."),
      markdown: z.string().optional().describe("Markdown content to convert into blocks."),
      blocks: BLOCKS_SCHEMA.optional().describe("Simplified block JSON."),
    },
  }, async (args) => runTool(async () => textResult(
    await notion.replacePageContent({
      pageId: args.page_id,
      blocks: pickBlocks(args),
    }),
  )));

  server.registerTool("delete_blocks", {
    title: "Delete Blocks",
    description: "Remove direct child blocks from a page and archive those blocks.",
    inputSchema: {
      page_id: z.string().describe("Parent page id or page URL."),
      block_ids: z.array(z.string()).min(1).describe("Block ids or block URLs to remove from the page."),
    },
  }, async (args) => runTool(async () => textResult(
    await notion.deleteBlocks({
      pageId: args.page_id,
      blockIds: args.block_ids,
    }),
  )));

  server.registerTool("update_block_text", {
    title: "Update Block Text",
    description: "Replace the plain text content of a block (e.g. code block). Inline markdown is NOT parsed — text is stored verbatim.",
    inputSchema: {
      block_id: z.string().describe("Block id or block URL."),
      text: z.string().describe("New plain text content for the block."),
    },
  }, async (args) => runTool(async () => textResult(
    await notion.updateBlockText({
      blockId: args.block_id,
      text: args.text,
    }),
  )));

  server.registerTool("sync_markdown_file", {
    title: "Sync Markdown File",
    description: "Create a new page or replace an existing page from a local Markdown file.",
    inputSchema: {
      file_path: z.string().describe("Absolute or relative Markdown file path."),
      page_id: z.string().optional().describe("Existing page id to replace."),
      parent_page_id: z.string().optional().describe("Parent page id when creating a new page."),
      title: z.string().optional().describe("Optional page title override."),
    },
  }, async (args) => runTool(async () => {
    const file = await readMarkdownFile(args.file_path);
    const blocks = parseMarkdownToBlocks(file.content);

    if (args.page_id) {
      const result = await notion.replacePageContent({
        pageId: args.page_id,
        blocks,
      });

      return textResult({
        ...result,
        file_path: file.absolutePath,
        title: inferTitleFromMarkdown(file.content, file.absolutePath),
      });
    }

    if (!args.parent_page_id) {
      throw new Error("`parent_page_id` is required when `page_id` is not provided.");
    }

    const title = args.title || inferTitleFromMarkdown(file.content, file.absolutePath);
    const result = await notion.createPage({
      parentPageId: args.parent_page_id,
      title,
      blocks,
    });

    return textResult({
      ...result,
      file_path: file.absolutePath,
    });
  }));

  return server;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Notion MCP server error:", error);
  process.exit(1);
});
