import { test, expect, describe, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { AudioSystem } from "./AudioSystem";
import type { TranscriptionProvider, TranscriptionResult } from "./TranscriptionProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMic(): EventEmitter & { start: ReturnType<typeof mock>; stop: ReturnType<typeof mock> } {
  const mic = new EventEmitter() as any;
  mic.start = mock(() => {});
  mic.stop = mock(() => {});
  return mic;
}

/** Creates a minimal VAD EventEmitter. Real processChunk is irrelevant here. */
function makeVad() {
  const vad = new EventEmitter() as any;
  vad.processChunk = mock((chunk: Buffer) => {});
  return vad;
}

function makeTranscriber(response: TranscriptionResult = { text: "hello world", noSpeechProb: 0 }): TranscriptionProvider {
  return { transcribe: mock(async () => response) };
}

function makeSystem(
  transcriberOrResponse?: TranscriptionProvider | TranscriptionResult,
  mic?: any,
  vad?: any,
) {
  const m = mic ?? makeMic();
  const v = vad ?? makeVad();
  const t =
    transcriberOrResponse && "transcribe" in transcriberOrResponse
      ? transcriberOrResponse
      : makeTranscriber(transcriberOrResponse as TranscriptionResult | undefined);
  return { system: new AudioSystem(m, v, t), mic: m, vad: v, transcriber: t };
}

// ---------------------------------------------------------------------------
// Mic audio forwarding to VAD
// ---------------------------------------------------------------------------

describe("mic audio forwarding", () => {
  test("audio_chunk events from mic are forwarded to vad.processChunk", () => {
    const { system, mic, vad } = makeSystem();
    const chunk = Buffer.alloc(8, 0x01);
    mic.emit("audio_chunk", chunk);
    expect(vad.processChunk.mock.calls).toHaveLength(1);
    expect((vad.processChunk.mock.calls[0] as any[])[0]).toBe(chunk);
  });
});

// ---------------------------------------------------------------------------
// utterance_complete triggers transcription
// ---------------------------------------------------------------------------

