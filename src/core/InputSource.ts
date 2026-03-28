import { EventEmitter } from "node:events";

/**
 * An InputSource provides text input to a BaseAgent.
 *
 * Emit "direct_input" for input that requires a response (e.g. user spoke directly).
 * Emit "ambient_input" for passive context the agent may choose to ignore.
 *
 * Subclasses should check and update `this.running` in `start()` and `stop()` to
 * guard against duplicate starts and premature stops.
 */
export abstract class InputSource extends EventEmitter {
  abstract name: string;

  /** Lifecycle state. Subclasses must set this to `true` in `start()` and `false` in `stop()`. */
  protected running = false;

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  // Typed event overloads
  override on(event: "direct_input", listener: (text: string) => void): this;
  override on(event: "ambient_input", listener: (text: string) => void): this;
  override on(event: string | symbol, listener: (...args: never[]) => void): this;
  override on(event: string | symbol, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit(event: "direct_input", text: string): boolean;
  override emit(event: "ambient_input", text: string): boolean;
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}
