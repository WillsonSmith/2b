import type { AgentPlugin } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { AudioSystem } from "../providers/audio/AudioSystem.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import { logger } from "../logger.ts";

export class AudioPlugin implements AgentPlugin {
  name = "Audio";

  constructor(
    private audio: AudioSystem,
    private llm: LLMProvider,
  ) {}

  getContext() {
    return `
You have a microphone and can hear your environment.
Incoming audio is categorized for you:
- [Heard "text"] : The user is speaking directly to you. You
should respond.
- [Overheard background conversation: "text"] : People are
talking nearby, but not to you. Do not reply unless necessary.
- [Ambient sound: text] or [Background noise: text] :
Environmental noises.

CRITICAL INSTRUCTION FOR YOUR OUTPUT:
When you speak, DO NOT wrap your text in brackets. Speak
normally. Brackets are strictly used for incoming sensory data.
        `;
  }

  onInit(agent: BaseAgent) {
    logger.info("Audio", "Plugin initialized.");
    this.audio.on(
      "speech_detected",
      async (result: { text: string; noSpeechProb: number }) => {
        const { text, noSpeechProb } = result;

        // Tier 1: Ambient Sound markers (Whisper formatting)
        const isAmbientMarker =
          (text.startsWith("[") && text.endsWith("]")) ||
          (text.startsWith("(") && text.endsWith(")"));

        if (isAmbientMarker) {
          agent.addPerception(`[Ambient sound: ${text}]`, { forceTick: false });
          return;
        }

        // Tier 2: High No-Speech Probability
        // If the model is confident there is no speech, treat it as ambient noise
        if (noSpeechProb > 0.7) {
          agent.addPerception(`[Background noise: ${text}]`, {
            forceTick: false,
          });
          return;
        }

        // Tier 3: Fast Intent Classification
        // Determine if the speech is directed at the agent or is background chatter
        const intentPrompt = `
Determine if the following transcribed audio is directed at you (the AI assistant) or if it is background conversation/noise.
Transcript: "${text}"

Reply with ONLY 'YES' if it is directed at you, or 'NO' if it is not.
      `.trim();

        try {
          const { nonReasoningContent: intentResponse } = await this.llm.chat(
            [{ role: "user", content: intentPrompt }],
            "You are a fast intent classifier. Respond ONLY with YES or NO.",
          );

          logger.debug("Audio", `Intent responded with: ${intentResponse}`);

          if (intentResponse.toUpperCase().includes("YES")) {
            // Barge-in: immediately stop talking and process the command
            agent.interrupt();
            agent.addPerception(`[Heard "${text}"]`, { forceTick: true });
          } else {
            // Passive perception: notice it but don't interrupt
            agent.addPerception(
              `[Overheard background conversation: "${text}"]`,
              {
                forceTick: false,
              },
            );
          }
        } catch (error) {
          logger.error("Audio", "Intent classification failed:", error);
          // Fallback: treat as intentional to be safe
          agent.interrupt();
          agent.addPerception(`[Heard "${text}"]`, { forceTick: true });
        }
      },
    );
  }
}
