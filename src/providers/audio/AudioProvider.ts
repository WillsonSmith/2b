import { spawn } from "bun";
import { EventEmitter } from "node:events";
import { logger } from "../../logger.ts";

export class AudioProvider extends EventEmitter {
  private process: Bun.Subprocess<any, "pipe", "ignore"> | null = null;
  private stopped = false;

  // On macOS avfoundation, ":0" typically targets the default microphone
  constructor(private deviceId: string = ":0") {
    super();
  }

  private validateDeviceId(id: string): void {
    // Spaces are intentionally allowed to support device IDs like "Built-in Microphone".
    // Injection risk is low because spawn() passes arguments as an array, not a shell string.
    if (!/^[a-zA-Z0-9 \-:._]+$/.test(id)) {
      throw new Error(`Invalid device ID: "${id}"`);
    }
  }

  start(): void {
    if (this.process) return;
    this.stopped = false;
    this.validateDeviceId(this.deviceId);

    logger.info("AudioProvider", "Starting microphone stream...");

    this.process = spawn(
      [
        "ffmpeg",
        "-loglevel",
        "quiet",
        "-f",
        "avfoundation",
        "-i",
        this.deviceId,
        "-ac",
        "1", // 1 Channel (Mono)
        "-ar",
        "16000", // 16kHz Sample Rate (Required for Whisper)
        "-f",
        "s16le", // Signed 16-bit little-endian format
        "-c:a",
        "pcm_s16le", // PCM codec
        "pipe:1", // Output to stdout
      ],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );

    // Fire-and-forget: monitorStream runs for the lifetime of the ffmpeg process.
    // Errors are forwarded as EventEmitter "error" events so callers can handle them.
    this.monitorStream().catch((err) => this.emit("error", err));
  }

  stop(): void {
    if (this.process) {
      this.stopped = true;
      this.process.kill();
      this.process = null;
      logger.info("AudioProvider", "Microphone stream stopped.");
    }
  }

  private async monitorStream(): Promise<void> {
    for await (const chunk of this.process!.stdout as unknown as AsyncIterable<Uint8Array>) {
      if (this.stopped) break;
      // Convert the Uint8Array to a Node Buffer at runtime
      const nodeBuffer = Buffer.from(chunk);
      this.emit("audio_chunk", nodeBuffer);
    }
  }
}
