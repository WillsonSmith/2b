import { useCallback, useEffect, useRef, useState } from "react";
import type { Subscribe } from "./useWebSocket.ts";

type AgentState = "idle" | "thinking" | "disconnected";

export function useVoiceAndMedia(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  setEditorContent: React.Dispatch<React.SetStateAction<string>>,
  onMicError: (text: string) => void,
  subscribe: Subscribe,
) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [altTextInsert, setAltTextInsert] = useState<string | null>(null);

  useEffect(() => {
    if (!altTextInsert) return;
    setEditorContent((prev) => {
      const sep = prev.trim() ? "\n\n" : "";
      return prev + sep + altTextInsert;
    });
    setAltTextInsert(null);
  }, [altTextInsert, setEditorContent]);

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const audioBase64 = dataUrl.split(",")[1] ?? "";
          wsRef.current?.send(JSON.stringify({
            type: "voice_data",
            audioBase64,
            mimeType: recorder.mimeType,
          }));
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      onMicError("[Error] Microphone access denied.");
    }
  }, [isRecording, wsRef, onMicError]);

  const handleImagePaste = useCallback(
    (base64: string, mimeType: string, filename: string) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "analyze_image", base64, mimeType, filename }));
    },
    [agentState, wsRef],
  );

  useEffect(() => {
    const unsubTranscript = subscribe("transcript", (msg) => {
      setEditorContent((prev) => {
        const sep = prev.trim() ? "\n\n" : "";
        return prev + sep + msg.text;
      });
    });
    const unsubAlt = subscribe("alt_text", (msg) => {
      setAltTextInsert(`![${msg.text}](data:${msg.mimeType};base64,${msg.base64})`);
    });
    return () => {
      unsubTranscript();
      unsubAlt();
    };
  }, [subscribe, setEditorContent]);

  return {
    isRecording,
    handleToggleRecording,
    handleImagePaste,
    setAltTextInsert,
  };
}
