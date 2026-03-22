import * as tf from "@tensorflow/tfjs-node";
import { EventEmitter } from "node:events";
import { Human } from "@vladmandic/human";
import { type FrameProvider, type VisionSystemConfig } from "./types.ts";
import { SightingLogger } from "./SightingLogger.ts";
import { FaceMemory } from "./FaceMemory.ts";
import { logger } from "../../logger.ts";

export class VisionSystem extends EventEmitter {
  private human: Human;
  private isProcessingFrame = false;
  private lastPromptTime = 0;

  // State
  public lastSeenNames = new Set<string>();
  private lastSeenTime = new Map<string, number>();
  private lastLogTime = new Map<string, number>();

  // Config defaults
  private logThrottleMs = 1000 * 60 * 5; // 5 mins
  private promptCooldownMs = 30000; // 30 secs
  private presenceTimeoutMs = 5000; // 5 secs grace period for departures
  private resolveUnknown?: (
    embedding: Float32Array,
    image: Buffer,
  ) => Promise<string | null>;

  constructor(
    private provider: FrameProvider,
    private memory: FaceMemory,
    public history: SightingLogger,
    config?: VisionSystemConfig,
  ) {
    super();
    this.logThrottleMs = config?.logThrottleMs ?? this.logThrottleMs;
    this.promptCooldownMs = config?.promptCooldownMs ?? this.promptCooldownMs;
    this.resolveUnknown = config?.onUnknownPerson;

    this.human = new Human({
      modelBasePath: "https://vladmandic.github.io/human-models/models/",
      face: {
        enabled: true,
        detector: { return: true },
        description: { enabled: true },
      },
      body: { enabled: false },
      hand: { enabled: false },
    });

    // Hook up the camera
    this.provider.on("frame", async (frame: Buffer) => {
      if (!this.isProcessingFrame) {
        this.isProcessingFrame = true;
        await this.processFrame(frame);
        this.isProcessingFrame = false;
      }
    });
  }

  async start() {
    logger.info("Vision", "Warming up AI models...");
    await this.human.load();
    await this.memory.load();
    logger.info("Vision", "Starting camera stream...");
    this.provider.start();
  }

  private async processFrame(frame: Buffer) {
    let tensor;
    try {
      tensor = tf.node.decodeImage(frame, 3);
      const result = await this.human.detect(tensor);
      tf.dispose(tensor);

      const currentFrameNames = new Set<string>();
      const detections = result.face || [];

      for (const face of detections) {
        const embedding = new Float32Array(face.embedding!);
        const match = this.memory.findMatch(embedding);

        if (match.name !== "Unknown") {
          currentFrameNames.add(match.name);
          this.emit("person_present", {
            name: match.name,
            confidence: match.score,
          });

          // Continuous learning: if confidence is high, save this angle
          if (match.score > 0.92) {
            this.memory.addEmbedding(match.name, embedding);
          }
        } else {
          await this.handleUnknownFace(embedding, frame);
        }
      }

      this.processStateTransitions(currentFrameNames);
    } catch (err) {
      if (tensor) tf.dispose(tensor);
      // Silently catch malformed stream frames
    }
  }

  private async handleUnknownFace(embedding: Float32Array, frame: Buffer) {
    const now = Date.now();
    if (
      now - this.lastPromptTime < this.promptCooldownMs ||
      !this.resolveUnknown
    )
      return;

    this.lastPromptTime = now;
    this.emit("unknown_detected");

    // Ask the consuming application to resolve this identity
    const name = await this.resolveUnknown(embedding, frame);

    if (name && name.trim().length > 0) {
      const cleanName = name.trim();
      this.memory.enroll(cleanName, embedding);
      await this.memory.save();
      this.history.record(cleanName, 1.0);
      this.lastSeenNames.add(cleanName);

      this.emit("person_enrolled", cleanName);
    }
  }

  private processStateTransitions(currentFrameNames: Set<string>) {
    const now = Date.now();

    // 1. Detect Arrivals / Update presence
    for (const name of currentFrameNames) {
      this.lastSeenTime.set(name, now);

      const lastLogged = this.lastLogTime.get(name) || 0;
      if (
        !this.lastSeenNames.has(name) ||
        now - lastLogged > this.logThrottleMs
      ) {
        this.history.record(name, 1.0);
        this.lastLogTime.set(name, now);
        this.memory.updateLastSeen(name);

        this.emit("person_entered", name);
        this.lastSeenNames.add(name);
      }
    }

    // 2. Detect Departures
    for (const name of this.lastSeenNames) {
      const lastSeen = this.lastSeenTime.get(name) || 0;
      
      // If they aren't in current frame AND grace period has expired
      if (!currentFrameNames.has(name) && now - lastSeen > this.presenceTimeoutMs) {
        this.emit("person_left", name);
        this.lastSeenNames.delete(name);
        this.lastSeenTime.delete(name);
      }
    }
  }
}
