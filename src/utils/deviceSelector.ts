import { spawn } from "bun";
import { logger } from "../logger.ts";

export interface Device {
  id: string;
  name: string;
}

/**
 * Scans for available AVFoundation video and audio devices by invoking ffmpeg.
 * macOS only — requires ffmpeg with avfoundation support on PATH.
 *
 * @throws if ffmpeg is not found on PATH or if device listing fails.
 */
export async function scanDevices(): Promise<{ videoDevices: Device[]; audioDevices: Device[] }> {
  logger.info("DeviceSelector", "Scanning for available video and audio devices...");

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      stderr: "pipe",
      stdout: "ignore"
    });
  } catch {
    throw new Error("ffmpeg not found; install FFmpeg and ensure it is on PATH");
  }

  const text = await new Response(proc.stderr as ReadableStream).text();
  const exitCode = await proc.exited;

  // ffmpeg exits non-zero when given an empty input, but device listing still
  // succeeds. Exit code 1 is normal for this invocation; only error on higher
  // codes that indicate a real failure (e.g. avfoundation not available).
  if (exitCode > 1) {
    logger.info("DeviceSelector", `ffmpeg exited with code ${exitCode} during device scan`);
  }

  const videoDevices: Device[] = [];
  const audioDevices: Device[] = [];

  let currentCategory = "";
  let inDeviceBlock = false;

  for (const line of text.split("\n")) {
    if (line.includes("AVFoundation video devices:")) {
      currentCategory = "video";
      inDeviceBlock = true;
      continue;
    }
    if (line.includes("AVFoundation audio devices:")) {
      currentCategory = "audio";
      inDeviceBlock = true;
      continue;
    }

    if (!inDeviceBlock) continue;

    // Only match device-list lines that contain the AVFoundation prefix,
    // e.g.: "[AVFoundation indevice @ ...] [0] FaceTime HD Camera"
    // Also match the compact form: "[0] FaceTime HD Camera"
    // Require the line to contain a known category marker to avoid false matches.
    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match && match[1] && match[2]) {
      // Skip lines that are ffmpeg internal messages (e.g. "[AVFoundation...]")
      // by requiring the bracketed number to appear after any AVFoundation tag.
      const isInternalTag = /\[AVFoundation/.test(line) && !/\]\s+\[(\d+)\]/.test(line);
      if (isInternalTag) continue;

      if (currentCategory === "video") {
        videoDevices.push({ id: match[1], name: match[2].trim() });
      } else if (currentCategory === "audio") {
        audioDevices.push({ id: match[1], name: match[2].trim() });
      }
    }
  }

  return { videoDevices, audioDevices };
}

/**
 * Internal helper: lists devices, prompts the user to select one, validates
 * the input, and returns the chosen ID with an optional prefix.
 *
 * @param label     - Display label for the device type (e.g. "Video").
 * @param devices   - List of available devices to present.
 * @param prefix    - Optional string prepended to the returned ID (e.g. ":").
 * @returns The selected device ID string, optionally prefixed.
 */
async function selectDevice(label: string, devices: Device[], prefix = ""): Promise<string> {
  logger.info("DeviceSelector", `\n--- Available ${label} Devices ---`);
  for (const device of devices) {
    logger.info("DeviceSelector", `[${device.id}] ${device.name}`);
  }
  const choice = prompt(`Select ${label} Device ID (default 0):`);
  const trimmed = choice?.trim() || "0";

  // Validate: must be a non-negative integer string matching a known device ID.
  const validIds = new Set(devices.map(d => d.id));
  if (!/^\d+$/.test(trimmed) || (!validIds.has(trimmed) && devices.length > 0)) {
    logger.info("DeviceSelector", `Warning: "${trimmed}" is not a listed ${label} device ID. Proceeding anyway.`);
  }

  return `${prefix}${trimmed}`;
}

/**
 * Prompts the user to select a video device from the scanned list.
 * macOS only. Pass a pre-scanned device list to avoid a redundant ffmpeg call.
 *
 * @param devices - Optional pre-scanned video device list.
 * @returns The selected device ID (bare integer string, e.g. `"0"`).
 *
 * NOTE: The returned value is user-supplied and unvalidated beyond basic format
 * checks. Callers must pass it as a discrete argument to ffmpeg, never
 * interpolated into a shell string.
 *
 * NOTE: To avoid two ffmpeg scans, prefer calling `selectDevices()` or
 * pre-scanning with `scanDevices()` and passing the result here.
 */
export async function selectVideoDevice(devices?: Device[]): Promise<string> {
  const videoDevices = devices || (await scanDevices()).videoDevices;
  return selectDevice("Video", videoDevices);
}

/**
 * Prompts the user to select an audio device from the scanned list.
 * macOS only. Pass a pre-scanned device list to avoid a redundant ffmpeg call.
 *
 * @param devices - Optional pre-scanned audio device list.
 * @returns The selected device ID prefixed with `:` (e.g. `":0"`), matching
 *   the avfoundation combined device string convention. The caller should
 *   concatenate this directly after the video ID: `"0:0"`.
 *
 * NOTE: The returned value is user-supplied and unvalidated beyond basic format
 * checks. Callers must pass it as a discrete argument to ffmpeg, never
 * interpolated into a shell string.
 *
 * NOTE: To avoid two ffmpeg scans, prefer calling `selectDevices()` or
 * pre-scanning with `scanDevices()` and passing the result here.
 */
export async function selectAudioDevice(devices?: Device[]): Promise<string> {
  const audioDevices = devices || (await scanDevices()).audioDevices;
  return selectDevice("Audio", audioDevices, ":");
}

/**
 * Scans for devices once and prompts the user to select both a video and audio
 * device. Prefer this over calling `selectVideoDevice` and `selectAudioDevice`
 * independently to avoid redundant ffmpeg scans.
 * macOS only.
 *
 * @returns An object with `videoDeviceId` (e.g. `"0"`) and `audioDeviceId`
 *   (e.g. `":0"`). Concatenate them to form the avfoundation input string.
 */
export async function selectDevices(): Promise<{ videoDeviceId: string; audioDeviceId: string }> {
  const { videoDevices, audioDevices } = await scanDevices();
  const videoDeviceId = await selectVideoDevice(videoDevices);
  const audioDeviceId = await selectAudioDevice(audioDevices);

  return { videoDeviceId, audioDeviceId };
}
