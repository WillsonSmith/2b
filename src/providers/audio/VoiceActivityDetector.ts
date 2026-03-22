import { EventEmitter } from "node:events";

export type VADConfig = {
  energyThreshold?: number; // Volume required to trigger "speech"
  silenceDurationMs?: number; // How long to wait during a pause before cutting
};

export class VoiceActivityDetector extends EventEmitter {
  private isRecording = false;
  private audioBuffer: Buffer[] = [];
  private silenceTimer: Timer | null = null;

  // Tuning parameters
  private threshold: number;
  private silenceDuration: number;

  constructor(config?: VADConfig) {
    super();
    // These defaults usually work well for a quiet room, but may need tuning
    this.threshold = config?.energyThreshold ?? 500;
    this.silenceDuration = config?.silenceDurationMs ?? 1500; // 1.5 seconds of silence
  }

  /**
   * Feed raw s16le audio chunks into this method.
   */
  public processChunk(chunk: Buffer) {
    const energy = this.calculateEnergy(chunk);

    if (energy > this.threshold) {
      this.handleSpeech(chunk);
    } else {
      this.handleSilence(chunk);
    }
  }

  private handleSpeech(chunk: Buffer) {
    // If we were waiting to cut the audio, cancel the cut! They are still talking.
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (!this.isRecording) {
      this.isRecording = true;
      this.emit("speech_started");
      // Optional debug: console.log("[VAD] Recording started...");
    }

    this.audioBuffer.push(chunk);
  }

  private handleSilence(chunk: Buffer) {
    if (!this.isRecording) return; // Ignore background silence

    // Keep accumulating the silence so the end of the word isn't abruptly clipped
    this.audioBuffer.push(chunk);

    // If a timer isn't already running, start one
    if (!this.silenceTimer) {
      this.silenceTimer = setTimeout(() => {
        this.completeUtterance();
      }, this.silenceDuration);
    }
  }

  private completeUtterance() {
    this.isRecording = false;
    this.silenceTimer = null;

    // Combine all the little chunks into one big audio file
    const finalBuffer = Buffer.concat(this.audioBuffer);
    this.audioBuffer = []; // Reset for the next sentence

    // Optional debug: console.log(`[VAD] Utterance complete. Size: ${finalBuffer.length} bytes`);

    // Send it off to be transcribed!
    this.emit("utterance_complete", finalBuffer);
  }

  /**
   * Calculates the Root Mean Square (RMS) energy of a 16-bit PCM buffer.
   */
  private calculateEnergy(buffer: Buffer): number {
    let sumSquares = 0;
    const sampleCount = buffer.length / 2; // 2 bytes per 16-bit sample

    for (let i = 0; i < buffer.length; i += 2) {
      // Read the 16-bit integer
      const sample = buffer.readInt16LE(i);
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }
}
