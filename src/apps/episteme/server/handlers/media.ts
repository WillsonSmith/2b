import type { ServerWebSocket } from "bun";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import type { ClientMsg } from "../../protocol.ts";
import { HeadlessAgent } from "../../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../../config.ts";
import { featureModel } from "../../config.ts";
import { explainCode } from "../../features/explain.ts";
import type { WsContext } from "../context.ts";

export type MediaMsg = Extract<
  ClientMsg,
  { type: "analyze_image" | "explain_code" | "voice_data" }
>;

const ALT_TEXT_SYSTEM =
  "You generate concise descriptive alt text for images. Return ONLY the alt text — " +
  "no quotes, no punctuation at the end, no explanation.";

let altTextAgent: HeadlessAgent | null = null;
function getAltTextAgent(config: EpistemeConfig): HeadlessAgent {
  if (!altTextAgent) {
    const llm = createProvider(featureModel(config, "default"));
    altTextAgent = new HeadlessAgent(llm, [], ALT_TEXT_SYSTEM, {
      agentName: "AltTextGenerator",
    });
  }
  return altTextAgent;
}

export async function handleMedia(
  msg: MediaMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  const { send, config } = ctx;

  switch (msg.type) {
    case "analyze_image": {
      const { base64, mimeType, filename } = msg;
      if (!base64) return;
      const ext = (mimeType.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "").slice(0, 10) || "png";
      const imagePath = join(tmpdir(), `episteme-img-${Date.now()}.${ext}`);
      try {
        const imageBuffer = Buffer.from(base64, "base64");
        await Bun.write(imagePath, imageBuffer);
        const hint = filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
        const altText = (await getAltTextAgent(config).ask(
          `Generate short descriptive alt text for an image. The filename is: "${hint}". Alt text:`,
        )).trim().replace(/^["']|["']$/g, "");
        send(ws, { type: "alt_text", text: altText });
      } catch {
        const fallback = filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
        send(ws, { type: "alt_text", text: fallback });
      } finally {
        await Bun.$`rm -f ${imagePath}`.quiet().catch(() => {});
      }
      return;
    }

    case "explain_code": {
      const { code, language } = msg;
      if (!code?.trim()) return;
      explainCode(code, language ?? "text", config).then((explanation) => {
        send(ws, { type: "explain_code_result", explanation });
      }).catch(() => {
        send(ws, { type: "error", message: "Failed to explain code." });
      });
      return;
    }

    case "voice_data": {
      const { audioBase64, mimeType } = msg;
      if (!audioBase64) return;

      const whisperCheck = await Bun.$`which whisper`.quiet().catch(() => null);
      if (!whisperCheck || whisperCheck.exitCode !== 0) {
        send(ws, {
          type: "error",
          message: "Whisper not installed. Run: pip install openai-whisper",
        });
        return;
      }

      try {
        const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
        const stamp = Date.now();
        const audioPath = join(tmpdir(), `episteme-voice-${stamp}.${ext}`);
        const audioBuffer = Buffer.from(audioBase64, "base64");
        await Bun.write(audioPath, audioBuffer);

        let transcribeInput = audioPath;
        const ffmpegCheck = await Bun.$`which ffmpeg`.quiet().catch(() => null);
        if (ffmpegCheck && ffmpegCheck.exitCode === 0 && ext !== "mp3") {
          const mp3Path = join(tmpdir(), `episteme-voice-${stamp}.mp3`);
          await Bun.$`ffmpeg -i ${audioPath} -q:a 0 -map a ${mp3Path} -y`.quiet();
          transcribeInput = mp3Path;
        }

        const outputDir = join(tmpdir(), "episteme-whisper");
        await Bun.$`mkdir -p ${outputDir}`.quiet();
        await Bun.$`whisper ${transcribeInput} --model base --output_format txt --output_dir ${outputDir}`.quiet();

        const txtFile = join(outputDir, basename(transcribeInput).replace(/\.[^.]+$/, ".txt"));
        const transcript = (await Bun.file(txtFile).text().catch(() => "")).trim();

        await Bun.$`rm -f ${audioPath} ${transcribeInput} ${txtFile}`.quiet().catch(() => {});

        if (transcript) {
          send(ws, { type: "transcript", text: transcript });
        } else {
          send(ws, { type: "error", message: "Could not transcribe audio." });
        }
      } catch {
        send(ws, { type: "error", message: "Voice transcription failed." });
      }
      return;
    }
  }
}
