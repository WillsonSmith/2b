# Assessment: createMediaAgent
**File:** src/agents/sub-agents/createMediaAgent.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- No issues found.

## Refactoring / Code Quality
- [x] **System prompt does not mention `analyze_image_file` (line 11):** The system prompt says "analyze images" but the `ImageVisionPlugin` exposes two distinct tools: `analyze_image_url` and `analyze_image_file`. The other factory functions (e.g. `createSystemAgent`, `createWebAgent`) name individual capabilities explicitly in their prompts. Expanding the prompt to mention both tools avoids the LLM reaching for the URL tool when it should use the file path tool, especially after an FFmpeg operation that produces a local image.
- [x] **System prompt says "edit clips" which duplicates `download_video_clip` framing (line 11):** "Download videos, edit clips, convert formats" partially overlaps — "edit clips" is not a distinct capability, it conflates trimming/cutting (FFmpeg) with downloading (YtDlp). A more precise prompt aligned to actual plugin tools (download, trim/convert/extract/analyze) would reduce LLM ambiguity about which tool to reach for.

## Security
- No issues found.

## Performance
- [x] **`ImageVisionPlugin` is always instantiated with default parameters (line 10):** The constructor accepts `visionModel` and `baseUrl` overrides (defaulting to `google/gemma-3-4b` and `http://127.0.0.1:1234`). These are currently not configurable from the factory — if the deployment needs a different vision model, the factory must be modified. Accepting an optional config object in `createMediaAgent` (mirroring how `LMStudioProvider` accepts options in `AgentFactory.ts`) would allow callers to override the model without forking the factory. This is a low-cost future-proofing concern rather than a current defect.

## Consistency / Style Alignment
- [x] **System prompt style deviates slightly from peers (line 11):** The other sub-agent prompts follow the pattern "You are a <role> specialist. You can <list of capabilities>. <task guidance sentence>." The media agent prompt ends with "Focus on completing media tasks efficiently." which is vague. Compare with `createSystemAgent`: "Complete system-level tasks carefully and safely." — both are directional, but "carefully and safely" is more actionable for a destructive-capable agent. The media agent works with user files and external URLs and would benefit from a similar safety qualifier (e.g. "Verify file paths before editing and prefer non-destructive operations where possible.").
- [x] **Import path style (lines 1–5):** All four imports use `.ts` extensions explicitly (`../../core/HeadlessAgent.ts`, `../../providers/llm/LLMProvider.ts`, etc.). This is consistent with the rest of the codebase (all other sub-agent factories follow the same style), so no change is needed — noted for completeness.

## Notes
- The file is deliberately minimal: its sole responsibility is composing three plugins and a system prompt into a `HeadlessAgent`. That responsibility is correctly scoped.
- `AgentFactory.ts` registers this agent with no timeout options (`// No timeouts — downloads and transcodes can take arbitrarily long.`), which is appropriate given that `yt-dlp` and `ffmpeg` operations on large videos can take minutes.
- The `ImageVisionPlugin` has its own SSRF protection and path traversal guard; no additional security constraints are needed at the factory level.
- Reviewers of `ImageVisionPlugin` should note that `callVisionModel` connects to `http://127.0.0.1:1234` (plain HTTP to localhost) — this is intentional for local LM Studio usage but is worth flagging in the plugin's own assessment if a remote deployment is ever considered.
