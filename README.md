# Notion Private MCP

A minimal [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that lets
LLM agents — Claude Desktop, Claude Code, Codex, Cursor and other MCP clients — read and write
Notion pages through Notion's **private (internal) API**, authenticated with a session cookie.

Built on the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
stdio transport.

---

## ⚠️ Important: this uses Notion's private API

This server talks to Notion's **undocumented internal API** (`https://www.notion.so/api/v3`),
**not** the official public API. That means:

- Authentication is done with your browser session cookie (`token_v2`), which is effectively
  equivalent to your account password. **Never commit it.**
- Notion can change or break this API at any time without notice.
- It is inherently fragile and **not meant for production use** — use at your own risk and only
  with your own data.

---

## Features

The server exposes the following MCP tools:

| Tool | Description |
|---|---|
| `get_page` | Read a page block and its metadata |
| `get_block` | Read a single block |
| `get_block_children` | Read the direct child blocks of a page or block |
| `get_style_documentation` | Return the catalog of supported block types, inline annotations and Markdown→Notion mapping (call before composing complex pages) |
| `markdown_to_blocks` | Preview how Markdown parses into the simplified block JSON |
| `create_page` | Create a child page under another page, from blocks or Markdown |
| `append_blocks` | Append blocks/Markdown to a page (at the end, or after a given block) |
| `replace_page_content` | Replace the direct child blocks of a page |
| `update_block_text` | Replace the plain-text content of a block (e.g. a code block) |
| `delete_blocks` | Remove (archive) direct child blocks from a page |
| `sync_markdown_file` | Create or replace a page from a local Markdown file |

> Tool names, parameters and descriptions are defined in [`src/server.js`](src/server.js).

---

## Requirements

- Node.js ≥ 18
- A Notion account (the `token_v2` cookie from an active browser session)

---

## Installation

```bash
git clone https://github.com/kirvigen/notion-private-api-mcp.git
cd notion-private-api-mcp
npm install
```

---

## Configuration

The server is configured entirely through environment variables.

| Variable | Required | Description |
|---|---|---|
| `NOTION_TOKEN_V2` | yes | Your Notion session cookie (`token_v2`) |
| `NOTION_PRIVATE_API_BASE` | no | API base URL (default: `https://www.notion.so`) |

### Getting your `token_v2`

1. Log in to Notion in your browser: <https://www.notion.so>
2. Open DevTools (F12) → **Application** → **Cookies** → `https://www.notion.so`
3. Copy the value of the `token_v2` cookie.

> 🔒 Treat this value like a password. Keep it in your shell environment or an untracked `.env`
> file — never paste it into committed files.

Copy the example file and fill it in locally:

```bash
cp .env.example .env
# then edit .env
```

```env
NOTION_TOKEN_V2=
NOTION_PRIVATE_API_BASE=https://www.notion.so
```

---

## Running

```bash
export NOTION_TOKEN_V2='your_token_v2'
npm start
```

This starts the MCP server over stdio. Most users won't run it directly — they register it with
an MCP client (see below), which launches it on demand.

Helper launcher scripts are included for convenience; both resolve the repo path automatically
and log to `/tmp`:

```bash
./run-desktop.sh   # for Claude Desktop
./run-codex.sh     # for Codex
```

To syntax-check the source without running it:

```bash
npm run check
```

---

## Usage with MCP clients

### Claude Desktop

Add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notion-private": {
      "command": "node",
      "args": ["/absolute/path/to/notion-private-api-mcp/src/server.js"],
      "env": {
        "NOTION_TOKEN_V2": "your_token_v2",
        "NOTION_PRIVATE_API_BASE": "https://www.notion.so"
      }
    }
  }
}
```

Restart Claude Desktop, and the tools above will be available.

### Claude Code

```bash
claude mcp add notion-private \
  --scope local \
  --env NOTION_TOKEN_V2='your_token_v2' \
  --env NOTION_PRIVATE_API_BASE='https://www.notion.so' \
  -- node /absolute/path/to/notion-private-api-mcp/src/server.js

# verify
claude mcp list
claude mcp get notion-private
```

---

## Simplified block format

Tools that write content accept a plain-JSON "simplified block" format:

```json
{ "type": "paragraph", "text": "Hello from MCP" }
```

Supported types:

`paragraph`, `heading_1`, `heading_2`, `heading_3`, `bulleted_list_item`,
`numbered_list_item`, `to_do`, `toggle`, `quote`, `callout`, `code`, `divider`

Example with nesting:

```json
[
  { "type": "heading_1", "text": "Release Notes" },
  { "type": "paragraph", "text": "First paragraph." },
  { "type": "to_do", "text": "Ship the feature", "checked": true },
  {
    "type": "toggle",
    "text": "Details",
    "children": [
      { "type": "bulleted_list_item", "text": "Item one" },
      { "type": "bulleted_list_item", "text": "Item two" }
    ]
  }
]
```

Call `get_style_documentation` from your client to get the authoritative, machine-readable
catalog of block types and inline annotations the server can produce.

---

## Markdown support

The built-in parser supports a deliberately small, stable subset:

- headings `#`, `##`, `###`
- paragraphs
- bullet lists
- numbered lists
- task list items `- [ ]` and `- [x]`
- blockquotes
- fenced code blocks
- horizontal rules

Nested lists, tables, inline formatting and other advanced Markdown are not implemented yet.

---

## Markdown file sync workflow

A common pattern for keeping a local Markdown file in sync with a Notion page:

1. Call `sync_markdown_file` with `parent_page_id` and `title` to create a page from a new file.
2. Store the returned `page_id`.
3. On future syncs, call `sync_markdown_file` again with the same `page_id` to replace the
   page's content.

---

## Project layout

```
src/
├── server.js         # MCP server: tool registration + stdio transport
├── notion-client.js  # Private-API HTTP client (cookie auth, transactions, retries)
├── notion-blocks.js  # Builds Notion block trees from simplified blocks
├── markdown.js       # Markdown → simplified-block parser
└── style-docs.js     # Catalog returned by get_style_documentation
```

---

## Notes

- Reads and writes go through Notion's private API and are therefore inherently fragile.
- MCP transport and tool registration use the official `@modelcontextprotocol/sdk`.
- `replace_page_content` replaces only the **direct** child blocks of the target page.
- `delete_blocks` removes ids from the parent page's `content` array and marks those blocks as
  no longer alive (archived).
- Reads retry transient `MemcachedCrossCellError` responses and fall back from batched block
  reads to per-block reads (and to `loadPageChunk`) where possible.
- No third-party relay is used — your `token_v2` is sent only to Notion.

---

## License

[MIT](LICENSE)

---

## Disclaimer

This project is not affiliated with Notion Labs, Inc. and relies on an undocumented internal API.
By using it you accept all associated risks, including possible account restrictions and breakage
when the API changes. Use only with your own data.
