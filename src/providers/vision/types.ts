import { EventEmitter } from "node:events";

export type PersonRecord = {
  name: string;
  embeddings: number[][];
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
};

export type VisionSystemConfig = {
  logThrottleMs?: number;
  promptCooldownMs?: number;
  onUnknownPerson?: (
    embedding: Float32Array,
    image: Buffer,
  ) => Promise<string | null>;
};

export interface FrameProvider extends EventEmitter {
  start(): void;
  stop(): void;
}
