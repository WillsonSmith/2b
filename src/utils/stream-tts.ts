import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import { spawn, type Subprocess } from "bun";
import { logger } from "../logger.ts";

let ttsInstance: KokoroTTS | null = null;

export async function runStreamingTTS(text: string): Promise<Subprocess> {
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
      "1",
      "-i",
      "-",
    ],
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });

  // 2. Consume the stream (this happens in the background)
  void (async () => {
    let i = 0;
    try {
      for await (const { text: chunkText, audio } of stream) {
        if (chunkText) {
          logger.debug("TTS", `Playing chunk ${i++}: "${chunkText.trim()}"`);
        }
        if (audio) {
          // Some versions of transformers.js use .audio, others use .data
          const waveData = (audio as any).audio || (audio as any).data;
          if (waveData && ffplay.stdin) {
            ffplay.stdin.write(Buffer.from(waveData.buffer));
          }
        }
      }
    } catch (err) {
      logger.error("TTS", "Error in KokoroTTS playback stream:", err);
    } finally {
      if (ffplay.stdin) {
        ffplay.stdin.end();
      }
      logger.info("TTS", "All audio chunks generated.");
    }
  })();

  // 3. Feed text to the splitter
  const tokens = text.split(" ");
  for (const token of tokens) {
    splitter.push(token + " ");
    // Artificial delay to simulate "thinking" or slow token generation
    await new Promise((r) => setTimeout(r, 20)); // slightly faster
  }

  // 4. Signal that no more text is coming
  splitter.close();

  // Return the process immediately so it can be controlled (e.g., killed)
  return ffplay;
}
