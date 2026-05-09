# Monorepo Migration Checklist

## Target Package Structure

```
packages/
  framework/          → @2b/framework
  app-2b/             → @2b/app
  app-episteme/       → @2b/episteme
```

---

## Progress

- [ ] Step 1: Create directory scaffolding
- [ ] Step 2: Move files
- [ ] Step 3: Create per-package package.json files
- [ ] Step 4: Update root package.json
- [ ] Step 5: Refactor cross-package imports
  - [ ] packages/app-2b/2b.ts
  - [ ] packages/app-2b/src/ui/ChatSession.ts
  - [ ] packages/app-episteme/src/agent.ts
  - [ ] packages/app-episteme/src/plugins/EditorContextPlugin.ts
  - [ ] packages/app-episteme/src/plugins/WorkspacePlugin.ts
  - [ ] packages/app-episteme/src/plugins/DiagramPlugin.ts
  - [ ] packages/app-episteme/src/plugins/CitationPlugin.ts
  - [ ] packages/app-episteme/src/plugins/ResearchPlugin.ts
- [ ] Step 6: Verify — bun install, startup checks

---

## Step 2 — Move Commands

### Framework package
```bash
mv src/core      packages/framework/src/core
mv src/plugins   packages/framework/src/plugins
mv src/providers packages/framework/src/providers
mv src/memory    packages/framework/src/memory
mv src/agents    packages/framework/src/agents
mv src/utils     packages/framework/src/utils
mv src/logger.ts packages/framework/src/logger.ts
```

### 2b App package
```bash
mv 2b.ts         packages/app-2b/2b.ts
mv src/cli       packages/app-2b/src/cli
mv src/ui        packages/app-2b/src/ui
mv src/paths.ts  packages/app-2b/src/paths.ts
```
> NOTE: src/paths.ts encodes "2b" in its XDG path — belongs in app-2b, not framework.

### Episteme package
```bash
mv episteme.ts       packages/app-episteme/episteme.ts
mv src/apps/episteme packages/app-episteme/src
```

---

## Step 3 — Per-Package package.json

### packages/framework/package.json
```json
{
  "name": "@2b/framework",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*" },
  "dependencies": {
    "@lmstudio/sdk": "^1.5.0",
    "ollama": "^0.6.3",
    "zod": "^4.3.6"
  }
}
```

### packages/app-2b/package.json
```json
{
  "name": "@2b/app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "2b": "./2b.ts" },
  "dependencies": {
    "@2b/framework": "workspace:*",
    "ink": "^6.8.0",
    "ink-text-input": "^6.0.0"
  }
}
```

### packages/app-episteme/package.json
```json
{
  "name": "@2b/episteme",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@2b/framework": "workspace:*",
    "@mozilla/readability": "^0.6.0",
    "@tiptap/react": "^3.22.5",
    "jsdom": "^29.0.1",
    "mermaid": "^11.14.0",
    "react-force-graph": "^1.48.2",
    "tiptap-markdown": "^0.9.0",
    "marked": "^17.0.5"
  }
}
```

---

## Step 4 — Root package.json
```json
{
  "name": "2b-monorepo",
  "private": true,
  "workspaces": [
    "packages/framework",
    "packages/app-2b",
    "packages/app-episteme"
  ],
  "scripts": {
    "2b":       "bun packages/app-2b/2b.ts",
    "episteme": "bun packages/app-episteme/episteme.ts",
    "backup":   "bun scripts/backup.ts",
    "test":     "bun test"
  },
  "devDependencies": { "@types/bun": "latest" },
  "overrides": { "react": "19.2.5", "react-dom": "19.2.5" }
}
```

---

## Step 5 — Import Refactor Map

All relative `../../core/`, `../../plugins/`, `../../providers/` etc. from inside
packages/app-episteme become `@2b/framework/core/`, `@2b/framework/plugins/`, etc.

### packages/app-2b/2b.ts
| Before | After |
|--------|-------|
| `./src/core/CortexAgent.ts` | `@2b/framework/core/CortexAgent.ts` |
| `./src/plugins/MemoryPlugin.ts` | `@2b/framework/plugins/MemoryPlugin.ts` |
| `./src/plugins/SubAgentPlugin.ts` | `@2b/framework/plugins/SubAgentPlugin.ts` |
| `./src/core/Plugin.ts` | `@2b/framework/core/Plugin.ts` |
| `./src/agents/sub-agents/createCodebaseExplainerAgent.ts` | `@2b/framework/agents/sub-agents/createCodebaseExplainerAgent.ts` |
| `./src/plugins/ScratchPlugin.ts` | `@2b/framework/plugins/ScratchPlugin.ts` |
| `./src/plugins/BehaviorPlugin.ts` | `@2b/framework/plugins/BehaviorPlugin.ts` |
| `./src/plugins/DynamicAgentPlugin.ts` | `@2b/framework/plugins/DynamicAgentPlugin.ts` |
| `./src/plugins/FileSystemPlugin.ts` | `@2b/framework/plugins/FileSystemPlugin.ts` |
| `./src/plugins/ShellPlugin.ts` | `@2b/framework/plugins/ShellPlugin.ts` |
| `./src/plugins/VerificationPlugin.ts` | `@2b/framework/plugins/VerificationPlugin.ts` |
| `./src/plugins/RetryPlugin.ts` | `@2b/framework/plugins/RetryPlugin.ts` |
| `./src/plugins/PlanPlugin.ts` | `@2b/framework/plugins/PlanPlugin.ts` |
| `./src/plugins/DecisionPlugin.ts` | `@2b/framework/plugins/DecisionPlugin.ts` |
| `./src/ui/terminal/InkPermissionManager.ts` | stays internal `./src/ui/terminal/InkPermissionManager.ts` |
| `./src/ui/web/WebPermissionManager.ts` | stays internal `./src/ui/web/WebPermissionManager.ts` |
| `./src/ui/web/ChatSessionStore.ts` | stays internal `./src/ui/web/ChatSessionStore.ts` |
| `./src/ui/terminal/run.tsx` | stays internal `./src/ui/terminal/run.tsx` |
| `./src/ui/web/server.ts` | stays internal `./src/ui/web/server.ts` |

