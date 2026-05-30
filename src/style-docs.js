// Reference catalog of styles supported by this MCP when converting Markdown
// (or simplified block JSON) into Notion's private v3 block format.
//
// The data here is derived from inspecting real Notion pages in the workspace
// (see Managed SDK Android page). It describes two layers:
//   1) Block-level types you can put into `blocks[]` or write in Markdown.
//   2) Inline rich-text annotations (the second element of each [text, attrs]
//      tuple inside a `title` / property value).
//
// This is intentionally a static document — it does not hit the network, so
// callers can rely on it without Notion availability.

export const STYLE_DOCUMENTATION = {
  overview:
    "Notion private-API blocks. Each block has a `type`, optional `properties` (rich text), and optional `format`. Rich text is an array of runs: each run is [text] or [text, [[tag, ...args]]]. Multiple annotation tuples can stack on a single run.",

  block_types: [
    {
      type: "paragraph",
      notion_type: "text",
      markdown: "Plain line (no prefix).",
      example_markdown: "Обычный текст параграфа.",
      notes: "Default block when no other pattern matches.",
    },
    {
      type: "heading_1",
      notion_type: "header",
      markdown: "# Heading",
      example_markdown: "# Заголовок верхнего уровня",
    },
    {
      type: "heading_2",
      notion_type: "sub_header",
      markdown: "## Heading",
      example_markdown: "## Подзаголовок",
    },
    {
      type: "heading_3",
      notion_type: "sub_sub_header",
      markdown: "### Heading",
      example_markdown: "### Мелкий заголовок",
    },
    {
      type: "bulleted_list_item",
      notion_type: "bulleted_list",
      markdown: "- item  (or `*` / `+`)",
      example_markdown: "- Первый пункт\n- Второй пункт",
    },
    {
      type: "numbered_list_item",
      notion_type: "numbered_list",
      markdown: "1. item",
      example_markdown: "1. Шаг один\n2. Шаг два",
    },
    {
      type: "to_do",
      notion_type: "to_do",
      markdown: "- [ ] unchecked / - [x] checked",
      example_markdown: "- [ ] Сделать\n- [x] Готово",
    },
    {
      type: "quote",
      notion_type: "quote",
      markdown: "> quoted line",
      example_markdown: "> Цитата или вводный текст.",
    },
    {
      type: "code",
      notion_type: "code",
      markdown: "Triple-backtick fence with optional language.",
      example_markdown: "```kotlin\nfun hello() = println(\"hi\")\n```",
      notes:
        "Content is stored verbatim, inline markdown is NOT parsed inside code blocks. Language goes to properties.language.",
    },
    {
      type: "divider",
      notion_type: "divider",
      markdown: "--- or *** on its own line",
      example_markdown: "---",
    },
    {
      type: "callout",
      notion_type: "callout",
      markdown: "Not produced by Markdown parser — pass via `blocks[]`.",
      example_blocks: [{ type: "callout", text: "Важно!", icon: "⚠️" }],
    },
    {
      type: "toggle",
      notion_type: "toggle",
      markdown: "Not produced by Markdown parser — pass via `blocks[]` with `children`.",
      example_blocks: [
        {
          type: "toggle",
          text: "Подробнее",
          children: [{ type: "paragraph", text: "Скрытый контент." }],
        },
      ],
    },
  ],

  inline_annotations: [
    {
      tag: "b",
      meaning: "bold",
      markdown: "**text** or __text__",
      run_example: ["bold text", [["b"]]],
    },
    {
      tag: "i",
      meaning: "italic",
      markdown: "*text* or _text_",
      run_example: ["italic", [["i"]]],
    },
    {
      tag: "s",
      meaning: "strikethrough",
      markdown: "~~text~~  (currently only via `blocks[]`, Markdown parser does not emit `s` yet)",
      run_example: ["struck", [["s"]]],
    },
    {
      tag: "_",
      meaning: "underline",
      markdown: "Not available in Markdown — pass a run like ['text', [['_']]] via `blocks[]`.",
      run_example: ["underlined", [["_"]]],
    },
    {
      tag: "c",
      meaning: "inline code",
      markdown: "`text`",
      run_example: ["SdkManaged.init(...)", [["c"]]],
    },
    {
      tag: "a",
      meaning: "link",
      markdown: "[text](https://example.com)",
      run_example: ["дока", [["a", "https://example.com"]]],
      notes: "The href is the second element of the tuple. Can stack with b/i/c.",
    },
    {
      tag: "h",
      meaning: "color / background highlight",
      markdown: "Not available in Markdown — pass via `blocks[]`.",
      run_example: ["важно", [["h", "red_background"]]],
      allowed_values: [
        "default",
        "gray",
        "brown",
        "orange",
        "yellow",
        "teal",
        "blue",
        "purple",
        "pink",
        "red",
        "gray_background",
        "brown_background",
        "orange_background",
        "yellow_background",
        "teal_background",
        "blue_background",
        "purple_background",
        "pink_background",
        "red_background",
      ],
    },
    {
      tag: "m",
      meaning: "mention (page / user / date)",
      run_example: ["Managed SDK", [["m", "<notion-page-id>"]]],
      notes:
        "Second element is the referenced entity id (page/block/user/date). Notion renders it as a clickable chip.",
    },
    {
      tag: "e",
      meaning: "inline equation (LaTeX)",
      run_example: ["⁍", [["e", "a^2 + b^2 = c^2"]]],
    },
    {
      tag: "d",
      meaning: "date / datetime",
      run_example: [
        "‣",
        [["d", { type: "date", start_date: "2026-04-19" }]],
      ],
    },
  ],

  annotation_stacking: {
    description: "Multiple annotations can be applied to a single run. Order within the tuple is preserved by Notion.",
    example: [
      "жирная ссылка",
      [["b"], ["a", "https://example.com"]],
    ],
  },

  block_format_hints: [
    {
      block: "code",
      keys: ["code_wrap: boolean"],
      note: "Controls horizontal wrapping in the code block UI.",
    },
    {
      block: "callout",
      keys: ["page_icon: string"],
      note: "Emoji shown as the callout icon.",
    },
    {
      block: "table",
      keys: [
        "table_block_column_order: string[]",
        "table_block_column_header: boolean",
        "table_block_row_header: boolean",
      ],
      note: "Tables are not produced by the Markdown parser — they require composing `table` + child `table_row` blocks manually.",
    },
  ],

  markdown_supported_inline: ["**bold**", "__bold__", "*italic*", "_italic_", "`code`", "[text](url)", "escaped \\*"],

  markdown_unsupported_currently: [
    "~~strikethrough~~ (not emitted)",
    "images ![alt](url) (not emitted — use `blocks[]` or Notion UI)",
    "tables | a | b | (not emitted)",
    "nested lists (flattened to the same level)",
    "colors / highlights (pass via `blocks[]`)",
  ],

  examples: {
    markdown_full: [
      "# Заголовок",
      "",
      "Параграф с **жирным**, *курсивом* и `кодом`, а также [ссылкой](https://example.com).",
      "",
      "## Список",
      "- Пункт **важный**",
      "- [x] Выполнено",
      "",
      "> Цитата.",
      "",
      "```kotlin",
      "fun hello() = println(\"hi\")",
      "```",
      "",
      "---",
    ].join("\n"),

    blocks_json_with_color: [
      {
        type: "paragraph",
        // When passing `blocks[]` directly, `text` is still parsed for inline
        // markdown, so combine it with pre-built rich-text via `runs` if you
        // need colors. A simpler path: author as Markdown and post-edit.
        text: "Обычный текст, затем цветной фрагмент через blocks[] + h.",
      },
    ],
  },
};

export function getStyleDocumentation() {
  return STYLE_DOCUMENTATION;
}
