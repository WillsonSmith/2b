import { InputSource } from "../../core/InputSource.ts";
import { AudioProvider } from "../../providers/audio/AudioProvider.ts";
import { AudioSystem } from "../../providers/audio/AudioSystem.ts";
import { WhisperLocalProvider } from "../../providers/audio/TranscriptionProvider.ts";
import { VoiceActivityDetector } from "../../providers/audio/VoiceActivityDetector.ts";
import { selectAudioDevice } from "../../utils/deviceSelector.ts";
import { logger } from "../../logger.ts";

export interface MicrophoneInputSourceOptions {
  energyThreshold?: number;
  /** Minimum noSpeechProbability to discard a transcription. Default: 0.7 */
  noSpeechThreshold?: number;
  /** If true, ambient sound markers are silently dropped instead of emitted. Default: false */
  ignoreAmbient?: boolean;
}

/**
 * Captures microphone audio, transcribes it via Whisper, and emits input events.
 * All recognized speech is treated as direct input (requires a response).
 * Whisper ambient markers (e.g. "[BLANK_AUDIO]") are emitted as ambient_input.
 *
 * For intent classification (directed vs. overheard), use AudioPlugin instead.
 */
export class MicrophoneInputSource extends InputSource {
  name = "Microphone";
  private audioSystem?: AudioSystem;

  constructor(private options: MicrophoneInputSourceOptions = {}) {
    super();
  }

  async start() {
    this.audioSystem = new AudioSystem(
      new AudioProvider(await selectAudioDevice()),
      new VoiceActivityDetector({
        energyThreshold: this.options.energyThreshold ?? 500,
        silenceDurationMs: 5000,
      }),
      new WhisperLocalProvider(),
    );

    this.audioSystem.on(
      "speech_detected",
      (result: { text: string; noSpeechProb: number }) => {
        this.handleSpeech(result);
      },
    );

    this.audioSystem.start();
    logger.info("Microphone", "Online and monitoring.");
  }

  async stop() {
    this.audioSystem?.stop();
  }

  private handleSpeech(result: { text: string; noSpeechProb: number }) {
    const { text, noSpeechProb } = result;

    // Whisper ambient sound markers, e.g. "[BLANK_AUDIO]", "(music)"
    const isAmbientMarker =
      (text.startsWith("[") && text.endsWith("]")) ||
      (text.startsWith("(") && text.endsWith(")"));

    if (isAmbientMarker) {
      if (!this.options.ignoreAmbient) {
        this.emit("ambient_input", `[Ambient sound: ${text}]`);
      }
      return;
    }

    const threshold = this.options.noSpeechThreshold ?? 0.7;
    if (noSpeechProb > threshold) {
      logger.debug("Microphone", "Sound was not speech, skipping.");
      return;
    }

    logger.info("Microphone", `Heard: ${text}`);
    this.emit("direct_input", text);
  }
}
