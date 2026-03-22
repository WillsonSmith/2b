import { spawn } from "bun";
import { EventEmitter } from "node:events";
import { logger } from "../../logger.ts";

export class AudioProvider extends EventEmitter {
  private process: any = null;

  // On macOS avfoundation, ":0" typically targets the default microphone
  constructor(private deviceId: string = ":0") {
    super();
  }

  private validateDeviceId(id: string): void {
    if (!/^[a-zA-Z0-9 \-:._]+$/.test(id)) {
      throw new Error(`Invalid device ID: "${id}"`);
    }
  }

  start() {
    if (this.process) return;
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
        stderr: "ignore",
      },
    );

    this.monitorStream();
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      logger.info("AudioProvider", "Microphone stream stopped.");
    }
  }

  private async monitorStream() {
    for await (const chunk of this.process.stdout) {
      // Convert the Uint8Array to a Node Buffer at runtime
      const nodeBuffer = Buffer.from(chunk);
      this.emit("audio_chunk", nodeBuffer);
    }
  }
}
