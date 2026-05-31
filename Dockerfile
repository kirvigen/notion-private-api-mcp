# Notion Private API MCP server — stdio transport
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY src ./src
COPY server.json README.md LICENSE ./

ENV NODE_ENV=production

# The server speaks MCP over stdio. NOTION_TOKEN_V2 is required at tool-call
# time (not at startup), so the server still boots and answers tools/list
# without it — which is what registry introspection checks rely on.
ENTRYPOINT ["node", "src/server.js"]
