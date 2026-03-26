# FileIOPlugin Assessment

## Module Overview

`FileIOPlugin` provides the agent with four fundamental I/O capabilities: downloading files from the internet, reading local files, writing local files, and listing directory contents. It is designed with a security-first mindset: all local operations are strictly confined to the working directory, downloads are restricted to HTTPS from non-private hosts, and both download and read operations enforce size limits. The plugin makes heavy use of upfront validation rather than relying on error recovery.

## Interface / Exports

### `class FileIOPlugin implements AgentPlugin`

| Member | Signature | Purpose |
|---|---|---|
| `name` | `string = "FileIO"` | Plugin identifier |
| `getSystemPromptFragment()` | `() => string` | Injects tool usage guidance into the system prompt |
| `getTools()` | `() => ToolDefinition[]` | Returns four tool definitions |
| `executeTool(name, args)` | `async (name, args) => Promise<any>` | Dispatches to private implementation methods |

### Registered Tools

| Tool | Required args | Return shape |
|---|---|---|
| `download_file` | `url` | `{ path, size, contentType }` |
| `read_file` | `path` | `{ path, content, size }` |
| `write_file` | `path, content` | `{ path, size }` |
| `list_directory` | none | `{ path, entries: [{ name, type, size? }] }` |

### Module-level constants

| Constant | Value | Purpose |
|---|---|---|
| `MAX_DOWNLOAD_BYTES` | `104857600` (100 MB) | Maximum file size for `download_file` |
| `MAX_READ_BYTES` | `1048576` (1 MB) | Maximum file size for `read_file` |
| `DOWNLOADS_DIR` | `join(process.cwd(), "downloads")` | Absolute path; download destination root |
| `BASE_DIR` | `process.cwd()` | Root for local file path validation |

## Configuration

No constructor arguments. No environment variables. The plugin resolves all paths relative to `process.cwd()` at module load time (`DOWNLOADS_DIR` and `BASE_DIR` are set when the module is first imported).

## Data Flow

### `download_file`
```
url (string) → validateUrl() → fetch() with 60s timeout
  → Content-Length header check → res.arrayBuffer()
  → byte size check → Bun.write(savePath, buffer)
  → return { path, size, contentType }
```

### `read_file`
```
path (relative) → validatePath() → Bun.file(resolved)
  → size check (1 MB limit) → file.text()
  → return { path: resolved, content, size }
```

### `write_file`
```
path (relative) + content → validatePath() → Bun.write(resolved, content)
  → Bun.write creates parent directories automatically
  → return { path: resolved, size: Buffer.byteLength(content) }
```

### `list_directory`
```
path (optional, defaults to ".") → validatePath() → readdir(resolved, { withFileTypes: true })
  → for each entry: type detection + Bun.file(entryPath).size for files
  → return { path: resolved, entries }
```

## Code Paths

