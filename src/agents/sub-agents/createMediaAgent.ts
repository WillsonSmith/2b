import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import type { PermissionManager } from "../../core/PermissionManager.ts";
import { YtDlpPlugin } from "../../plugins/YtDlpPlugin.ts";
import { FFmpegPlugin } from "../../plugins/FFmpegPlugin.ts";
import { ImageVisionPlugin } from "../../plugins/ImageVisionPlugin.ts";

export interface MediaAgentOptions {
  visionModel?: string;
  visionBaseUrl?: string;
  permissionManager?: PermissionManager;
}

export function createMediaAgent(llm: LLMProvider, options: MediaAgentOptions = {}): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [
      new YtDlpPlugin(),
      new FFmpegPlugin(),
      new ImageVisionPlugin(options.visionModel, options.visionBaseUrl),
    ],
    "You are a media processing specialist. You can download video clips from URLs, trim and convert video files, extract audio tracks, and analyze images from URLs or local file paths. Verify file paths before editing and prefer non-destructive operations where possible.",
    {
      agentName: "MediaAgent",
      permissionManager: options.permissionManager,
    },
  );
}
