import { InputSource } from "../../core/InputSource.ts";
import { logger } from "../../logger.ts";

type ReadableInput = NodeJS.ReadableStream & { setEncoding?(enc: BufferEncoding): void };

/**
 * Reads from a readable stream (defaults to stdin) and emits all input as
 * direct_input (always requires a response).
 */
export class CLIInputSource extends InputSource {
  name = "CLI";

  private readonly stream: ReadableInput;
  private _onData?: (data: string) => void;

  constructor(stream: ReadableInput = process.stdin) {
    super();
    this.stream = stream;
  }

  async start() {
    if (this.running) return;

    this.stream.setEncoding?.("utf8");
    this.stream.resume();

    this._onData = (data: string) => {
      const input = data.trim();
      if (input.length > 0) {
        this.emit("direct_input", input);
      }
    };

    this.stream.on("data", this._onData as (chunk: unknown) => void);

    this.running = true;
    logger.info(this.name, "Input ready. Type to chat.");
  }

  async stop() {
    if (!this.running) return;
    if (this._onData) {
      this.stream.off("data", this._onData as (chunk: unknown) => void);
      this._onData = undefined;
    }
    this.stream.pause();
    this.running = false;
  }
}