### packages/app-2b/src/ui/ChatSession.ts
| Before | After |
|--------|-------|
| `../core/types.ts` | `@2b/framework/core/types.ts` |

### packages/app-episteme/src/agent.ts
| Before | After |
|--------|-------|
| `../../core/CortexAgent.ts` | `@2b/framework/core/CortexAgent.ts` |
| `../../providers/llm/createProvider.ts` | `@2b/framework/providers/llm/createProvider.ts` |
| `../../plugins/FileSystemPlugin.ts` | `@2b/framework/plugins/FileSystemPlugin.ts` |
| `../../plugins/DynamicAgentPlugin.ts` | `@2b/framework/plugins/DynamicAgentPlugin.ts` |
| `../../plugins/BehaviorPlugin.ts` | `@2b/framework/plugins/BehaviorPlugin.ts` |
| `../../plugins/MemoryPlugin.ts` | `@2b/framework/plugins/MemoryPlugin.ts` |
| `../../core/PermissionManager.ts` | `@2b/framework/core/PermissionManager.ts` |

### packages/app-episteme/src/plugins/EditorContextPlugin.ts
| Before | After |
|--------|-------|
| `../../../core/Plugin.ts` | `@2b/framework/core/Plugin.ts` |

### packages/app-episteme/src/plugins/WorkspacePlugin.ts
| Before | After |
|--------|-------|
| `../../../core/Plugin.ts` | `@2b/framework/core/Plugin.ts` |
| `../../../logger.ts` | `@2b/framework/logger.ts` |

### packages/app-episteme/src/plugins/DiagramPlugin.ts
| Before | After |
|--------|-------|
| `../../../core/Plugin.ts` | `@2b/framework/core/Plugin.ts` |
| `../../../core/HeadlessAgent.ts` | `@2b/framework/core/HeadlessAgent.ts` |
| `../../../providers/llm/createProvider.ts` | `@2b/framework/providers/llm/createProvider.ts` |

### packages/app-episteme/src/plugins/CitationPlugin.ts
| Before | After |
|--------|-------|
| `../../../core/Plugin.ts` | `@2b/framework/core/Plugin.ts` |
| `../../../core/HeadlessAgent.ts` | `@2b/framework/core/HeadlessAgent.ts` |
| `../../../providers/llm/createProvider.ts` | `@2b/framework/providers/llm/createProvider.ts` |
| `../../../logger.ts` | `@2b/framework/logger.ts` |

### packages/app-episteme/src/plugins/ResearchPlugin.ts
| Before | After |
|--------|-------|
| `../../../core/Plugin.ts` | `@2b/framework/core/Plugin.ts` |
| `../../../plugins/CortexMemoryPlugin.ts` | `@2b/framework/plugins/CortexMemoryPlugin.ts` |
| `../../../core/HeadlessAgent.ts` | `@2b/framework/core/HeadlessAgent.ts` |
| `../../../providers/llm/createProvider.ts` | `@2b/framework/providers/llm/createProvider.ts` |

---

## Risk Register

### Risk 1: Electron extraResources path breaks
`src/apps/episteme/electron/package.json` bundles via `"from": "../../../../.."`.
After the move that path no longer reaches the repo root.
**Verify:** `electron-builder --mac --dir` and inspect the packaged `app/` contents.

### Risk 2: workspace:* symlink + exports map mismatch
Bun symlinks `packages/framework` into consumers' `node_modules/@2b/framework`.
The `exports` map `"./*": "./src/*"` must match import paths exactly.
**Verify:** After `bun install`, confirm the symlink exists, then run both entry points
and check for `Module not found` at startup.

### Risk 3: src/paths.ts encodes app name "2b" but is used by framework plugins
`APP_DATA_DIR` hardcodes `"2b"` in the XDG path. Originally flagged as app-specific,
but `CortexMemoryDatabase`, `PlanPlugin`, `DecisionPlugin`, and `NotesPlugin` all
import `appDataPath` from it — so it lives in `packages/framework/src/paths.ts`.
If `@2b/framework` is ever extracted for a different app, this coupling will need to
be made configurable (inject the data dir via constructor, not a module-level constant).
**Verify:** `bun packages/app-2b/2b.ts --help` exits without "Cannot find module '../paths.ts'".
