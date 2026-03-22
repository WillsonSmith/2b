import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { $ } from "bun";
import { join } from "node:path";

const DOWNLOADS_DIR = "downloads";

export class YtDlpPlugin implements AgentPlugin {
  name = "YtDlp";

  getSystemPromptFragment(): string {
    return `You can download video clips from URLs (Twitch VODs, YouTube, etc.) using yt-dlp.
Use the download_video_clip tool when the user provides a video URL and asks to download a specific time range.
Timestamps should be in HH:MM:SS or MM:SS format. Downloaded files are saved to the downloads/ directory.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "download_video_clip",
        description:
          "Download a clip from a video URL between two timestamps using yt-dlp. Supports Twitch VODs, YouTube, and other yt-dlp-compatible sites. Saves the file to the downloads/ directory.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The video URL to download from.",
            },
            start_time: {
              type: "string",
              description:
                "Start timestamp in HH:MM:SS or MM:SS format, e.g. '05:05' or '1:05:05'.",
            },
            end_time: {
              type: "string",
              description:
                "End timestamp in HH:MM:SS or MM:SS format, e.g. '10:04' or '1:10:04'.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename (without extension). Defaults to a sanitized version of the title + timestamp range.",
            },
          },
          required: ["url", "start_time", "end_time"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "download_video_clip") {
      return this.downloadClip(
        args.url,
        args.start_time,
        args.end_time,
        args.output_filename,
      );
    }
  }

  private normalizeTimestamp(ts: string): string {
    // Ensure HH:MM:SS format (pad to 3 parts if needed)
    const parts = ts.trim().split(":");
    if (parts.length === 2) {
      return `00:${parts[0]!.padStart(2, "0")}:${parts[1]!.padStart(2, "0")}`;
    }
    if (parts.length === 3) {
      return `${parts[0]!.padStart(2, "0")}:${parts[1]!.padStart(2, "0")}:${parts[2]!.padStart(2, "0")}`;
    }
    return ts;
  }

  private async downloadClip(
    url: string,
    startTime: string,
    endTime: string,
    outputFilename?: string,
  ) {
    logger.debug("YtDlp", `download_video_clip: ${url} [${startTime} -> ${endTime}]`);

    const start = this.normalizeTimestamp(startTime);
    const end = this.normalizeTimestamp(endTime);
    const section = `*${start}-${end}`;

    // Build output template
    const outputTemplate = outputFilename
      ? join(DOWNLOADS_DIR, `${outputFilename}.%(ext)s`)
      : join(DOWNLOADS_DIR, `%(title)s [${start.replace(/:/g, "-")}_${end.replace(/:/g, "-")}].%(ext)s`);

    try {
      const result =
        await $`yt-dlp --download-sections ${section} --force-keyframes-at-cuts -o ${outputTemplate} ${url}`.text();

      logger.debug("YtDlp", `yt-dlp output: ${result}`);

      // Try to extract the output filename from yt-dlp's output
      const destMatch = result.match(/\[download\] Destination: (.+)/);
      const mergeMatch = result.match(/\[Merger\] Merging formats into "(.+)"/);
      const outputFile = mergeMatch?.[1] ?? destMatch?.[1] ?? outputTemplate;

      return {
        success: true,
        url,
        start_time: start,
        end_time: end,
        output_file: outputFile.trim(),
        message: `Clip downloaded successfully: ${outputFile.trim()}`,
      };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("YtDlp", `yt-dlp failed: ${stderr}`);
      return {
        success: false,
        error: `yt-dlp failed: ${stderr}`,
      };
    }
  }
}
