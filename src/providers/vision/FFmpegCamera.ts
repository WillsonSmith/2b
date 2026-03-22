import { EventEmitter } from "node:events";
import { type FrameProvider } from "./types.ts";
import { logger } from "../../logger.ts";
export class FFmpegCamera extends EventEmitter implements FrameProvider {
  private process: any = null;

  constructor(
    private deviceId: string = "0",
    private fps: number = 1,
  ) {
    super();
  }

  private validateDeviceId(id: string): void {
    if (!/^[a-zA-Z0-9 \-:._]+$/.test(id)) {
      throw new Error(`Invalid device ID: "${id}"`);
    }
  }

  start() {
    this.validateDeviceId(this.deviceId);
    this.process = Bun.spawn(
      [
        "ffmpeg",
        "-loglevel",
        "quiet",
        "-f",
        "avfoundation",
        "-framerate",
        "30",
        "-i",
        this.deviceId,
        "-vf",
        `fps=${this.fps}`,
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ],
      { stderr: "ignore" },
    );

    this.monitorStream();
  }

  stop() {
    if (this.process) this.process.kill();
  }

  private async monitorStream() {
    let buffer = Buffer.alloc(0);
    const MAX_BUFFER = 1024 * 1024 * 10; // 10MB safety limit

    for await (const chunk of this.process.stdout) {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length > MAX_BUFFER) {
        logger.warn("Camera", "Buffer exceeded limit, clearing malformed data.");
        buffer = Buffer.alloc(0);
        continue;
      }

      const soi = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      const eoi = buffer.indexOf(Buffer.from([0xff, 0xd9]));

      if (soi !== -1 && eoi !== -1 && eoi > soi) {
        const frame = buffer.subarray(soi, eoi + 2);
        buffer = buffer.subarray(eoi + 2);
        this.emit("frame", frame);
      }
    }
  }
}
