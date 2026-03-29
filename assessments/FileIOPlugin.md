# Assessment: FileIOPlugin
**File:** src/plugins/FileIOPlugin.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [ ] `executeTool` returns `undefined` for unknown tool names (line 144–157): The method has no final `return` statement and no fallthrough for unknown names. Per the plugin convention (plugins/CLAUDE.md), `executeTool` should explicitly `return undefined` for unrecognised names so other plugins in the chain can handle them. Currently an unknown name silently returns `undefined` by accident rather than by design, which could mask mis-spelled tool names during development.
- [ ] `listDirectory` does not handle symlinks (line 230–238): `entry.isFile()` and `entry.isDirectory()` both return `false` for symlinks, so symlinked entries are silently dropped from the result. This can produce confusing gaps in directory listings without any indication to the caller.
- [ ] `filename` from URL can be empty string after `.pop()` fallback (line 172): If `parsed.pathname` ends in `/` (e.g. `https://example.com/files/`), `.split("/").pop()` returns `""`. `validateDestination` then constructs `downloads/`, which resolves to the downloads directory itself rather than a file path, and `Bun.write` will throw or silently fail. The fallback `"download"` is only reached when `pop()` returns a falsy value; `""` is falsy, so the actual risk here is minimal — but it relies on implicit falsy coercion rather than an explicit check, making the intent unclear.

## Refactoring / Code Quality
- [ ] `readdir` imported from `node:fs/promises` (line 3): CLAUDE.md and the plugins CLAUDE.md both mandate using Bun-native APIs. `readdir` should be replaced with `Bun.readdir` (or an equivalent Bun glob/scan) to stay consistent with the rest of the codebase, which uses `Bun.file`, `Bun.write`, etc.
- [ ] `Buffer.byteLength` used in `writeFile` (line 221): `Buffer` is a Node.js API. The Bun-idiomatic equivalent is `new TextEncoder().encode(content).byteLength` or simply `Bun.write`'s return value (which returns the number of bytes written). This should be replaced to avoid a silent Node.js compatibility dependency.
- [ ] `executeTool` uses a chain of `if` statements with no `else` (lines 145–157): A `switch` statement, or at minimum an `else if` chain with a final `else { return undefined; }`, would make control flow clearer and satisfy the plugin convention explicitly.
- [ ] `downloadFile` builds the final save path by joining `DOWNLOADS_DIR` and the filename before calling `validateDestination` (line 174): `validateDestination` already calls `resolve`, so the double resolution is redundant and could create confusion if `DOWNLOADS_DIR` itself were ever relative (it is not today, but it is constructed with `join(process.cwd(), "downloads")`, which is safe).
- [ ] Magic number `60_000` in `AbortSignal.timeout` (line 177): Should be extracted into a named constant (e.g. `DOWNLOAD_TIMEOUT_MS`) alongside the other constants at the top of the file.

## Security
- [ ] SSRF: link-local and all loopback variants are blocked, but the blocklist in `validateUrl` (lines 21–33) does not cover all private IPv6 ranges (e.g. `fc00::/7`, `fe80::/10`). An attacker-controlled URL using a private IPv6 address other than `::1` would pass validation. Consider adding a check for IPv6 addresses in general, or a regex covering `fc`, `fd`, `fe80` prefixes.
- [ ] Filename sanitisation in `downloadFile` (line 171) only strips `/` and `\`. A destination such as `..` (no slashes) would pass the strip but `validateDestination` would then catch the traversal — so the overall system is safe. However, stripping only path separators is a fragile first-pass. A cleaner approach is to use `basename()` from `node:path` on the caller-supplied name, or reject any destination containing path-separator characters with an early throw, rather than silently stripping them.
- [ ] No MIME-type or extension validation on downloads: An agent could be prompted to download and later `read_file` a file saved under any name regardless of content. This is a design-level concern but worth noting — the plugin offers no guardrails against saving executable content (`.sh`, `.exe`, etc.) to the downloads directory.

## Performance
- [ ] `Bun.file(entryPath).size` inside a loop (lines 233): `Bun.file().size` is synchronous in Bun but still constructs a `BunFile` object per iteration. For large directories this creates many short-lived objects. Batching the size lookups with `Promise.all` would be more efficient, although in practice directory sizes are small enough that this is a minor concern.
- [ ] `res.arrayBuffer()` loads the entire download into memory before writing (line 193): For large files (up to 100 MB) this doubles the peak memory usage compared to a streaming write. `Bun.write(savePath, res)` can accept a `Response` directly and stream it to disk without buffering the full body in JavaScript heap.

## Consistency / Style Alignment
- [ ] `import { readdir } from "node:fs/promises"` (line 3): All other I/O in this file (and across the codebase) uses Bun-native APIs. This import breaks that consistency and contradicts the CLAUDE.md directive "Prefer `Bun.file` over `node:fs`'s readFile/writeFile".
- [ ] `args: any` type in `executeTool` (line 144): Other plugins in the codebase that have been recently assessed use typed argument objects or at minimum `Record<string, unknown>`. Using `any` disables type-checking for all tool argument access.
- [ ] Return type of `executeTool` is not annotated (line 144): The method should declare `Promise<unknown>` or a union of the concrete return types to align with the `AgentPlugin` interface contract.
- [ ] `getSystemPromptFragment` uses a template literal with a plain string body (lines 62–67): The content is correct, but minor — other plugins use consistent indentation; this one runs the entire fragment as one long un-indented block, which makes it harder to scan.

## Notes
- The overall security posture of `validateUrl` is solid for the common cases (SSRF blocklist, HTTPS-only, size limits). The IPv6 gap noted in Security is the only meaningful hole.
- `validatePath` and `validateDestination` correctly use `resolve` + `relative` + `startsWith("..")` to prevent directory traversal — this pattern is correct and consistent.
- The `downloads/` directory is never created automatically; if it does not exist, `Bun.write` to `savePath` will throw. Consider creating the directory on first use (e.g. `await Bun.mkdirSync(DOWNLOADS_DIR, { recursive: true })` in `onInit` or at the top of `downloadFile`).
- The plugin does not implement `onInit`, `getContext`, `onMessage`, `getMessages`, or `augmentResponse`. This is intentional and appropriate given its narrow scope.
- Cross-module concern: `ImageVisionPlugin` and `FFmpegPlugin` both operate on local files. If either accepts a path from the agent, they should apply the same `validatePath` guard; reviewers of those plugins should confirm this.
