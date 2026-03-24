import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import { YtDlpPlugin } from "../../plugins/YtDlpPlugin.ts";
import { FFmpegPlugin } from "../../plugins/FFmpegPlugin.ts";
import { ImageVisionPlugin } from "../../plugins/ImageVisionPlugin.ts";

export function createMediaAgent(llm: LLMProvider): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new YtDlpPlugin(), new FFmpegPlugin(), new ImageVisionPlugin()],
    "You are a media processing specialist. You can download videos, edit clips, convert formats, extract audio, and analyze images. Focus on completing media tasks efficiently.",
  );
}
