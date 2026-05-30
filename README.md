<!-- mcp-name: io.github.kirvigen/notion-private-api-mcp -->

# Notion Private API MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF)](https://modelcontextprotocol.io/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

> **An unofficial Notion MCP server built on Notion's private API (`token_v2`).** It gives
> Claude Desktop, Claude Code, Cursor and any other MCP client **full read/write access to your
> entire Notion workspace — with no integration token and without sharing pages one by one.**

Unlike servers built on the official Notion API, this one authenticates with your browser
session cookie, so an LLM agent can search, read, create and edit **any** page your account can
see — instantly, with zero setup in Notion. Built on the official
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) (stdio transport).

---

## Why this server?

| | **This server** (private API) | Official Notion API / MCP |
|---|---|---|
| Setup in Notion | None — just your browser cookie | Create an integration + share each page |
| Access scope | **Everything your account can see** | Only pages explicitly shared with the integration |
| Auth | `token_v2` session cookie | Integration token / OAuth |
| Best for | Personal automation, full-workspace agents | Production apps, multi-user, official support |
| Stability | ⚠️ Fragile, undocumented | ✅ Stable, supported |

If you just want an agent over **your own** workspace without fighting integration permissions,
this is the fastest path. For production / multi-tenant apps, use the
[official Notion MCP server](https://github.com/makenotion/notion-mcp-server).

---

## Table of contents

- [Important: private API](#️-important-this-uses-notions-private-api)
- [Quick start](#quick-start)
- [Tools](#tools)
- [Configuration](#configuration)
- [Usage with MCP clients](#usage-with-mcp-clients)
- [Example prompts](#example-prompts)
- [Writing content](#writing-content)
- [Troubleshooting / FAQ](#troubleshooting--faq)
- [Contributing](#contributing)
- [License](#license) · [Disclaimer](#disclaimer)

---

## ⚠️ Important: this uses Notion's private API

This server talks to Notion's **undocumented internal API** (`https://www.notion.so/api/v3`),
**not** the official public API:

- Auth is your browser cookie (`token_v2`) — effectively your account password. **Never commit it.**
- Notion can change or break this API at any time, and using it may be against Notion's ToS.
- It is inherently fragile and **not for production** — use at your own risk, with your own data.

---

## Quick start

```bash
git clone https://github.com/kirvigen/notion-private-api-mcp.git
cd notion-private-api-mcp
npm install
export NOTION_TOKEN_V2='your_token_v2'   # see "Configuration" below
npm start
```

Then register it in your MCP client ([Claude Desktop / Claude Code](#usage-with-mcp-clients)).

---

## Tools

| Tool | Description |
|---|---|
| `get_page` | Read a page block and its metadata |
| `get_block` | Read a single block |
| `get_block_children` | Read the direct child blocks of a page or block |
| `get_style_documentation` | Catalog of supported block types & inline annotations (call before composing complex pages) |
| `markdown_to_blocks` | Preview how Markdown parses into the simplified block JSON |
| `create_page` | Create a child page under another page, from blocks or Markdown |
| `append_blocks` | Append blocks/Markdown to a page (at the end, or after a given block) |
| `replace_page_content` | Replace the direct child blocks of a page |
| `update_block_text` | Replace the plain-text content of a block (e.g. a code block) |
| `delete_blocks` | Remove (archive) direct child blocks from a page |
| `sync_markdown_file` | Create or replace a page from a local Markdown file |

> Tool parameters are defined in [`src/server.js`](src/server.js).

---

## Configuration

Configured entirely through environment variables:

| Variable | Required | Description |
|---|---|---|
| `NOTION_TOKEN_V2` | ✅ | Your Notion session cookie (`token_v2`) |
| `NOTION_PRIVATE_API_BASE` | — | API base URL (default: `https://www.notion.so`) |

### Getting your `token_v2`

1. Log in to Notion in your browser: <https://www.notion.so>
2. Open DevTools (F12) → **Application** → **Cookies** → `https://www.notion.so`
3. Copy the value of the `token_v2` cookie.

> 🔒 Treat it like a password. Keep it in your shell env or an untracked `.env` — never commit it.

```bash
cp .env.example .env   # then edit .env
```

---

## Usage with MCP clients

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notion-private": {
      "command": "node",
      "args": ["/absolute/path/to/notion-private-api-mcp/src/server.js"],
      "env": { "NOTION_TOKEN_V2": "your_token_v2" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add notion-private \
  --scope local \
  --env NOTION_TOKEN_V2='your_token_v2' \
  -- node /absolute/path/to/notion-private-api-mcp/src/server.js
```

The helper scripts `./run-desktop.sh` and `./run-codex.sh` resolve the repo path automatically
and log to `/tmp`.

---

## Example prompts

Once connected, just talk to your agent:

- *"Find my 'Q3 Roadmap' page in Notion and summarize it."*
- *"Create a child page under <page> titled 'Meeting notes' with today's action items."*
- *"Append a TODO list to <page> with these three tasks…"*
- *"Sync my local `CHANGELOG.md` into the release-notes page."*

---

## Writing content

Tools that write accept a plain-JSON **simplified block** format:

```json
[
  { "type": "heading_1", "text": "Release Notes" },
  { "type": "paragraph", "text": "First paragraph." },
  { "type": "to_do", "text": "Ship the feature", "checked": true },
  { "type": "toggle", "text": "Details", "children": [
    { "type": "bulleted_list_item", "text": "Item one" }
  ]}
]
```

Supported types: `paragraph`, `heading_1`/`2`/`3`, `bulleted_list_item`, `numbered_list_item`,
`to_do`, `toggle`, `quote`, `callout`, `code`, `divider`.

You can also pass **Markdown** (a stable subset: headings, paragraphs, bullet/numbered lists,
task items, blockquotes, fenced code, horizontal rules). Call `get_style_documentation` from your
client for the authoritative, machine-readable catalog. Nested lists, tables and inline formatting
are not implemented yet.

---

## Troubleshooting / FAQ

**Where do I get `token_v2`?** See [Getting your token_v2](#getting-your-token_v2).

**`NOTION_TOKEN_V2 is required`** — the env var isn't set in the process that launches the server
(check your MCP client's `env` block, not just your shell).

**My token stopped working** — `token_v2` expires when your Notion session ends (logout, password
change, long inactivity). Grab a fresh cookie and update it.

**`MemcachedCrossCellError`** — a transient Notion routing error on multi-cell workspaces. The
client already retries and falls back to `loadPageChunk`; just retry the call if it surfaces.

**Is this against Notion's ToS?** It uses an undocumented internal API. Use only with your own
account and data, at your own risk.

---

## Project layout

```
src/
├── server.js         # MCP server: tool registration + stdio transport
├── notion-client.js  # Private-API client (cookie auth, transactions, retries)
├── notion-blocks.js  # Builds Notion block trees from simplified blocks
├── markdown.js       # Markdown → simplified-block parser
└── style-docs.js     # Catalog returned by get_style_documentation
```

---

## Contributing

Issues and PRs are welcome. If this saved you time, please ⭐ the repo — it genuinely helps others
discover it.

---

## License

[MIT](LICENSE) © kir.vigen

## Disclaimer

Not affiliated with Notion Labs, Inc. Relies on an undocumented internal API; by using it you
accept all risks, including possible account restrictions and breakage when the API changes.
Use only with your own data.
