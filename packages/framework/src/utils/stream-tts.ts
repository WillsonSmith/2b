import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import { spawn, type Subprocess } from "bun";
import { logger } from "../logger.ts";

// Maximum allowed input length (characters) to avoid blocking the event loop.
const MAX_TEXT_LENGTH = 10_000;

// Token-feed delay in ms. Pass 0 when text is already fully available;
// use a small positive value to simulate incremental token arrival.
const DEFAULT_TOKEN_DELAY_MS = 0;

interface AudioChunkResult {
  audio?: Float32Array;
  data?: Float32Array;
}

function extractWaveData(audio: unknown): Float32Array | null {
  const candidate = audio as AudioChunkResult;
  const waveData = candidate.audio ?? candidate.data ?? null;
  if (waveData && waveData.length > 0) {
    return waveData;
  }
  return null;
}

let ttsInstance: KokoroTTS | null = null;

export async function teardownTTS(): Promise<void> {
  ttsInstance = null;
}

export async function runStreamingTTS(
  input: string | AsyncIterable<string>,
  tokenDelayMs: number = DEFAULT_TOKEN_DELAY_MS,
): Promise<Subprocess> {
  if (!ttsInstance) {
    logger.info("TTS", "Initializing Kokoro-82M...");
    ttsInstance = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      {
        dtype: "q8",
        device: "cpu",
      },
    );
  }

  // 1. Set up the splitter and the audio stream
  const splitter = new TextSplitterStream();
  const stream = ttsInstance.stream(splitter);

  const ffplay = spawn({
    cmd: [
      "ffplay",
      "-autoexit",
      "-nodisp",
      "-f",
      "f32le",
      "-ar",
      "24000",
      "-ch_layout",
      "mono",
      "-i",
      "-",
    ],
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });

  // 2. Consume the stream (this happens in the background)
  void (async () => {
    // Guard: if ffplay failed to open stdin, close the splitter and bail.
    if (!ffplay.stdin) {
      logger.error("TTS", "ffplay stdin is unavailable — is ffplay on PATH?");
      splitter.close();
      return;
    }
    const stdin = ffplay.stdin;

    let chunkCount = 0;
    try {
      for await (const { text: chunkText, audio } of stream) {
        if (chunkText) {
          logger.debug("TTS", `Playing chunk ${chunkCount++}: "${chunkText.trim()}"`);
        }
        if (audio) {
          const waveData = extractWaveData(audio);
          if (waveData) {
            stdin.write(
              Buffer.from(waveData.buffer, waveData.byteOffset, waveData.byteLength),
            );
          }
        }
      }
    } catch (err) {
      logger.error("TTS", "Error in KokoroTTS playback stream:", err);
    } finally {
      stdin.end();
      logger.info("TTS", "All audio chunks generated.");
    }
  })();

  // 3. Feed text to the splitter
  if (typeof input === "string") {
    if (input.length > MAX_TEXT_LENGTH) {
      logger.warn("TTS", `Input truncated: ${input.length} chars exceeds limit of ${MAX_TEXT_LENGTH}`);
    }
    const safeInput = input.slice(0, MAX_TEXT_LENGTH);
    const tokens = safeInput.split(/\s+/).filter((t) => t.length > 0);
    try {
      for (const token of tokens) {
        splitter.push(token + " ");
        if (tokenDelayMs > 0) {
          await new Promise((r) => setTimeout(r, tokenDelayMs));
        }
      }
    } finally {
      // 4. Signal that no more text is coming — always close even on error
      splitter.close();
    }
  } else {
    // AsyncIterable<string> path: caller drives pacing
    try {
      for await (const token of input) {
        splitter.push(token);
      }
    } finally {
      splitter.close();
    }
  }

  // Return the process immediately so it can be controlled (e.g., killed)
  return ffplay;
}
