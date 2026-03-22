import { logger } from "../../logger.ts";

export interface TranscriptionResult {
  text: string;
  noSpeechProb: number;
}

export interface TranscriptionProvider {
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}

export class WhisperLocalProvider implements TranscriptionProvider {
  // Default endpoint for a local whisper.cpp server
  // Change this if you use a different local engine (e.g., http://localhost:8000/v1/audio/transcriptions)
  constructor(private endpoint: string = "http://localhost:8080/inference") {}

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (audioBuffer.length === 0) return { text: "", noSpeechProb: 1.0 };

    try {
      // 1. Prepend the WAV header to the raw PCM data
      const wavHeader = this.createWavHeader(audioBuffer.length);
      const wavFileBuffer = Buffer.concat([wavHeader, audioBuffer]);

      // 2. Prepare the payload as a standard multipart form
      const formData = new FormData();

      // Bun's native Blob handles the binary translation perfectly
      const blob = new Blob([wavFileBuffer], { type: "audio/wav" });
      formData.append("file", blob, "speech.wav");
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

      // Calculate average no_speech_prob from segments, or default to 0
      let noSpeechProb = 0;
      if (data.segments && data.segments.length > 0) {
        const sum = data.segments.reduce(
          (acc, seg) => acc + (seg.no_speech_prob ?? 0),
          0,
        );
        noSpeechProb = sum / data.segments.length;
      }

      return { text, noSpeechProb };
    } catch (error) {
      logger.error("Transcription", "Failed to transcribe audio:", error);
      return { text: "", noSpeechProb: 1.0 };
    }
  }

  /**
   * Generates a valid 44-byte WAV header for 16kHz, 16-bit Mono PCM audio.
   */
  private createWavHeader(dataLength: number): Buffer {
    const buffer = Buffer.alloc(44);

    // RIFF chunk descriptor
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataLength, 4); // File size - 8
    buffer.write("WAVE", 8);

    // fmt sub-chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
    buffer.writeUInt16LE(1, 22); // NumChannels (1: Mono)
    buffer.writeUInt32LE(16000, 24); // SampleRate (16kHz)
    buffer.writeUInt32LE(16000 * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    buffer.writeUInt16LE(2, 32); // BlockAlign (NumChannels * BitsPerSample/8)
    buffer.writeUInt16LE(16, 34); // BitsPerSample (16-bit)

    // data sub-chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataLength, 40);

    return buffer;
  }
}
