# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-30

### Added
- `get_style_documentation` tool — machine-readable catalog of supported block types and inline
  annotations.
- `update_block_text` tool — replace the plain-text content of a block.
- `append_blocks` support for inserting after a specific child block (`after_block_id`).
- Project metadata for MCP registry / discovery (`server.json`, `mcpName`, keywords).

### Changed
- Reworked README: value proposition, comparison with the official API, quick start, example
  prompts and troubleshooting.
- Launcher scripts (`run-desktop.sh`, `run-codex.sh`) now resolve the repo path automatically.

### Reliability
- Retry transient `MemcachedCrossCellError` responses and fall back from batched block reads to
  per-block reads and `loadPageChunk`.

[0.2.0]: https://github.com/kirvigen/notion-private-api-mcp/releases/tag/v0.2.0
