import { EventEmitter } from "events";
import type { FrameProvider } from "./types";
import { logger } from "../../logger.ts";

export class CameraVisionSystem extends EventEmitter {
  isProcessingFrame: boolean = false;
  currentFrame: Buffer | undefined;
  constructor(private provider: FrameProvider) {
    super();

    this.provider.on("frame", async (frame: Buffer) => {
      this.currentFrame = frame;
    });
  }

  async start() {
    logger.info("Vision", "Warming up AI models...");
    logger.info("Vision", "Starting camera stream...");
    this.provider.start();
  }
}
