import { logger } from "../../logger.ts";

export interface TranscriptionResult {
  text: string;
  noSpeechProb: number;
  error?: string;
}

/**
 * Contract for audio transcription providers.
 * Implementations must accept a raw 16kHz, 16-bit mono PCM `Buffer` and
 * return the recognised text along with a no-speech probability in [0, 1].
 * A `noSpeechProb` of 1.0 indicates no speech was detected (or the
 * transcription failed); 0.0 indicates confident speech.
 */
export interface TranscriptionProvider {
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}

// WAV format constants for 16kHz, 16-bit Mono PCM
const WAV_SAMPLE_RATE = 16000;
const WAV_BIT_DEPTH = 16;
const WAV_CHANNELS = 1;
const WAV_BYTE_RATE = WAV_SAMPLE_RATE * WAV_CHANNELS * (WAV_BIT_DEPTH / 8);
const WAV_BLOCK_ALIGN = WAV_CHANNELS * (WAV_BIT_DEPTH / 8);

export class WhisperLocalProvider implements TranscriptionProvider {
  // Default endpoint for a local whisper.cpp server
  // Change this if you use a different local engine (e.g., http://localhost:8000/v1/audio/transcriptions)
  // Can also be configured via the WHISPER_ENDPOINT environment variable.
  constructor(
    private endpoint: string = process.env.WHISPER_ENDPOINT ?? "http://localhost:8080/inference",
  ) {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `WhisperLocalProvider: endpoint must use http or https, got "${parsed.protocol}"`,
      );
    }
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (audioBuffer.length === 0) return { text: "", noSpeechProb: 1.0 };

    try {
      // 1. Build a single WAV buffer (header + PCM) without double-allocating
      const wavFileBuffer = Buffer.allocUnsafe(44 + audioBuffer.length);
      this.writeWavHeader(wavFileBuffer, audioBuffer.length);
      audioBuffer.copy(wavFileBuffer, 44);

      // 2. Prepare the payload as a standard multipart form
      const formData = new FormData();

      // Bun's native Blob handles the binary translation perfectly
      const blob = new Blob([wavFileBuffer], { type: "audio/wav" });
      formData.append("file", blob, "speech.wav");
      // NOTE: response_format "verbose_json" is whisper.cpp-specific; other
      // OpenAI-compatible endpoints may not support this field.
      formData.append("response_format", "verbose_json");

      // 3. Shoot it over to the local AI
      const response = await fetch(this.endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = (await response.json()) as {
        text?: string;
        segments?: Array<{ no_speech_prob?: number }>;
      };

      // Extract text
      const text = data.text ? data.text.trim() : "";

      // Calculate average no_speech_prob from segments.
      // Default to 1.0 (no speech) when segment data is absent, so that
      // missing data does not falsely imply confident speech detection.
      let noSpeechProb = 1.0;
      if (data.segments && data.segments.length > 0) {
        const sum = data.segments.reduce(
          (acc, seg) => acc + (seg.no_speech_prob ?? 0),
          0,
        );
        noSpeechProb = sum / data.segments.length;
      }

      return { text, noSpeechProb };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Transcription", "Failed to transcribe audio:", error);
      return { text: "", noSpeechProb: 1.0, error: message };
    }
  }

  /**
   * Writes a valid 44-byte WAV header for 16kHz, 16-bit Mono PCM audio
   * directly into the first 44 bytes of `target`.
   */
  private writeWavHeader(target: Buffer, dataLength: number): void {
    // RIFF chunk descriptor
    target.write("RIFF", 0);
    target.writeUInt32LE(36 + dataLength, 4); // File size - 8
    target.write("WAVE", 8);

    // fmt sub-chunk
    target.write("fmt ", 12);
    target.writeUInt32LE(16, 16);              // Subchunk1Size (16 for PCM)
    target.writeUInt16LE(1, 20);               // AudioFormat (1 for PCM)
    target.writeUInt16LE(WAV_CHANNELS, 22);    // NumChannels
    target.writeUInt32LE(WAV_SAMPLE_RATE, 24); // SampleRate
    target.writeUInt32LE(WAV_BYTE_RATE, 28);   // ByteRate
    target.writeUInt16LE(WAV_BLOCK_ALIGN, 32); // BlockAlign
    target.writeUInt16LE(WAV_BIT_DEPTH, 34);   // BitsPerSample

    // data sub-chunk
    target.write("data", 36);
    target.writeUInt32LE(dataLength, 40);
  }
}
