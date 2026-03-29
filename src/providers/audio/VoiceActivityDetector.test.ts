import { test, expect, describe, mock } from "bun:test";
import { VoiceActivityDetector } from "./VoiceActivityDetector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a s16le PCM buffer where every sample has a fixed value. */
function makePcmBuffer(sampleValue: number, sampleCount: number): Buffer {
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    buf.writeInt16LE(sampleValue, i * 2);
  }
  return buf;
}

/** Create a VAD with a low silence timeout so tests run fast. */
function makeVAD(overrides?: Parameters<typeof VoiceActivityDetector>[0]) {
  return new VoiceActivityDetector({ silenceDurationMs: 10, ...overrides });
}

// ---------------------------------------------------------------------------
// RMS energy calculation
// ---------------------------------------------------------------------------

describe("RMS energy calculation", () => {
  test("returns correct RMS for uniform samples", () => {
    const vad = makeVAD({ energyThreshold: 1 });
    // Single sample = 1000 → RMS = sqrt(1000²/1) = 1000
    const buf = makePcmBuffer(1000, 1);
    let started = false;
    vad.on("speech_started", () => (started = true));
    vad.processChunk(buf);
    // RMS(1000) > threshold(1) → speech detected
    expect(started).toBe(true);
  });

  test("zero-energy buffer does not trigger speech", () => {
    const vad = makeVAD({ energyThreshold: 1 });
    const buf = makePcmBuffer(0, 4);
    let started = false;
    vad.on("speech_started", () => (started = true));
    vad.processChunk(buf);
    expect(started).toBe(false);
  });

  test("odd-length buffer is handled without error (trailing byte ignored)", () => {
    const vad = makeVAD({ energyThreshold: 1 });
    const even = makePcmBuffer(1000, 2); // 4 bytes
    const odd = Buffer.concat([even, Buffer.alloc(1)]); // 5 bytes
    // Should not throw
    expect(() => vad.processChunk(odd)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// speech_started event and isRecording transition
// ---------------------------------------------------------------------------

describe("speech_started event", () => {
  test("emits speech_started when energy exceeds threshold", () => {
    const vad = makeVAD({ energyThreshold: 100 });
    const events: string[] = [];
    vad.on("speech_started", () => events.push("speech_started"));

    // High-energy chunk → above threshold
    vad.processChunk(makePcmBuffer(1000, 4));
    expect(events).toContain("speech_started");
  });

  test("emits speech_started only once per utterance", () => {
    const vad = makeVAD({ energyThreshold: 100 });
    let count = 0;
    vad.on("speech_started", () => count++);

    vad.processChunk(makePcmBuffer(1000, 4));
    vad.processChunk(makePcmBuffer(1000, 4));
    expect(count).toBe(1);
  });

  test("does not emit speech_started for silent input", () => {
    const vad = makeVAD({ energyThreshold: 100 });
    let started = false;
    vad.on("speech_started", () => (started = true));

    vad.processChunk(makePcmBuffer(0, 4));
    expect(started).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// speech_ended and utterance_complete
// ---------------------------------------------------------------------------

describe("speech_ended and utterance_complete", () => {
  test("emits speech_ended when silence follows speech", async () => {
    const vad = makeVAD({ energyThreshold: 100, silenceDurationMs: 20 });
    let ended = false;
    vad.on("speech_ended", () => (ended = true));

    vad.processChunk(makePcmBuffer(1000, 4)); // speech
    vad.processChunk(makePcmBuffer(0, 4));    // silence
    expect(ended).toBe(true);
  });

  test("emits utterance_complete after silence timeout", async () => {
    const vad = makeVAD({ energyThreshold: 100, silenceDurationMs: 20 });
    let utterance: Buffer | null = null;
    vad.on("utterance_complete", (buf: Buffer) => { utterance = buf; });

    vad.processChunk(makePcmBuffer(1000, 4));
    vad.processChunk(makePcmBuffer(0, 4));

    await Bun.sleep(40); // wait longer than silenceDurationMs
    expect(utterance).not.toBeNull();
  });

  test("utterance_complete payload contains all accumulated bytes", async () => {
    const vad = makeVAD({ energyThreshold: 100, silenceDurationMs: 20 });
    let utterance: Buffer | null = null;
    vad.on("utterance_complete", (buf: Buffer) => { utterance = buf; });

    const chunk1 = makePcmBuffer(1000, 4); // 8 bytes
    const chunk2 = makePcmBuffer(1000, 4); // 8 bytes
    const silenceChunk = makePcmBuffer(0, 4); // 8 bytes
    vad.processChunk(chunk1);
    vad.processChunk(chunk2);
    vad.processChunk(silenceChunk);

    await Bun.sleep(40);
    expect(utterance).not.toBeNull();
    expect(utterance!.length).toBe(chunk1.length + chunk2.length + silenceChunk.length);
  });

  test("silence before any speech is ignored", async () => {
    const vad = makeVAD({ energyThreshold: 100, silenceDurationMs: 20 });
    let ended = false;
    vad.on("speech_ended", () => (ended = true));

    vad.processChunk(makePcmBuffer(0, 4)); // silence before recording
    expect(ended).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Silence timer reset (continued speech)
// ---------------------------------------------------------------------------

describe("silence timer reset", () => {
  test("continued speech cancels the silence timer (no premature utterance_complete)", async () => {
    const vad = makeVAD({ energyThreshold: 100, silenceDurationMs: 30 });
    let utterances = 0;
    vad.on("utterance_complete", () => utterances++);

    vad.processChunk(makePcmBuffer(1000, 4));  // speech starts
    vad.processChunk(makePcmBuffer(0, 4));     // brief silence
    await Bun.sleep(10);                        // wait less than silenceDuration
    vad.processChunk(makePcmBuffer(1000, 4));  // more speech — resets timer
    await Bun.sleep(15);                        // total < 30ms since last silence chunk

    // No utterance should have completed yet
    expect(utterances).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Max buffer size
// ---------------------------------------------------------------------------

describe("max buffer size", () => {
  test("emits utterance_complete early when buffer exceeds maxBufferBytes", () => {
    const maxBufferBytes = 16; // Very small for testing
    const vad = makeVAD({ energyThreshold: 100, maxBufferBytes });
    let utterance: Buffer | null = null;
    vad.on("utterance_complete", (buf: Buffer) => { utterance = buf; });

    // Each chunk is 8 bytes (4 samples × 2 bytes); 2 chunks = 16 bytes = maxBufferBytes
    vad.processChunk(makePcmBuffer(1000, 4));
    vad.processChunk(makePcmBuffer(1000, 4));

    expect(utterance).not.toBeNull();
    expect(utterance!.length).toBe(16);
  });

  test("buffer is cleared after early emit", () => {
    const maxBufferBytes = 8;
    const vad = makeVAD({ energyThreshold: 100, maxBufferBytes });
    const utterances: Buffer[] = [];
    vad.on("utterance_complete", (buf: Buffer) => utterances.push(buf));

    // First overflow triggers first utterance_complete
    vad.processChunk(makePcmBuffer(1000, 4)); // 8 bytes = maxBufferBytes → emit

    // Start fresh
    expect(utterances).toHaveLength(1);
    expect(utterances[0].length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe("reset()", () => {
  test("cancels in-flight silence timer", async () => {
    const vad = makeVAD({ energyThreshold: 100, silenceDurationMs: 30 });
    let utterances = 0;
    vad.on("utterance_complete", () => utterances++);

    vad.processChunk(makePcmBuffer(1000, 4));
    vad.processChunk(makePcmBuffer(0, 4)); // starts silence timer
    vad.reset(); // cancel it

    await Bun.sleep(50); // wait past the timeout
    expect(utterances).toBe(0);
  });

  test("clears accumulated audio state", async () => {
    const vad = makeVAD({ energyThreshold: 100, silenceDurationMs: 20 });
    const utterances: Buffer[] = [];
    vad.on("utterance_complete", (buf: Buffer) => utterances.push(buf));

    vad.processChunk(makePcmBuffer(1000, 4)); // 8 bytes accumulated
    vad.reset();

    // Now add new speech + silence — should only contain post-reset bytes
    vad.processChunk(makePcmBuffer(1000, 2)); // 4 bytes
    vad.processChunk(makePcmBuffer(0, 2));    // 4 bytes → starts silence timer

    await Bun.sleep(40);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].length).toBe(8); // only 4+4 from after reset
  });
});

// ---------------------------------------------------------------------------
// Custom constructor options
// ---------------------------------------------------------------------------

describe("custom constructor options", () => {
  test("custom energyThreshold is respected", () => {
    const highThreshold = makeVAD({ energyThreshold: 30_000 });
    let started = false;
    highThreshold.on("speech_started", () => (started = true));
    // Sample value 1000 → RMS ≈ 1000, below 30,000 threshold
    highThreshold.processChunk(makePcmBuffer(1000, 4));
    expect(started).toBe(false);
  });

  test("custom silenceDurationMs is respected", async () => {
    const shortVad = makeVAD({ energyThreshold: 100, silenceDurationMs: 10 });
    const longVad = makeVAD({ energyThreshold: 100, silenceDurationMs: 200 });
    const shortUtterances: Buffer[] = [];
    const longUtterances: Buffer[] = [];
    shortVad.on("utterance_complete", (b: Buffer) => shortUtterances.push(b));
    longVad.on("utterance_complete", (b: Buffer) => longUtterances.push(b));

    shortVad.processChunk(makePcmBuffer(1000, 4));
    shortVad.processChunk(makePcmBuffer(0, 4));
    longVad.processChunk(makePcmBuffer(1000, 4));
    longVad.processChunk(makePcmBuffer(0, 4));

    await Bun.sleep(30); // shortVad should have fired, longVad should not

    expect(shortUtterances).toHaveLength(1);
    expect(longUtterances).toHaveLength(0);
  });
});
