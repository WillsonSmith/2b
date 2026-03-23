import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { $ } from "bun";
import { join, basename, extname } from "node:path";

const DOWNLOADS_DIR = "downloads";

export class FFmpegPlugin implements AgentPlugin {
  name = "FFmpeg";

  getSystemPromptFragment(): string {
    return `You can edit local video files using FFmpeg.
Available tools:
- ffmpeg_get_info: Get metadata (duration, resolution, codec, fps) for a video file.
- ffmpeg_trim: Trim a video between two timestamps. Output saved to downloads/.
- ffmpeg_convert: Convert a video to a different format/codec. Output saved to downloads/.
- ffmpeg_extract_audio: Extract audio track from a video. Output saved to downloads/.
- ffmpeg_resize: Scale a video to a new resolution. Output saved to downloads/.
- ffmpeg_concatenate: Concatenate multiple video files in order. Output saved to downloads/.
All input paths are relative to the working directory. Use ffmpeg_get_info to inspect a file before editing.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "ffmpeg_get_info",
        description:
          "Get metadata about a video file: duration, resolution, codec, frame rate, bitrate. Use this to inspect a file before editing.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description:
                "Path to the video file (relative to working directory).",
            },
          },
          required: ["input_file"],
        },
      },
      {
        name: "ffmpeg_trim",
        description:
          "Trim a video file to a time range. Output is saved to downloads/. Timestamps in HH:MM:SS or MM:SS or seconds format.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            start_time: {
              type: "string",
              description: "Start timestamp, e.g. '00:01:30', '1:30', or '90'.",
            },
            end_time: {
              type: "string",
              description: "End timestamp, e.g. '00:02:45', '2:45', or '165'.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <input>_trimmed.",
            },
          },
          required: ["input_file", "start_time", "end_time"],
        },
      },
      {
        name: "ffmpeg_convert",
        description:
          "Convert a video to a different format or re-encode with a different codec. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            output_format: {
              type: "string",
              description:
                "Output container format, e.g. 'mp4', 'mkv', 'webm', 'mov'.",
            },
            video_codec: {
              type: "string",
              description:
                "Optional video codec, e.g. 'libx264', 'libx265', 'libvpx-vp9', 'copy'.",
            },
            audio_codec: {
              type: "string",
              description:
                "Optional audio codec, e.g. 'aac', 'libopus', 'copy'.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <input>_converted.",
            },
          },
          required: ["input_file", "output_format"],
        },
      },
      {
        name: "ffmpeg_extract_audio",
        description:
          "Extract the audio track from a video file. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            output_format: {
              type: "string",
              description:
                "Audio format: 'mp3', 'aac', 'flac', 'wav', 'opus'. Defaults to 'mp3'.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <input>_audio.",
            },
          },
          required: ["input_file"],
        },
      },
      {
        name: "ffmpeg_resize",
        description:
          "Scale a video to a new resolution. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            width: {
              type: "number",
              description:
                "Target width in pixels. Use -1 to preserve aspect ratio based on height.",
            },
            height: {
              type: "number",
              description:
                "Target height in pixels. Use -1 to preserve aspect ratio based on width.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <input>_resized.",
            },
          },
          required: ["input_file", "width", "height"],
        },
      },
      {
        name: "ffmpeg_concatenate",
        description:
          "Concatenate two or more video files in order. Files must have compatible codecs (use ffmpeg_convert first if needed). Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_files: {
              type: "array",
              items: { type: "string" },
              description: "Ordered list of video file paths to concatenate.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to 'concatenated'.",
            },
            output_format: {
              type: "string",
              description:
                "Output container format. Defaults to the format of the first input file.",
            },
          },
          required: ["input_files"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    switch (name) {
      case "ffmpeg_get_info":
        return this.getInfo(args.input_file);
      case "ffmpeg_trim":
        return this.trim(
          args.input_file,
          args.start_time,
          args.end_time,
          args.output_filename,
        );
      case "ffmpeg_convert":
        return this.convert(
          args.input_file,
          args.output_format,
          args.video_codec,
          args.audio_codec,
          args.output_filename,
        );
      case "ffmpeg_extract_audio":
        return this.extractAudio(
          args.input_file,
          args.output_format ?? "mp3",
          args.output_filename,
        );
      case "ffmpeg_resize":
        return this.resize(
          args.input_file,
          args.width,
          args.height,
          args.output_filename,
        );
      case "ffmpeg_concatenate":
        return this.concatenate(
          args.input_files,
          args.output_filename,
          args.output_format,
        );
    }
  }

  private stem(filePath: string): string {
    const base = basename(filePath);
    const ext = extname(base);
    return ext ? base.slice(0, -ext.length) : base;
  }

  private outPath(filename: string, ext: string): string {
    return join(DOWNLOADS_DIR, `${filename}.${ext}`);
  }

  private async ensureDownloadsDir(): Promise<void> {
    await $`mkdir -p ${DOWNLOADS_DIR}`.quiet();
  }

  private async getInfo(inputFile: string) {
    logger.debug("FFmpeg", `ffprobe: ${inputFile}`);
    try {
      const result =
        await $`ffprobe -v quiet -print_format json -show_streams -show_format ${inputFile}`.text();
      const data = JSON.parse(result) as any;

      const videoStream = data.streams?.find(
        (s: any) => s.codec_type === "video",
      );
      const audioStream = data.streams?.find(
        (s: any) => s.codec_type === "audio",
      );
      const format = data.format ?? {};

      return {
        duration_seconds: parseFloat(format.duration ?? "0"),
        size_bytes: parseInt(format.size ?? "0", 10),
        bitrate_kbps: Math.round(parseInt(format.bit_rate ?? "0", 10) / 1000),
        format: format.format_name,
        video: videoStream
          ? {
              codec: videoStream.codec_name,
              width: videoStream.width,
              height: videoStream.height,
              fps: (() => {
                const r = videoStream.r_frame_rate ?? "0";
                const [num, den] = r.split("/").map(Number);
                return den ? num / den : num || null;
              })(),
            }
          : null,
        audio: audioStream
          ? {
              codec: audioStream.codec_name,
              sample_rate: audioStream.sample_rate,
              channels: audioStream.channels,
            }
          : null,
      };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `ffprobe failed: ${stderr}`);
      return { success: false, error: `ffprobe failed: ${stderr}` };
    }
  }

  private async trim(
    inputFile: string,
    startTime: string,
    endTime: string,
    outputFilename?: string,
  ) {
    const stem = outputFilename ?? `${this.stem(inputFile)}_trimmed`;
    const ext = extname(inputFile).replace(".", "") || "mp4";
    const output = this.outPath(stem, ext);

    logger.debug(
      "FFmpeg",
      `trim: ${inputFile} [${startTime} -> ${endTime}] -> ${output}`,
    );
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -ss ${startTime} -to ${endTime} -i ${inputFile} -c copy ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `trim failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async convert(
    inputFile: string,
    outputFormat: string,
    videoCodec?: string,
    audioCodec?: string,
    outputFilename?: string,
  ) {
    const stem = outputFilename ?? `${this.stem(inputFile)}_converted`;
    const output = this.outPath(stem, outputFormat);

    const vcodec = videoCodec ?? "copy";
    const acodec = audioCodec ?? "copy";

    logger.debug(
      "FFmpeg",
      `convert: ${inputFile} -> ${output} (vcodec=${vcodec}, acodec=${acodec})`,
    );
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -i ${inputFile} -c:v ${vcodec} -c:a ${acodec} ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `convert failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async extractAudio(
    inputFile: string,
    outputFormat: string,
    outputFilename?: string,
  ) {
    const stem = outputFilename ?? `${this.stem(inputFile)}_audio`;
    const output = this.outPath(stem, outputFormat);

    logger.debug("FFmpeg", `extract_audio: ${inputFile} -> ${output}`);
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -i ${inputFile} -vn ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `extract_audio failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async resize(
    inputFile: string,
    width: number,
    height: number,
    outputFilename?: string,
  ) {
    const stem = outputFilename ?? `${this.stem(inputFile)}_resized`;
    const ext = extname(inputFile).replace(".", "") || "mp4";
    const output = this.outPath(stem, ext);
    const scale = `${width}:${height}`;

    logger.debug(
      "FFmpeg",
      `resize: ${inputFile} -> ${output} (scale=${scale})`,
    );
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -i ${inputFile} -vf scale=${scale} ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `resize failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async concatenate(
    inputFiles: string[],
    outputFilename?: string,
    outputFormat?: string,
  ) {
    if (inputFiles.length < 2) {
      return {
        success: false,
        error: "At least two input files are required for concatenation.",
      };
    }

    const ext =
      outputFormat ?? (extname(inputFiles[0]!).replace(".", "") || "mp4");
    const stem = outputFilename ?? "concatenated";
    const output = this.outPath(stem, ext);

    // Write a temporary concat list file (escape single quotes in paths per ffmpeg concat format)
    const listContent = inputFiles
      .map((f) => `file '${f.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`)
      .join("\n");
    const listFile = join(DOWNLOADS_DIR, `_concat_list_${Date.now()}.txt`);

    logger.debug(
      "FFmpeg",
      `concatenate: ${inputFiles.join(", ")} -> ${output}`,
    );
    try {
      await this.ensureDownloadsDir();
      await Bun.write(listFile, listContent);
      await $`ffmpeg -y -f concat -safe 0 -i ${listFile} -c copy ${output}`;
      // Clean up temp file
      await $`rm -f ${listFile}`.quiet();
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `concatenate failed: ${stderr}`);
      await $`rm -f ${listFile}`.quiet().catch(() => {});
      return { success: false, error: stderr };
    }
  }
}
