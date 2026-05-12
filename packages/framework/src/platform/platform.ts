import type { IPlatform } from "./IPlatform.ts";

let _platform: IPlatform | null = null;

export function getPlatform(): IPlatform {
  if (!_platform) {
    if (typeof Bun !== "undefined") {
      // Auto-initialize with BunPlatform when running in Bun.
      // require() is synchronous and globally available in Bun's runtime.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require("./BunPlatform.ts") as { bunPlatform: IPlatform };
      _platform = m.bunPlatform;
    } else {
      throw new Error(
        "Platform not initialized. Call setPlatform() with a platform implementation before using the framework in Node.js.",
      );
    }
  }
  return _platform;
}

export function setPlatform(p: IPlatform): void {
  _platform = p;
}
