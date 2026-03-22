import { InputSource } from "../../core/InputSource.ts";
import { logger } from "../../logger.ts";

/**
 * Reads from stdin and emits all input as direct_input (always requires a response).
 */
export class CLIInputSource extends InputSource {
  name = "CLI";

  async start() {
    process.stdin.setEncoding("utf-8");
    process.stdin.resume();

    process.stdin.on("data", (data) => {
      const input = data.toString().trim();
      if (input.length > 0) {
        this.emit("direct_input", input);
      }
    });

    logger.info("CLI", "Input ready. Type to chat.");
  }

  async stop() {
    process.stdin.pause();
  }
}
