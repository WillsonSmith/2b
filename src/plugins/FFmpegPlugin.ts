import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { $ } from "bun";
import { join, basename, extname, resolve, relative } from "node:path";

const DOWNLOADS_DIR = "downloads";

export class FFmpegPlugin implements AgentPlugin {
  name = "FFmpeg";
  private dirEnsured = false;

  getSystemPromptFragment(): string {
    return `You can edit local video files using FFmpeg.
Available tools:
- ffmpeg_get_info: Get metadata (duration, resolution, codec, fps) for a video file.
- ffmpeg_trim: Trim a video between two timestamps. Output saved to downloads/.
- ffmpeg_convert: Convert a video to a different format/codec. Output saved to downloads/.
- ffmpeg_extract_audio: Extract audio track from a video. Output saved to downloads/.
- ffmpeg_resize: Scale a video to a new resolution. Output saved to downloads/.
- ffmpeg_concatenate: Concatenate multiple video files in order. Output saved to downloads/.
- ffmpeg_images_to_video: Create a video from an ordered sequence of image files. Output saved to downloads/.
- ffmpeg_add_audio: Mux an audio track into a video file. Output saved to downloads/.
- ffmpeg_extract_frames: Extract frames from a video as image files. Output saved to downloads/.
- ffmpeg_screenshot: Capture a single frame at a timestamp as an image. Output saved to downloads/.
- ffmpeg_crop: Crop a rectangular region from a video. Output saved to downloads/.
- ffmpeg_speed: Change the playback speed of a video. Output saved to downloads/.
- ffmpeg_rotate: Rotate or flip a video. Output saved to downloads/.
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
      {
        name: "ffmpeg_images_to_video",
        description:
          "Create a video from an ordered sequence of image files. Provide either a glob pattern (e.g. 'frames/*.jpg') or an explicit ordered list of file paths. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_pattern: {
              type: "string",
              description:
                "Glob pattern for input images, e.g. 'frames/*.jpg' or 'frame_%04d.png' for numbered sequences.",
            },
            input_files: {
              type: "array",
              items: { type: "string" },
              description:
                "Explicit ordered list of image file paths. Use this instead of input_pattern when filenames are not uniformly named.",
            },
            framerate: {
              type: "number",
              description:
                "Frames per second for the output video. Defaults to 24.",
            },
            video_codec: {
              type: "string",
              description:
                "Video codec, e.g. 'libx264', 'libx265'. Defaults to 'libx264'.",
            },
            output_format: {
              type: "string",
              description: "Output container format. Defaults to 'mp4'.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to 'slideshow'.",
            },
          },
          required: [],
        },
      },
      {
        name: "ffmpeg_add_audio",
        description:
          "Mux an audio track into a video file, replacing any existing audio. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            video_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            audio_file: {
              type: "string",
              description: "Path to the audio file to mux in.",
            },
            audio_codec: {
              type: "string",
              description: "Audio codec. Defaults to 'aac'.",
            },
            shortest: {
              type: "boolean",
              description:
                "If true, output ends when the shorter of the two streams ends. Defaults to true.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <video>_with_audio.",
            },
          },
          required: ["video_file", "audio_file"],
        },
      },
      {
        name: "ffmpeg_extract_frames",
        description:
          "Extract frames from a video as image files. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            fps: {
              type: "number",
              description:
                "How many frames per second to extract. Use 1 for one frame per second, 0.5 for one every two seconds, etc. Defaults to 1.",
            },
            output_prefix: {
              type: "string",
              description:
                "Filename prefix for output frames (without extension). Defaults to <input>_frame. Frames are numbered: <prefix>_%04d.jpg",
            },
            image_format: {
              type: "string",
              description:
                "Image format: 'jpg', 'png', 'webp'. Defaults to 'jpg'.",
            },
          },
          required: ["input_file"],
        },
      },
      {
        name: "ffmpeg_screenshot",
        description:
          "Capture a single frame from a video at a specific timestamp. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            timestamp: {
              type: "string",
              description:
                "Timestamp of the frame to capture, e.g. '00:01:30', '1:30', or '90'.",
            },
            image_format: {
              type: "string",
              description:
                "Image format: 'jpg', 'png', 'webp'. Defaults to 'jpg'.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <input>_screenshot.",
            },
          },
          required: ["input_file", "timestamp"],
        },
      },
      {
        name: "ffmpeg_crop",
        description:
          "Crop a rectangular region from a video. x and y are the top-left corner coordinates. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            width: {
              type: "number",
              description: "Width of the crop region in pixels.",
            },
            height: {
              type: "number",
              description: "Height of the crop region in pixels.",
            },
            x: {
              type: "number",
              description: "X offset of the top-left corner. Defaults to 0.",
            },
            y: {
              type: "number",
              description: "Y offset of the top-left corner. Defaults to 0.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <input>_cropped.",
            },
          },
          required: ["input_file", "width", "height"],
        },
      },
      {
        name: "ffmpeg_speed",
        description:
          "Change the playback speed of a video. Audio pitch is corrected automatically. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            speed: {
              type: "number",
              description:
                "Speed multiplier. 2.0 = double speed, 0.5 = half speed. Supported range: 0.25–4.0.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <input>_speed.",
            },
          },
          required: ["input_file", "speed"],
        },
      },
      {
        name: "ffmpeg_rotate",
        description: "Rotate or flip a video. Output saved to downloads/.",
        parameters: {
          type: "object",
          properties: {
            input_file: {
              type: "string",
              description: "Path to the input video file.",
            },
            rotation: {
              type: ["string", "integer"],
              enum: ["90", "180", "270", 90, 180, 270, "flip_horizontal", "flip_vertical"],
              description:
                "Rotation or flip to apply: '90' (clockwise), '180', '270' (counter-clockwise), 'flip_horizontal', 'flip_vertical'.",
            },
            output_filename: {
              type: "string",
              description:
                "Optional output filename without extension. Defaults to <input>_rotated.",
            },
          },
          required: ["input_file", "rotation"],
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
      case "ffmpeg_images_to_video":
        return this.imagesToVideo(
          args.input_pattern,
          args.input_files,
          args.framerate ?? 24,
          args.video_codec ?? "libx264",
          args.output_format ?? "mp4",
          args.output_filename,
        );
      case "ffmpeg_add_audio":
        return this.addAudio(
          args.video_file,
          args.audio_file,
          args.audio_codec ?? "aac",
          args.shortest ?? true,
          args.output_filename,
        );
      case "ffmpeg_extract_frames":
        return this.extractFrames(
          args.input_file,
          args.fps ?? 1,
          args.output_prefix,
          args.image_format ?? "jpg",
        );
      case "ffmpeg_screenshot":
        return this.screenshot(
          args.input_file,
          args.timestamp,
          args.image_format ?? "jpg",
          args.output_filename,
        );
      case "ffmpeg_crop":
        return this.crop(
          args.input_file,
          args.width,
          args.height,
          args.x ?? 0,
          args.y ?? 0,
          args.output_filename,
        );
      case "ffmpeg_speed":
        return this.speed(args.input_file, args.speed, args.output_filename);
      case "ffmpeg_rotate":
        return this.rotate(
          args.input_file,
          args.rotation,
          args.output_filename,
        );
    }
  }

  private stem(filePath: string): string {
    const base = basename(filePath);
    const ext = extname(base);
    return ext ? base.slice(0, -ext.length) : base;
  }

  private outPath(filename: string, ext: string): string {
    const safe = basename(filename);
    return join(DOWNLOADS_DIR, `${safe}.${ext}`);
  }

  private validateInputPath(filePath: string): string | null {
    const rel = relative(process.cwd(), resolve(filePath));
    if (rel.startsWith("..")) {
      return `Path '${filePath}' is outside the working directory.`;
    }
    return null;
  }

  private async ensureDownloadsDir(): Promise<void> {
    if (this.dirEnsured) return;
    await $`mkdir -p ${DOWNLOADS_DIR}`.quiet();
    this.dirEnsured = true;
  }

  private async getInfo(inputFile: string) {
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
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
        success: true,
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
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
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
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
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
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
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
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
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
    for (const f of inputFiles) {
      const pathErr = this.validateInputPath(f);
      if (pathErr) return { success: false, error: pathErr };
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

  private async imagesToVideo(
    inputPattern: string | undefined,
    inputFiles: string[] | undefined,
    framerate: number,
    videoCodec: string,
    outputFormat: string,
    outputFilename?: string,
  ) {
    if (!inputPattern && (!inputFiles || inputFiles.length === 0)) {
      return {
        success: false,
        error: "Either input_pattern or input_files must be provided.",
      };
    }

    if (inputFiles && inputFiles.length > 0) {
      for (const f of inputFiles) {
        const pathErr = this.validateInputPath(f);
        if (pathErr) return { success: false, error: pathErr };
      }
    }

    const stem = outputFilename ?? "slideshow";
    const output = this.outPath(stem, outputFormat);

    await this.ensureDownloadsDir();

    // If an explicit file list is provided, write a concat list and use the image2 demuxer via concat
    if (inputFiles && inputFiles.length > 0) {
      const listContent = inputFiles
        .map((f) => `file '${f.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`)
        .join("\n");
      const listFile = join(DOWNLOADS_DIR, `_images_list_${Date.now()}.txt`);
      logger.debug(
        "FFmpeg",
        `images_to_video (list): ${inputFiles.length} files -> ${output}`,
      );
      try {
        await Bun.write(listFile, listContent);
        await $`ffmpeg -y -r ${String(framerate)} -f concat -safe 0 -i ${listFile} -c:v ${videoCodec} -pix_fmt yuv420p ${output}`;
        await $`rm -f ${listFile}`.quiet();
        return { success: true, output_file: output };
      } catch (err: any) {
        const stderr = err?.stderr ?? err?.message ?? String(err);
        logger.error("FFmpeg", `images_to_video failed: ${stderr}`);
        await $`rm -f ${listFile}`.quiet().catch(() => {});
        return { success: false, error: stderr };
      }
    }

