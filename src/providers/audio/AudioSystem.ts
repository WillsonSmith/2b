import { EventEmitter } from "node:events";
import { logger } from "../../logger.ts";
import { AudioProvider } from "./AudioProvider";
import { VoiceActivityDetector } from "./VoiceActivityDetector";
import { type TranscriptionProvider } from "./TranscriptionProvider";

export class AudioSystem extends EventEmitter {
  constructor(
    private mic: AudioProvider,
    private vad: VoiceActivityDetector,
    private transcriber: TranscriptionProvider,
  ) {
    super();

    // 1. Pipe the raw hardware audio into the math engine
    this.mic.on("audio_chunk", (chunk: Buffer) => {
      this.vad.processChunk(chunk);
    });

    // 2. (Optional) Expose status events for a UI or logging
    this.vad.on("speech_started", () => {
      this.emit("status_change", "listening");
    });

    // 3. When the math engine determines the sentence is done, transcribe it
    this.vad.on("utterance_complete", async (buffer: Buffer) => {
      this.emit("status_change", "transcribing");

      try {
        const result = await this.transcriber.transcribe(buffer);

        // Only emit if Whisper actually found intelligible words
        if (result.text && result.text.length > 0) {
          logger.debug("AudioSystem", `Heard: "${result.text}" (Prob: ${result.noSpeechProb.toFixed(2)})`);
          if (!result.text.toLowerCase().includes("blank_audio")) {
            this.emit("speech_detected", result);
          }
        }
      } catch (error) {
        logger.error("AudioSystem", "Transcription error:", error);
      } finally {
        this.emit("status_change", "idle");
      }
    });
  }

  public start() {
    this.mic.start();
    logger.info("AudioSystem", "Online and monitoring environment.");
  }

  public stop() {
    this.mic.stop();
  }
}
