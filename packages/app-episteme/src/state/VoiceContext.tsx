import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { signal, useConstant, type Signal } from "./signals.ts";
import type { useVoiceAndMedia } from "../hooks/useVoiceAndMedia.ts";

type VoiceReturn = ReturnType<typeof useVoiceAndMedia>;

export interface VoiceContextValue {
  isRecording: Signal<boolean>;
  handleToggleRecording: () => void;
  handleImagePaste: (base64: string, mimeType: string, filename: string) => void;
}

const Ctx = createContext<VoiceContextValue | null>(null);

export function useVoice(): VoiceContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVoice must be used inside <VoiceProvider>");
  return v;
}

interface VoiceProviderProps {
  voice: VoiceReturn;
  children: ReactNode;
}

export function VoiceProvider({ voice, children }: VoiceProviderProps) {
  const vRef = useRef(voice);
  vRef.current = voice;

  const value = useConstant<VoiceContextValue>(() => {
    const isRecording = signal(false);
    return {
      isRecording,
      handleToggleRecording: () => {},
      handleImagePaste: () => {},
    };
  });

  useEffect(() => {
    value.handleToggleRecording = () => vRef.current.handleToggleRecording();
    value.handleImagePaste = (b, m, f) => vRef.current.handleImagePaste(b, m, f);
  }, [value]);

  useEffect(() => {
    value.isRecording.value = voice.isRecording;
  });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