    // inputPattern is guaranteed non-undefined here by the early guard above
    logger.debug(
      "FFmpeg",
      `images_to_video (pattern): ${inputPattern} -> ${output}`,
    );
    try {
      const hasGlob = /[*?[\]{}]/.test(inputPattern);
      if (hasGlob) {
        await $`ffmpeg -y -r ${String(framerate)} -pattern_type glob -i ${inputPattern} -c:v ${videoCodec} -pix_fmt yuv420p ${output}`;
      } else {
        await $`ffmpeg -y -r ${String(framerate)} -i ${inputPattern} -c:v ${videoCodec} -pix_fmt yuv420p ${output}`;
      }
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `images_to_video failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async addAudio(
    videoFile: string,
    audioFile: string,
    audioCodec: string,
    shortest: boolean,
    outputFilename?: string,
  ) {
    const videoPathErr = this.validateInputPath(videoFile);
    if (videoPathErr) return { success: false, error: videoPathErr };
    const audioPathErr = this.validateInputPath(audioFile);
    if (audioPathErr) return { success: false, error: audioPathErr };
    const stem = outputFilename ?? `${this.stem(videoFile)}_with_audio`;
    const ext = extname(videoFile).replace(".", "") || "mp4";
    const output = this.outPath(stem, ext);

    logger.debug(
      "FFmpeg",
      `add_audio: ${videoFile} + ${audioFile} -> ${output}`,
    );
    try {
      await this.ensureDownloadsDir();
      const shortestFlag = shortest ? ["-shortest"] : [];
      await $`ffmpeg -y -i ${videoFile} -i ${audioFile} -c:v copy -c:a ${audioCodec} -map 0:v:0 -map 1:a:0 ${shortestFlag} ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `add_audio failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async extractFrames(
    inputFile: string,
    fps: number,
    outputPrefix?: string,
    imageFormat: string = "jpg",
  ) {
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
    const prefix = outputPrefix ?? `${this.stem(inputFile)}_frame`;
    const outputPattern = join(DOWNLOADS_DIR, `${prefix}_%04d.${imageFormat}`);

    logger.debug(
      "FFmpeg",
      `extract_frames: ${inputFile} @ ${fps}fps -> ${outputPattern}`,
    );
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -i ${inputFile} -vf fps=${String(fps)} ${outputPattern}`;
      return { success: true, output_pattern: outputPattern };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `extract_frames failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async screenshot(
    inputFile: string,
    timestamp: string,
    imageFormat: string,
    outputFilename?: string,
  ) {
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
    const stem = outputFilename ?? `${this.stem(inputFile)}_screenshot`;
    const output = this.outPath(stem, imageFormat);

    logger.debug(
      "FFmpeg",
      `screenshot: ${inputFile} @ ${timestamp} -> ${output}`,
    );
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -ss ${timestamp} -i ${inputFile} -frames:v 1 ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `screenshot failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async crop(
    inputFile: string,
    width: number,
    height: number,
    x: number,
    y: number,
    outputFilename?: string,
  ) {
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
    const stem = outputFilename ?? `${this.stem(inputFile)}_cropped`;
    const ext = extname(inputFile).replace(".", "") || "mp4";
    const output = this.outPath(stem, ext);
    const cropFilter = `crop=${width}:${height}:${x}:${y}`;

    logger.debug("FFmpeg", `crop: ${inputFile} (${cropFilter}) -> ${output}`);
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -i ${inputFile} -vf ${cropFilter} ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `crop failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async speed(
    inputFile: string,
    speedFactor: number,
    outputFilename?: string,
  ) {
    if (speedFactor < 0.25 || speedFactor > 4) {
      return { success: false, error: "Speed must be between 0.25 and 4.0." };
    }
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
    const stem = outputFilename ?? `${this.stem(inputFile)}_speed`;
    const ext = extname(inputFile).replace(".", "") || "mp4";
    const output = this.outPath(stem, ext);

    // setpts adjusts video timing; atempo adjusts audio pitch-corrected speed (range 0.5–2.0 per filter)
    const videoFilter = `setpts=${1 / speedFactor}*PTS`;
    const audioFilter = buildAtempoChain(speedFactor);

    logger.debug("FFmpeg", `speed: ${inputFile} x${speedFactor} -> ${output}`);
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -i ${inputFile} -vf ${videoFilter} -af ${audioFilter} ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `speed failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }

  private async rotate(
    inputFile: string,
    rotation: string,
    outputFilename?: string,
  ) {
    const pathErr = this.validateInputPath(inputFile);
    if (pathErr) return { success: false, error: pathErr };
    const stem = outputFilename ?? `${this.stem(inputFile)}_rotated`;
    const ext = extname(inputFile).replace(".", "") || "mp4";
    const output = this.outPath(stem, ext);

    const filterMap: Record<string, string> = {
      "90": "transpose=1",
      "180": "hflip,vflip",
      "270": "transpose=2",
      flip_horizontal: "hflip",
      flip_vertical: "vflip",
    };

    const vf = filterMap[String(rotation)];
    if (!vf) {
      return { success: false, error: `Unknown rotation '${rotation}'.` };
    }

    logger.debug("FFmpeg", `rotate: ${inputFile} (${rotation}) -> ${output}`);
    try {
      await this.ensureDownloadsDir();
      await $`ffmpeg -y -i ${inputFile} -vf ${vf} -c:a copy ${output}`;
      return { success: true, output_file: output };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      logger.error("FFmpeg", `rotate failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }
}

// atempo only accepts values in [0.5, 2.0] — chain multiple filters for values outside that range
function buildAtempoChain(speed: number): string {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    filters.push("atempo=2.0");
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining}`);
  return filters.join(",");
}
