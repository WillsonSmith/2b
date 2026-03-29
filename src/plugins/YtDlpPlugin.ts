import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { $ } from "bun";
import { join, basename } from "node:path";

const DOWNLOADS_DIR = "downloads";

export class YtDlpPlugin implements AgentPlugin {
  name = "YtDlp";

  getSystemPromptFragment(): string {
    return `You can download video clips from URLs (Twitch VODs, YouTube, etc.) using yt-dlp.
Use the download_video_clip tool when the user provides a video URL and asks to download a specific time range.
Timestamps must be in HH:MM:SS or MM:SS format (e.g. '05:30' or '1:05:30'). Leading zeros on minutes are not required. Downloaded files are saved to the downloads/ directory.`;
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
      const { url, start_time, end_time, output_filename } = args ?? {};
      if (typeof url !== "string" || !url) {
        return { success: false, error: "Missing required argument: url" };
      }
      if (typeof start_time !== "string" || !start_time) {
        return { success: false, error: "Missing required argument: start_time" };
      }
      if (typeof end_time !== "string" || !end_time) {
        return { success: false, error: "Missing required argument: end_time" };
      }
      return this.downloadClip(url, start_time, end_time, output_filename);
    }
    return undefined;
  }

  private normalizeTimestamp(ts: string): string | null {
    // Ensure HH:MM:SS format (pad to 3 parts if needed)
    const parts = ts.trim().split(":");
    if (parts.length === 2) {
      return `00:${parts[0]!.padStart(2, "0")}:${parts[1]!.padStart(2, "0")}`;
    }
    if (parts.length === 3) {
      return `${parts[0]!.padStart(2, "0")}:${parts[1]!.padStart(2, "0")}:${parts[2]!.padStart(2, "0")}`;
    }
    // Malformed timestamp — not MM:SS or HH:MM:SS
    return null;
  }

  private async downloadClip(
    url: string,
    startTime: string,
    endTime: string,
    outputFilename?: string,
  ) {
    // Reject non-HTTP(S) URLs to prevent yt-dlp from reading local filesystem paths
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { success: false, error: "url must start with http:// or https://" };
    }

    const start = this.normalizeTimestamp(startTime);
    if (start === null) {
      return { success: false, error: `Invalid start_time format: "${startTime}". Use HH:MM:SS or MM:SS.` };
    }
    const end = this.normalizeTimestamp(endTime);
    if (end === null) {
      return { success: false, error: `Invalid end_time format: "${endTime}". Use HH:MM:SS or MM:SS.` };
    }

    logger.debug("YtDlp", `download_video_clip: ${url} [${start} -> ${end}]`);

    const section = `*${start}-${end}`;

    // Ensure downloads directory exists
    await Bun.mkdir(DOWNLOADS_DIR, { recursive: true });

    // Strip directory components from user-supplied filename to prevent path traversal
    const safeFilename = outputFilename ? basename(outputFilename) : undefined;

    // Build output template
    const outputTemplate = safeFilename
      ? join(DOWNLOADS_DIR, `${safeFilename}.%(ext)s`)
      : join(DOWNLOADS_DIR, `%(title)s [${start.replace(/:/g, "-")}_${end.replace(/:/g, "-")}].%(ext)s`);

    try {
      const result =
        await $`yt-dlp --download-sections ${section} --force-keyframes-at-cuts -o ${outputTemplate} ${url}`.text();

      logger.debug("YtDlp", `yt-dlp output: ${result}`);

      // Try to extract the output filename from yt-dlp's output
      const destMatch = result.match(/\[download\] Destination: (.+)/);
      const mergeMatch = result.match(/\[Merger\] Merging formats into "(.+)"/);
      const outputFile = (mergeMatch?.[1] ?? destMatch?.[1] ?? outputTemplate).trim();

      return {
        success: true,
        url,
        start_time: start,
        end_time: end,
        output_file: outputFile,
        message: `Clip downloaded successfully: ${outputFile}`,
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
