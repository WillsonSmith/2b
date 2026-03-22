import { spawn } from "bun";
import { logger } from "../logger.ts";

export interface Device {
  id: string;
  name: string;
}

export async function scanDevices(): Promise<{ videoDevices: Device[]; audioDevices: Device[] }> {
  logger.info("DeviceSelector", "Scanning for available video and audio devices...");
  
  const proc = spawn(["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", '""'], {
    stderr: "pipe",
    stdout: "ignore"
  });
  
  const text = await new Response(proc.stderr).text(); 
  
  const videoDevices: Device[] = [];
  const audioDevices: Device[] = [];
  
  let currentCategory = "";
  
  for (const line of text.split("\n")) {
    if (line.includes("AVFoundation video devices:")) {
      currentCategory = "video";
      continue;
    }
    if (line.includes("AVFoundation audio devices:")) {
      currentCategory = "audio";
      continue;
    }
    
    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match && match[1] && match[2]) {
      if (currentCategory === "video") {
        videoDevices.push({ id: match[1], name: match[2].trim() });
      } else if (currentCategory === "audio") {
        audioDevices.push({ id: match[1], name: match[2].trim() });
      }
    }
  }

  return { videoDevices, audioDevices };
}

export async function selectVideoDevice(devices?: Device[]): Promise<string> {
  const videoDevices = devices || (await scanDevices()).videoDevices;

  logger.info("DeviceSelector", "\n--- Available Video Devices ---");
  videoDevices.forEach(device => {
    logger.info("DeviceSelector", `[${device.id}] ${device.name}`);
  });
  let videoChoice = prompt("Select Video Device ID (default 0):");
  const videoDeviceId = videoChoice?.trim() || "0";
  return videoDeviceId;
}

export async function selectAudioDevice(devices?: Device[]): Promise<string> {
  const audioDevices = devices || (await scanDevices()).audioDevices;

  logger.info("DeviceSelector", "\n--- Available Audio Devices ---");
  audioDevices.forEach(device => {
    logger.info("DeviceSelector", `[${device.id}] ${device.name}`);
  });
  let audioChoice = prompt("Select Audio Device ID (default 0):");
  const audioDeviceId = `:${audioChoice?.trim() || "0"}`;
  return audioDeviceId;
}

export async function selectDevices(): Promise<{ videoDeviceId: string; audioDeviceId: string }> {
  const { videoDevices, audioDevices } = await scanDevices();
  const videoDeviceId = await selectVideoDevice(videoDevices);
  const audioDeviceId = await selectAudioDevice(audioDevices);

  return { videoDeviceId, audioDeviceId };
}
