import { EventEmitter } from "node:events";
import { logger } from "../../logger";
import { type AudioProvider } from "./AudioProvider";
import { VoiceActivityDetector } from "./VoiceActivityDetector";
import { type TranscriptionProvider } from "./TranscriptionProvider";

// Whisper (whisper.cpp) emits this token when it detects silence with no speech.
const BLANK_AUDIO_TOKEN = "blank_audio";

export class AudioSystem extends EventEmitter {
  private isTranscribing = false;

  constructor(
    private mic: AudioProvider,
    private vad: VoiceActivityDetector,
    private transcriber: TranscriptionProvider,
  ) {
    super();

    // 1. Pipe the raw hardware audio into the VAD
    this.mic.on("audio_chunk", this.onAudioChunk);

    // 2. (Optional) Expose status events for a UI or logging
    this.vad.on("speech_started", this.onSpeechStarted);

    // 3. When the VAD determines the sentence is done, transcribe it
    this.vad.on("utterance_complete", this.onUtteranceComplete);
  }

  private onAudioChunk = (chunk: Buffer): void => {
    this.vad.processChunk(chunk);
  };

  private onSpeechStarted = (): void => {
    this.emit("status_change", "listening");
  };

  private onUtteranceComplete = async (buffer: Buffer): Promise<void> => {
    // Guard against concurrent transcription calls — drop the incoming
    // utterance if one is already in flight.
    if (this.isTranscribing) return;
    this.isTranscribing = true;
    this.emit("status_change", "transcribing");

    try {
      const result = await this.transcriber.transcribe(buffer);

      // Only emit if Whisper actually found intelligible words.
      // Trim defensively at this layer regardless of provider implementation.
      if (result.text.trim().length > 0) {
        logger.debug("AudioSystem", `Heard: "${result.text}" (Prob: ${result.noSpeechProb.toFixed(2)})`);
        if (!result.text.toLowerCase().includes(BLANK_AUDIO_TOKEN)) {
          this.emit("speech_detected", result);
        }
      }
    } catch (error) {
      logger.error("AudioSystem", "Transcription error:", error);
    } finally {
      this.isTranscribing = false;
      this.emit("status_change", "idle");
    }
  };

  public start(): void {
    this.mic.start();
    logger.info("AudioSystem", "Online and monitoring environment.");
  }

  public stop(): void {
    this.mic.stop();
    logger.info("AudioSystem", "Stopped.");
  }

  public destroy(): void {
    this.mic.off("audio_chunk", this.onAudioChunk);
    this.vad.off("speech_started", this.onSpeechStarted);
    this.vad.off("utterance_complete", this.onUtteranceComplete);
    this.removeAllListeners();
  }
}
