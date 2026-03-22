# Utils

Shared utilities used across the codebase.

## Files

### `deviceSelector.ts`
Interactive FFmpeg device enumeration for macOS avfoundation. Prompts the user to select audio and video devices. Used by audio and vision systems at startup.

### `stream-tts.ts`
Streaming TTS pipeline using Kokoro-82M (ONNX, quantized to q8) → `TextSplitterStream` → `ffplay`. Exports `runStreamingTTS(text)` which returns the ffplay subprocess handle.

Requires `ffplay` (part of FFmpeg) to be on PATH. The Kokoro model is lazily initialized on first call and reused across invocations.