describe("utterance_complete → transcription", () => {
  test("triggers transcription when VAD emits utterance_complete", async () => {
    const transcriber = makeTranscriber({ text: "hello", noSpeechProb: 0 });
    const { system, vad } = makeSystem(transcriber);

    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(5);

    expect((transcriber.transcribe as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
  });

  test("emits speech_detected with the transcription result", async () => {
    const transcriber = makeTranscriber({ text: "hello world", noSpeechProb: 0 });
    const { system, vad } = makeSystem(transcriber);
    const detected: TranscriptionResult[] = [];
    system.on("speech_detected", (r: TranscriptionResult) => detected.push(r));

    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(10);

    expect(detected).toHaveLength(1);
    expect(detected[0].text).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// Concurrent transcription guard
// ---------------------------------------------------------------------------

describe("concurrent transcription guard", () => {
  test("second utterance is dropped if first is still in progress", async () => {
    let resolveFirst: (() => void) | null = null;
    const slowTranscriber: TranscriptionProvider = {
      transcribe: mock(async () => {
        await new Promise<void>((r) => { resolveFirst = r; });
        return { text: "done", noSpeechProb: 0 };
      }),
    };
    const { system, vad } = makeSystem(slowTranscriber);

    // First utterance — starts transcription and hangs
    vad.emit("utterance_complete", Buffer.alloc(8));
    await Bun.sleep(2);

    // Second utterance — should be dropped
    vad.emit("utterance_complete", Buffer.alloc(8));
    await Bun.sleep(2);

    expect((slowTranscriber.transcribe as ReturnType<typeof mock>).mock.calls).toHaveLength(1);

    // Unblock to avoid leaked async operations
    resolveFirst?.();
    await Bun.sleep(5);
  });
});

// ---------------------------------------------------------------------------
// BLANK_AUDIO_TOKEN filtering
// ---------------------------------------------------------------------------

describe("BLANK_AUDIO_TOKEN filtering", () => {
  test("blank_audio result does not emit speech_detected", async () => {
    const transcriber = makeTranscriber({ text: "blank_audio", noSpeechProb: 1 });
    const { system, vad } = makeSystem(transcriber);
    let detected = false;
    system.on("speech_detected", () => { detected = true; });

    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(10);

    expect(detected).toBe(false);
  });

  test("blank_audio in mixed text does not emit speech_detected", async () => {
    const transcriber = makeTranscriber({ text: "hello blank_audio world", noSpeechProb: 0.5 });
    const { system, vad } = makeSystem(transcriber);
    let detected = false;
    system.on("speech_detected", () => { detected = true; });

    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(10);

    expect(detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Empty / whitespace-only transcription trimming
// ---------------------------------------------------------------------------

describe("transcription trimming", () => {
  test("whitespace-only result is discarded", async () => {
    const transcriber = makeTranscriber({ text: "   \n  ", noSpeechProb: 0 });
    const { system, vad } = makeSystem(transcriber);
    let detected = false;
    system.on("speech_detected", () => { detected = true; });

    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(10);

    expect(detected).toBe(false);
  });

  test("result with surrounding whitespace is emitted after trimming", async () => {
    const transcriber = makeTranscriber({ text: "  hello  ", noSpeechProb: 0 });
    const { system, vad } = makeSystem(transcriber);
    let detected = false;
    system.on("speech_detected", () => { detected = true; });

    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(10);

    // text.trim().length > 0 → should still emit
    expect(detected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Status events
// ---------------------------------------------------------------------------

describe("status events", () => {
  test("speech_started emits status_change 'listening'", () => {
    const { system, vad } = makeSystem();
    const statuses: string[] = [];
    system.on("status_change", (s: string) => statuses.push(s));

    vad.emit("speech_started");
    expect(statuses).toContain("listening");
  });

  test("utterance_complete emits 'transcribing' then 'idle' after transcription", async () => {
    const { system, vad } = makeSystem();
    const statuses: string[] = [];
    system.on("status_change", (s: string) => statuses.push(s));

    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(10);

    const transcribingIdx = statuses.indexOf("transcribing");
    const idleIdx = statuses.indexOf("idle");
    expect(transcribingIdx).toBeGreaterThanOrEqual(0);
    expect(idleIdx).toBeGreaterThan(transcribingIdx);
  });
});

// ---------------------------------------------------------------------------
// Transcription error handling
// ---------------------------------------------------------------------------

describe("transcription error handling", () => {
  test("transcription errors are caught and status returns to 'idle'", async () => {
    const errorTranscriber: TranscriptionProvider = {
      transcribe: mock(async () => { throw new Error("transcription failed"); }),
    };
    const { system, vad } = makeSystem(errorTranscriber);
    const statuses: string[] = [];
    system.on("status_change", (s: string) => statuses.push(s));

    // Should not throw
    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(10);

    expect(statuses).toContain("idle");
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe("destroy()", () => {
  test("unregisters mic listener so further chunks are not processed", () => {
    const { system, mic, vad } = makeSystem();
    system.destroy();

    mic.emit("audio_chunk", Buffer.alloc(8));
    expect(vad.processChunk.mock.calls).toHaveLength(0);
  });

  test("unregisters VAD listeners so further utterance_complete events are ignored", async () => {
    const transcriber = makeTranscriber();
    const { system, vad } = makeSystem(transcriber);
    system.destroy();

    vad.emit("utterance_complete", Buffer.alloc(16));
    await Bun.sleep(10);

    expect((transcriber.transcribe as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
  });

  test("removes all system listeners so no events are re-emitted", () => {
    const { system, vad } = makeSystem();
    let received = false;
    system.on("status_change", () => { received = true; });
    system.destroy();

    vad.emit("speech_started");
    expect(received).toBe(false);
  });
});
