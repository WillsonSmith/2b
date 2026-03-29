# Assessment: TranscriptionProvider
**File:** src/providers/audio/TranscriptionProvider.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] Silent error swallowing in `transcribe` (line 62–65): The catch block logs and returns `{ text: "", noSpeechProb: 1.0 }`, making a network failure indistinguishable from genuine "no speech detected." Callers cannot tell whether silence is real or an error. Consider rethrowing or returning a discriminated result (e.g., add a `error?: string` field to `TranscriptionResult`, or throw so callers can handle it).
- [x] `noSpeechProb` defaults silently on missing segments (lines 52–59): When `data.segments` is absent or empty, `noSpeechProb` is set to `0`, implying "speech detected," which is the opposite of the safe fallback. This should default to `1.0` (no speech) when segment data is unavailable, to be consistent with the empty-buffer early return on line 18.

## Refactoring / Code Quality
- [x] Magic numbers in `createWavHeader` (lines 84–87): Sample rate (`16000`), bit depth (`16`), and channel count (`1`) are repeated inline without named constants. Define them as `private readonly` class fields or a top-level `const` object (e.g., `WAV_SAMPLE_RATE`, `WAV_BIT_DEPTH`, `WAV_CHANNELS`) so they are a single source of truth, especially since `ByteRate` and `BlockAlign` are derived from them.
- [x] Endpoint not configurable from environment (line 15): The default `http://localhost:8080/inference` is hardcoded. Per project convention (Bun auto-loads `.env`), the constructor should fall back to `process.env.WHISPER_ENDPOINT` before using the hardcoded default: `constructor(private endpoint: string = process.env.WHISPER_ENDPOINT ?? "http://localhost:8080/inference") {}`.
- [x] `TranscriptionProvider` interface is minimal but undocumented: Add a JSDoc comment to the interface explaining the expected audio format (16kHz, 16-bit mono PCM `Buffer`) so implementors know the contract without reading `WhisperLocalProvider`.

## Security
- [x] Unvalidated endpoint URL (line 15 / line 34): The `endpoint` constructor parameter is passed directly to `fetch` without URL validation. A caller could inadvertently supply a `file://` or other non-HTTP scheme, or an internal network address. Add a URL parse + scheme check (must be `http:` or `https:`) at construction time and throw if invalid.

## Performance
- [x] `Buffer.concat` copies all PCM data (line 23): For each transcription, the entire PCM buffer is copied into a new allocation to prepend the 44-byte WAV header. For large audio chunks this doubles peak memory. An alternative is to construct a single `Buffer.allocUnsafe(44 + audioBuffer.length)` and write the header fields directly into it, then copy the PCM data with `audioBuffer.copy`, avoiding a second allocation.

## Consistency / Style Alignment
- [x] Logger import uses `.ts` extension (line 1): `import { logger } from "../../logger.ts"` includes the `.ts` file extension. Check whether other modules in the project omit the extension (e.g., `../../logger`). Bun supports both, but consistency with the rest of the codebase matters. (Confirmed: `.ts` extension is used consistently across all project imports — no change needed.)
- [x] `response_format` field sent unconditionally (line 31): `verbose_json` is whisper.cpp-specific. If this provider is ever swapped out for a different backend (e.g., OpenAI-compatible endpoint), this field may cause an error. A comment noting the coupling to whisper.cpp's API would help future maintainers.

## Notes
- `WhisperLocalProvider` is the only concrete implementation of the `TranscriptionProvider` interface. Any consumers of the interface must currently import from this file, coupling them to the whisper.cpp-specific implementation details. If additional providers are added later, consider splitting the interface into its own file.
- The `noSpeechProb` bug (defaulting to `0` on missing segments) is the most impactful correctness issue — it can cause the system to treat failed/empty responses as confident speech detections.
