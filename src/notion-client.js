import crypto from "node:crypto";
import { buildBlockTree } from "./notion-blocks.js";

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function ensureOk(response, bodyText) {
  if (response.ok) {
    return;
  }

  throw new Error(`HTTP ${response.status} ${response.statusText}: ${bodyText}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractUuid(raw) {
  const input = String(raw ?? "").trim();

  if (!input) {
    throw new Error("Notion id is required.");
  }

  const match = input.match(/([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g);
  if (!match?.length) {
    throw new Error(`Unable to extract Notion id from: ${input}`);
  }

  const compact = match[match.length - 1].replace(/-/g, "").toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function titleFromValue(value) {
  const title = value?.properties?.title;
  if (!Array.isArray(title)) {
    return "";
  }

  return title
    .map((part) => Array.isArray(part) ? part[0] : "")
    .join("")
    .trim();
}

function pageUrl(pageId) {
  return `https://www.notion.so/${extractUuid(pageId).replace(/-/g, "")}`;
}

function isCrossCellError(error) {
  return error instanceof Error
    && error.message.includes("MemcachedCrossCellError");
}

export class NotionClient {
  constructor() {
    this.token = env("NOTION_TOKEN_V2");
    this.privateApiBase = env("NOTION_PRIVATE_API_BASE", "https://www.notion.so").replace(/\/$/, "");
    // Note: the token is validated lazily (see requireToken) rather than in the
    // constructor, so the MCP server can boot and answer tools/list without it.
    // This is what registry introspection (e.g. Glama) relies on; the token is
    // only needed when a tool actually calls the Notion API.
  }

  requireToken() {
    if (!this.token) {
      throw new Error(
        "NOTION_TOKEN_V2 is required. Set it in the environment to call the Notion API.",
      );
    }
    return this.token;
  }

  normalizeId(input) {
    return extractUuid(input);
  }

  async privatePost(path, payload) {
    const token = this.requireToken();
    const response = await fetch(`${this.privateApiBase}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `token_v2=${token}`,
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    ensureOk(response, bodyText);

    return bodyText ? JSON.parse(bodyText) : {};
  }

  async privatePostWithRetry(path, payload, { retries = 2, delayMs = 250 } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await this.privatePost(path, payload);
      } catch (error) {
        lastError = error;
        if (!isCrossCellError(error) || attempt === retries) {
          throw error;
        }
        await sleep(delayMs * (attempt + 1));
      }
    }

    throw lastError;
  }

  async getRecordValues(requests) {
    return this.privatePostWithRetry("/api/v3/getRecordValues", { requests });
  }

  // loadPageChunk возвращает recordMap страницы со всеми вложенными блоками
  // одной пачкой. В отличие от getRecordValues, эта ручка маршрутизируется по
  // содержимому страницы и не упирается в MemcachedCrossCellError на multi-cell
  // workspace'ах. Используется как fallback при чтении детей.
  async loadPageChunk(pageId, { chunkNumber = 0, limit = 100, cursor = { stack: [] }, verticalColumns = false } = {}) {
    const id = this.normalizeId(pageId);
    return this.privatePostWithRetry("/api/v3/loadPageChunk", {
      pageId: id,
      chunkNumber,
      limit,
      cursor,
      verticalColumns,
    });
  }

  // Аналог getBlocks через loadPageChunk: тянет recordMap страницы пачками
  // (пока next cursor не пустой) и возвращает Map<blockId, blockValue>.
  async loadAllBlocksFromPage(pageId) {
    const blocksById = new Map();
    let cursor = { stack: [] };
    let chunkNumber = 0;
    // защита от бесконечного цикла на сломанных ответах
    for (let i = 0; i < 50; i += 1) {
      const chunk = await this.loadPageChunk(pageId, { chunkNumber, cursor });
      const blockMap = chunk?.recordMap?.block ?? {};
      for (const [blockId, entry] of Object.entries(blockMap)) {
        const value = entry?.value?.value ?? entry?.value;
        if (value?.id) {
          blocksById.set(value.id, value);
        }
      }
      const nextCursor = chunk?.cursor;
      if (!nextCursor || !Array.isArray(nextCursor.stack) || nextCursor.stack.length === 0) {
        break;
      }
      cursor = nextCursor;
      chunkNumber += 1;
    }
    return blocksById;
  }

  async submitTransaction(operations, spaceId) {
    // Modern Notion web client uses saveTransactionsFanout which requires
    // requestId + spaceId on the transaction so the backend can route the
    // write to the correct cell. Submitting to /submitTransaction without
    // this info on multi-cell workspaces triggers MemcachedCrossCellError.
    const normalizedOps = operations.map((op) => {
      if (op.pointer) {
        return op;
      }
      const { id, table, path, command, args } = op;
      return {
        pointer: spaceId ? { id, table, spaceId } : { id, table },
        path: path ?? [],
        command,
        args,
      };
    });

    const transaction = {
      id: crypto.randomUUID(),
      spaceId,
      debug: { userAction: "notion-mcp" },
      operations: normalizedOps,
    };

    return this.privatePost("/api/v3/saveTransactionsFanout", {
      requestId: crypto.randomUUID(),
      transactions: [transaction],
    });
  }

  async getBlock(blockId) {
    const id = this.normalizeId(blockId);

    try {
      const [block] = await this.getBlocks([id]);
      if (block) {
        return block;
      }
    } catch (error) {
      if (!isCrossCellError(error)) {
        throw error;
      }
      // fallthrough to loadPageChunk fallback
    }

    // Fallback: для страниц loadPageChunk возвращает recordMap,
    // включая саму страницу. Маршрутизируется на правильную ячейку,
    // поэтому работает там, где getRecordValues падает с MemcachedCrossCellError.
    try {
      const blocksById = await this.loadAllBlocksFromPage(id);
      const block = blocksById.get(id);
      if (block) {
        return block;
      }
    } catch (fallbackError) {
      if (!isCrossCellError(fallbackError)) {
        throw fallbackError;
      }
    }

    throw new Error(`Block not found or inaccessible: ${id}`);
  }

  async getBlocks(blockIds) {
    const ids = Array.from(new Set(
      (Array.isArray(blockIds) ? blockIds : [])
        .map((blockId) => this.normalizeId(blockId)),
    ));

    if (!ids.length) {
      return [];
    }

    let data;
    try {
      data = await this.getRecordValues(ids.map((id) => ({ id, table: "block" })));
    } catch (error) {
      if (!isCrossCellError(error) || ids.length === 1) {
        throw error;
      }

      const values = await Promise.all(ids.map(async (id) => {
        try {
          const result = await this.getRecordValues([{ id, table: "block" }]);
          return result?.results?.[0] ?? null;
        } catch (childError) {
          if (isCrossCellError(childError)) {
            return null;
          }
          throw childError;
        }
      }));

      data = { results: values.filter(Boolean) };
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    const valuesById = new Map(
      results
        .filter((result) => result?.value?.id)
        .map((result) => [result.value.id, result.value]),
    );

    return ids.map((id) => valuesById.get(id) ?? null);
  }

  async getBlockChildren(blockId) {
    const parent = await this.getBlock(blockId);
    const childIds = Array.isArray(parent.content) ? parent.content : [];
    const normalizedParentId = this.normalizeId(blockId);

    if (!childIds.length) {
      return { parent_id: normalizedParentId, child_ids: [], children: [] };
    }

    // Быстрый путь: getRecordValues одним запросом.
    try {
      const children = await this.getBlocks(childIds);
      const filtered = children.filter(Boolean);
      // Если cross-cell проглотил часть детей — getBlocks вернёт null'ы,
      // а filter уберёт их. Проверяем по количеству и при недоборе идём в fallback.
      if (filtered.length === childIds.length) {
        return {
          parent_id: normalizedParentId,
          child_ids: childIds,
          children: filtered,
        };
      }
      // частичный недобор — fallback ниже
    } catch (error) {
      if (!isCrossCellError(error)) {
        throw error;
      }
      // полный cross-cell — идём в fallback
    }

    // Fallback: тянем recordMap страницы целиком через loadPageChunk и
    // достаём оттуда нужные дочерние блоки.
    try {
      const blocksById = await this.loadAllBlocksFromPage(normalizedParentId);
      const children = childIds
        .map((id) => blocksById.get(this.normalizeId(id)) ?? null)
        .filter(Boolean);

      if (children.length === childIds.length) {
        return {
          parent_id: normalizedParentId,
          child_ids: childIds,
          children,
          source: "loadPageChunk",
        };
      }

      return {
        parent_id: normalizedParentId,
        child_ids: childIds,
        children,
        source: "loadPageChunk",
        warning: `loadPageChunk returned ${children.length} of ${childIds.length} child blocks. Some blocks may be on a different cell or archived.`,
      };
    } catch (fallbackError) {
      if (!isCrossCellError(fallbackError)) {
        throw fallbackError;
      }

      return {
        parent_id: normalizedParentId,
        child_ids: childIds,
        children: [],
        warning: "Notion returned MemcachedCrossCellError on both getRecordValues and loadPageChunk. Returned child ids without payloads.",
      };
    }
  }

  async getPage(pageId) {
    const id = this.normalizeId(pageId);

    const block = await this.getBlock(id);
    return {
      source: "private_api",
      page_id: id,
      url: pageUrl(id),
      title: titleFromValue(block),
      page: block,
    };
  }

  async createPage({ parentPageId, title, blocks = [] }) {
    const parent = await this.getBlock(parentPageId);
    const parentId = this.normalizeId(parentPageId);
    const spaceId = parent.space_id;
    const pageId = crypto.randomUUID();
    const now = Date.now();
    const existingContent = Array.isArray(parent.content) ? parent.content : [];
    const blockTree = buildBlockTree(blocks, pageId, spaceId);

    const pagePayload = {
      id: pageId,
      version: 1,
      type: "page",
      properties: {
        title: [[String(title ?? "Untitled")]],
      },
      content: blockTree.rootIds,
      parent_id: parentId,
      parent_table: "block",
      alive: true,
      created_time: now,
      last_edited_time: now,
      space_id: spaceId,
    };

    const operations = [
      {
        id: pageId,
        table: "block",
        path: [],
        command: "set",
        args: pagePayload,
      },
      ...blockTree.setOps,
      {
        id: parentId,
        table: "block",
        path: ["content"],
        command: "set",
        args: [...existingContent, pageId],
      },
    ];

    await this.submitTransaction(operations, spaceId);

    return {
      page_id: pageId,
      parent_page_id: parentId,
      title: String(title ?? "Untitled"),
      url: pageUrl(pageId),
      block_count: blockTree.rootIds.length,
    };
  }

  async appendBlocks({ pageId, blocks, afterBlockId }) {
    const page = await this.getBlock(pageId);
    const normalizedPageId = this.normalizeId(pageId);
    const spaceId = page.space_id;
    const existingContent = Array.isArray(page.content) ? page.content : [];
    const blockTree = buildBlockTree(blocks, normalizedPageId, spaceId);

    let nextContent;
    if (afterBlockId) {
      const normalizedAfter = this.normalizeId(afterBlockId);
      const anchorIndex = existingContent.indexOf(normalizedAfter);
      if (anchorIndex === -1) {
        throw new Error(
          `after_block_id ${normalizedAfter} is not a direct child of page ${normalizedPageId}`,
        );
      }
      nextContent = [
        ...existingContent.slice(0, anchorIndex + 1),
        ...blockTree.rootIds,
        ...existingContent.slice(anchorIndex + 1),
      ];
    } else {
      nextContent = [...existingContent, ...blockTree.rootIds];
    }

    const operations = [
      ...blockTree.setOps,
      {
        id: normalizedPageId,
        table: "block",
        path: ["content"],
        command: "set",
        args: nextContent,
      },
    ];

    await this.submitTransaction(operations, spaceId);

    return {
      page_id: normalizedPageId,
      appended_block_ids: blockTree.rootIds,
      appended_block_count: blockTree.rootIds.length,
      inserted_after: afterBlockId ? this.normalizeId(afterBlockId) : null,
    };
  }

  async replacePageContent({ pageId, blocks }) {
    const page = await this.getBlock(pageId);
    const normalizedPageId = this.normalizeId(pageId);
    const spaceId = page.space_id;
    const existingContent = Array.isArray(page.content) ? page.content : [];
    const blockTree = buildBlockTree(blocks, normalizedPageId, spaceId);

    const operations = [
      ...blockTree.setOps,
      {
        id: normalizedPageId,
        table: "block",
        path: ["content"],
        command: "set",
        args: blockTree.rootIds,
      },
      ...existingContent.map((childId) => ({
        id: childId,
        table: "block",
        path: ["alive"],
        command: "set",
        args: false,
      })),
    ];

    await this.submitTransaction(operations, spaceId);

    return {
      page_id: normalizedPageId,
      archived_block_count: existingContent.length,
      new_block_ids: blockTree.rootIds,
      new_block_count: blockTree.rootIds.length,
    };
  }

  async updateBlockText({ blockId, text }) {
    const normalizedBlockId = this.normalizeId(blockId);
    const block = await this.getBlock(normalizedBlockId);
    const spaceId = block.space_id;
    const operations = [
      {
        id: normalizedBlockId,
        table: "block",
        path: ["properties", "title"],
        command: "set",
        args: [[String(text ?? "")]],
      },
    ];
    await this.submitTransaction(operations, spaceId);
    return {
      block_id: normalizedBlockId,
      type: block.type,
      updated_text: String(text ?? ""),
    };
  }

  async deleteBlocks({ pageId, blockIds }) {
    const page = await this.getBlock(pageId);
    const normalizedPageId = this.normalizeId(pageId);
    const normalizedBlockIds = Array.from(new Set(blockIds.map((blockId) => this.normalizeId(blockId))));
    const spaceId = page.space_id;
    const existingContent = Array.isArray(page.content) ? page.content : [];
    const blockIdSet = new Set(normalizedBlockIds);
    const nextContent = existingContent.filter((childId) => !blockIdSet.has(childId));
    let warning;
    let blocks;
    try {
      blocks = await this.getBlocks(normalizedBlockIds);
    } catch (error) {
      if (!isCrossCellError(error)) {
        throw error;
      }
      blocks = [];
      warning = "Notion returned MemcachedCrossCellError while reading blocks to delete. Archived requested blocks only; nested children may remain archived=false.";
    }
    const childIds = blocks
      .filter(Boolean)
      .flatMap((block) => Array.isArray(block.content) ? block.content : [])
      .map((blockId) => this.normalizeId(blockId));
    const archivedIds = Array.from(new Set([...normalizedBlockIds, ...childIds]));

    const operations = [
      {
        id: normalizedPageId,
        table: "block",
        path: ["content"],
        command: "set",
        args: nextContent,
      },
      ...archivedIds.map((blockId) => ({
        id: blockId,
        table: "block",
        path: ["alive"],
        command: "set",
        args: false,
      })),
    ];

    await this.submitTransaction(operations, spaceId);

    return {
      page_id: normalizedPageId,
      deleted_block_ids: normalizedBlockIds,
      archived_block_ids: archivedIds,
      deleted_block_count: normalizedBlockIds.length,
      archived_block_count: archivedIds.length,
      warning,
    };
  }
}
