import { EventEmitter } from "node:events";

export type VADConfig = {
  energyThreshold?: number; // Volume required to trigger "speech"
  silenceDurationMs?: number; // How long to wait during a pause before cutting
  maxBufferBytes?: number; // Safety cap — emit utterance early if buffer exceeds this size
  debug?: boolean; // Log VAD state transitions to stderr
};

export class VoiceActivityDetector extends EventEmitter {
  private isRecording = false;
  private audioBuffer: Buffer[] = [];
  private totalBytes = 0; // Running byte count for efficient concat
  private silenceTimer: ReturnType<typeof setTimeout> | null = null; // setTimeout handle

  // Tuning parameters
  private threshold: number;
  private silenceDuration: number;
  private maxBufferBytes: number;
  private debug: boolean;

  constructor(config?: VADConfig) {
    super();
    // These defaults usually work well for a quiet room, but may need tuning
    this.threshold = config?.energyThreshold ?? 500;
    this.silenceDuration = config?.silenceDurationMs ?? 1500; // 1.5 seconds of silence
    // ~60 s of s16le mono at 16 kHz = 1,920,000 bytes
    this.maxBufferBytes = config?.maxBufferBytes ?? 1_920_000;
    this.debug = config?.debug ?? false;
  }

  /**
   * Feed raw s16le audio chunks into this method.
   */
  public processChunk(chunk: Buffer) {
    if (!chunk || chunk.length === 0) return;

    const energy = this.calculateEnergy(chunk);

    if (energy > this.threshold) {
      this.handleSpeech(chunk);
    } else {
      this.handleSilence(chunk);
    }
  }

  /**
   * Cancel any in-progress utterance and reset all state.
   * Call this when the input stream ends prematurely.
   */
  public reset() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.isRecording = false;
    this.audioBuffer = [];
    this.totalBytes = 0;
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
      if (this.debug) process.stderr.write("[VAD] Recording started...\n");
    }

    this.audioBuffer.push(chunk);
    this.totalBytes += chunk.length;

    // Safety cap: emit early if the buffer exceeds the maximum allowed size
    if (this.totalBytes >= this.maxBufferBytes) {
      if (this.debug) process.stderr.write("[VAD] Max buffer size reached — emitting early.\n");
      this.completeUtterance();
    }
  }

  private handleSilence(chunk: Buffer) {
    if (!this.isRecording) return; // Ignore background silence

    // Keep accumulating the silence so the end of the word isn't abruptly clipped
    this.audioBuffer.push(chunk);
    this.totalBytes += chunk.length;

    // If a timer isn't already running, start one
    if (!this.silenceTimer) {
      this.emit("speech_ended");
      if (this.debug) process.stderr.write("[VAD] Silence detected — waiting to cut...\n");
      this.silenceTimer = setTimeout(() => {
        this.completeUtterance();
      }, this.silenceDuration);
    }
  }

  private completeUtterance() {
    this.isRecording = false;
    // silenceTimer has already fired (or was cleared by reset/max-cap path) — null it out defensively
    this.silenceTimer = null;

    // Combine all the little chunks into one big audio buffer using pre-tracked size
    const finalBuffer = Buffer.allocUnsafe(this.totalBytes);
    let offset = 0;
    for (const chunk of this.audioBuffer) {
      chunk.copy(finalBuffer, offset);
      offset += chunk.length;
    }

    // Reset for the next sentence
    this.audioBuffer = [];
    this.totalBytes = 0;

    if (this.debug) process.stderr.write(`[VAD] Utterance complete. Size: ${finalBuffer.length} bytes\n`);

    // Send it off to be transcribed!
    this.emit("utterance_complete", finalBuffer);
  }

  /**
   * Calculates the Root Mean Square (RMS) energy of a 16-bit PCM buffer.
   * Expects an even-length buffer of s16le samples; odd trailing bytes are ignored.
   */
  private calculateEnergy(buffer: Buffer): number {
    if (buffer.length === 0) return 0;

    let sumSquares = 0;
    // Use Math.floor to safely handle odd-length buffers — last partial byte is skipped
    const sampleCount = Math.floor(buffer.length / 2);

    for (let i = 0; i < sampleCount * 2; i += 2) {
      // Read the 16-bit integer
      const sample = buffer.readInt16LE(i);
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }
}
