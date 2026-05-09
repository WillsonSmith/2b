
## Project Structure

This is a Bun workspace monorepo. Source is split across four packages:

| Package | Path | Description |
|---------|------|-------------|
| `@2b/framework` | `packages/framework/` | Shared AI framework — agents, plugins, providers, memory |
| `@2b/app` | `packages/app-2b/` | 2b chat agent — CLI, web UI, entry point |
| `@2b/episteme` | `packages/app-episteme/` | Episteme editor — server, frontend, plugins |
| `@2b/electron-shell` | `packages/app-episteme/src/electron/` | Electron desktop wrapper for Episteme |

## Codebase Documentation

| Directory | CLAUDE.md |
|-----------|-----------|
| `packages/framework/src/core/` | BaseAgent, CortexAgent, CortexSubAgent, HeadlessAgent, Plugin interface, PermissionManager, types, AgentEventMap |
| `packages/framework/src/providers/llm/` | LLMProvider interface, LMStudioProvider, OllamaProvider, StructuredToolCaller |
| `packages/framework/src/agents/` | Dynamic agent pattern, orchestrator setup (`packages/app-2b/2b.ts`) |
| `packages/framework/src/agents/sub-agents/` | `createCodebaseExplainerAgent` — the one static sub-agent used by the orchestrator |
| `packages/framework/src/plugins/` | Full plugin catalog (incl. DynamicAgentPlugin, InMemoryDatabasePlugin), lifecycle, writing new plugins |
| `packages/framework/src/memory/` | MemoryProvider interface (legacy) |
| `packages/framework/src/utils/` | deviceSelector, stream-tts |
| `packages/app-2b/src/cli/` | memory-cmd |
| `packages/app-episteme/src/electron/` | Electron main process, preload, build config |

## Running

```bash
bun run 2b          # 2b chat agent (terminal UI)
bun run episteme    # Episteme server
bun run electron    # Episteme desktop app (Electron)
bun test            # all tests across all packages
```

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