### URL validation (`validateUrl`)
1. Parses the URL — throws `"Invalid URL format."` if parsing fails.
2. Checks protocol is `"https:"` — throws if not.
3. Checks hostname against a blocklist:
   - `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`
   - RFC 1918 ranges: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`
   - Link-local: `169.254.x.x`
   - GCP metadata: `metadata.google.internal`
   - Suffix checks: `.internal`, `.local`

Returns the parsed `URL` object on success. Throws `Error` for any blocked address.

### Path validation (`validatePath`)
1. Resolves the input path against `BASE_DIR`.
2. Computes the relative path from `BASE_DIR` to the resolved path.
3. Throws if the relative path starts with `".."` or is absolute (i.e., outside cwd).
4. Returns the absolute resolved path.

### Download destination validation (`validateDestination`)
Same traversal check as `validatePath`, but anchored to `DOWNLOADS_DIR` rather than `BASE_DIR`. Ensures files can only be saved inside the `downloads/` subdirectory.

### `downloadFile`
1. Validates URL (re-throws with cleaner message on failure).
2. Derives filename from `destination` parameter (strips path separators with `replace(/[/\\]/g, "")`) or from URL pathname.
3. Validates the download path (must be inside `DOWNLOADS_DIR`).
4. `fetch()` with 60-second `AbortSignal.timeout`, spoofed browser `User-Agent`.
5. Checks `Content-Length` header against `MAX_DOWNLOAD_BYTES` early (before reading body).
6. Reads full body via `res.arrayBuffer()`.
7. Checks actual byte size against `MAX_DOWNLOAD_BYTES` (guards against incorrect Content-Length).
8. Writes via `Bun.write(savePath, buffer)`.

### `readFile`
1. Resolves and validates path.
2. Gets `Bun.file` handle, checks `.size` against `MAX_READ_BYTES`.
3. Returns file text content with path and size.

### `writeFile`
1. Resolves and validates path.
2. Calls `Bun.write()`, which automatically creates any missing parent directories in Bun.
3. Returns path and byte size of content.

### `listDirectory`
1. Defaults to `"."` if path is omitted.
2. Calls `readdir` with `{ withFileTypes: true }`.
3. For each `Dirent`: if file, retrieves size via `Bun.file(...).size`; if directory, omits size. Symlinks and other special types are silently skipped.

## Helper Functions / Internals

### `validateUrl(url: string): URL`
Module-level function. Throws `Error` with descriptive messages for invalid, non-HTTPS, or private/internal URLs. Returns a parsed `URL` object for valid inputs.

### `validatePath(path: string): string`
Module-level function. Throws `Error` for paths outside `BASE_DIR`. Returns the absolute resolved path for valid inputs.

### `validateDestination(destination: string): string`
Module-level function. Like `validatePath` but anchored to `DOWNLOADS_DIR`. Used only by `downloadFile`.

## Error Handling

| Scenario | Handling |
|---|---|
| Invalid URL | `validateUrl` throws; caught in `downloadFile`, re-thrown with cleaned message |
| Non-HTTPS URL | `validateUrl` throws `"Only HTTPS URLs are allowed."` |
| Private/internal host | `validateUrl` throws `"Requests to private or internal addresses are not allowed."` |
| Path outside cwd | `validatePath` / `validateDestination` throws; propagates to LLM as tool error |
| HTTP error response | `throw new Error("Download failed: server returned <status>.")` |
| File exceeds download limit (Content-Length) | `throw new Error("File exceeds the 100 MB size limit.")` before reading body |
| File exceeds download limit (actual body) | Same error after reading body |
| File exceeds read limit | `throw new Error("File exceeds the 1 MB read limit (<N> bytes).")` |
| Network timeout (download) | `AbortSignal.timeout(60_000)` causes `fetch` to throw `DOMException: AbortError` |
| `readdir` failure | Unhandled — propagates as rejection to BaseAgent error boundary |
| `Bun.write` failure | Unhandled — propagates as rejection |

Errors thrown from private methods propagate through `executeTool` and are caught by `BaseAgent`'s plugin dispatch boundary, which surfaces them as tool call errors to the LLM.

## Integration Context

**Registered in:** `src/agents/sub-agents/createSystemAgent.ts` as part of the system operations sub-agent.

```typescript
new HeadlessAgent(llm, [new ShellPlugin(), new FileIOPlugin(), new ClipboardPlugin(), new CodeSandboxPlugin()], ...)
```

**Depends on:**
- `src/core/Plugin.ts` — `AgentPlugin`, `ToolDefinition`
- `node:path` — `join`, `resolve`, `relative`, `isAbsolute`
- `node:fs/promises` — `readdir`
- Bun built-ins: `Bun.file`, `Bun.write`, `fetch`, `AbortSignal`

**Companion plugins:** `FFmpegPlugin` reads from and writes to the `downloads/` directory managed by this plugin. `YtDlpPlugin` also writes to `downloads/`. `CodeSandboxPlugin` can pass data read by this plugin via `input_data`.

## Observations / Notes

1. **Double size check for downloads:** The plugin checks `Content-Length` early (before reading the body) and again after reading `arrayBuffer()`. This is a good defense against servers that lie about content length.

2. **`Bun.write` creates parent directories automatically:** The system prompt claims `write_file` creates parent directories as needed, which is accurate for Bun's `write` API. This is a Bun-specific feature not available in the Node.js `fs` API.

3. **`write_file` size returns bytes, not characters:** `Buffer.byteLength(content)` is used, which correctly accounts for multi-byte characters.

4. **`list_directory` skips symlinks:** `entry.isFile()` and `entry.isDirectory()` both return false for symlinks. Symlinked files and directories are silently omitted from the listing with no indication to the caller.

5. **`DOWNLOADS_DIR` and `BASE_DIR` are resolved at import time:** If the working directory changes after module load (unlikely in this architecture), the constants would be stale.

6. **The `User-Agent` header spoofs a Chrome browser:** Intentional to avoid bot-rejection by servers. May cause issues if servers use the User-Agent for content negotiation.

7. **No `write_file` size limit:** Unlike `read_file` (1 MB limit), `write_file` has no upper bound. An AI agent generating large outputs can write arbitrarily large files.

8. **`read_file` checks `file.size` before reading:** `Bun.file(...).size` may return `0` for virtual filesystem entries or named pipes. Such a file would pass the size check but block or produce empty content on read.

9. **`validateUrl` does not block all SSRF vectors:** The blocklist covers the most common cases. DNS rebinding attacks or public HTTP redirectors to private IPs are not mitigated at this layer. The HTTPS-only constraint reduces but does not eliminate risk.
