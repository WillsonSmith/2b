import { EventEmitter } from "node:events";

/**
 * An InputSource provides text input to a BaseAgent.
 *
 * Emit "direct_input" for input that requires a response (e.g. user spoke directly).
 * Emit "ambient_input" for passive context the agent may choose to ignore.
 */
export abstract class InputSource extends EventEmitter {
  abstract name: string;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}
