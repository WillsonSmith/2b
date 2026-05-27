import { test, expect, describe } from "bun:test";
import { TickMetricsAggregator } from "./TickMetricsAggregator";
import type { TickMetrics } from "./types";

function tick(overrides: Partial<TickMetrics> = {}): TickMetrics {
  return {
    totalMs: 100,
    llmMs: 80,
    collectMessagesMs: 5,
    collectSystemPromptMs: 10,
    pluginContextMs: {},
    augmentMs: 1,
    dispatchMs: 2,
    systemPromptChars: 1000,
    toolsChars: 5000,
    historyChars: 2000,
    toolCount: 10,
    contextContributors: 3,
    toolsCalled: {},
    ignored: false,
    errored: false,
    retries: 0,
    emptyResponseRetries: 0,
    aborted: false,
    queueDepthAtStart: 0,
    ...overrides,
  };
}

describe("TickMetricsAggregator", () => {
  test("empty aggregator returns zeroed snapshot", () => {
    const agg = new TickMetricsAggregator(10);
    const snap = agg.snapshot();
    expect(snap.sampleCount).toBe(0);
    expect(snap.avg.totalMs).toBe(0);
    expect(snap.pluginContextMs).toEqual([]);
    expect(snap.toolsCalled).toEqual([]);
  });

  test("records ticks and computes averages", () => {
    const agg = new TickMetricsAggregator(10);
    agg.record(tick({ totalMs: 100, llmMs: 80 }));
    agg.record(tick({ totalMs: 200, llmMs: 160 }));

    const snap = agg.snapshot();
    expect(snap.sampleCount).toBe(2);
    expect(snap.avg.totalMs).toBe(150);
    expect(snap.avg.llmMs).toBe(120);
  });

  test("evicts oldest when capacity exceeded", () => {
    const agg = new TickMetricsAggregator(2);
    agg.record(tick({ totalMs: 100 }));
    agg.record(tick({ totalMs: 200 }));
    agg.record(tick({ totalMs: 300 }));

    expect(agg.size).toBe(2);
    expect(agg.snapshot().avg.totalMs).toBe(250); // (200+300)/2
  });

  test("aggregates per-plugin context times and sorts descending by avgMs", () => {
    const agg = new TickMetricsAggregator(10);
    agg.record(tick({ pluginContextMs: { Slow: 50, Fast: 1, Medium: 10 } }));
    agg.record(tick({ pluginContextMs: { Slow: 70, Fast: 2, Medium: 15 } }));

    const snap = agg.snapshot();
    expect(snap.pluginContextMs.map(r => r.name)).toEqual(["Slow", "Medium", "Fast"]);
    expect(snap.pluginContextMs[0]!.avgMs).toBe(60);
    expect(snap.pluginContextMs[0]!.maxMs).toBe(70);
    expect(snap.pluginContextMs[0]!.samples).toBe(2);
  });

  test("counts ignored ticks", () => {
    const agg = new TickMetricsAggregator(10);
    agg.record(tick({ ignored: true }));
    agg.record(tick({ ignored: false }));
    agg.record(tick({ ignored: true }));

    const snap = agg.snapshot();
    expect(snap.ignoredCount).toBe(2);
    expect(snap.sampleCount).toBe(3);
  });

  test("plugin appearing in only some ticks is averaged over its sample count", () => {
    const agg = new TickMetricsAggregator(10);
    agg.record(tick({ pluginContextMs: { A: 10 } }));
    agg.record(tick({ pluginContextMs: { A: 20, B: 5 } }));

    const snap = agg.snapshot();
    const a = snap.pluginContextMs.find(r => r.name === "A")!;
    const b = snap.pluginContextMs.find(r => r.name === "B")!;
    expect(a.avgMs).toBe(15);
    expect(a.samples).toBe(2);
    expect(b.avgMs).toBe(5);
    expect(b.samples).toBe(1);
  });

  test("clear empties the window", () => {
    const agg = new TickMetricsAggregator(10);
    agg.record(tick());
    agg.clear();
    expect(agg.size).toBe(0);
    expect(agg.snapshot().sampleCount).toBe(0);
  });

  test("rejects capacity < 1", () => {
    expect(() => new TickMetricsAggregator(0)).toThrow(RangeError);
  });

  test("aggregates per-tool call counts and sorts descending by totalCalls", () => {
    const agg = new TickMetricsAggregator(10);
    agg.record(tick({ toolsCalled: { read_file: 3, write_file: 1 } }));
    agg.record(tick({ toolsCalled: { read_file: 2, search: 1 } }));
    agg.record(tick({ toolsCalled: {} }));

    const snap = agg.snapshot();
    expect(snap.toolsCalled.map(r => r.name)).toEqual(["read_file", "write_file", "search"]);

    const read = snap.toolsCalled[0]!;
    expect(read.totalCalls).toBe(5);
    expect(read.ticksUsed).toBe(2);
    expect(read.callsPerTick).toBeCloseTo(5 / 3);

    const write = snap.toolsCalled[1]!;
    expect(write.totalCalls).toBe(1);
    expect(write.ticksUsed).toBe(1);

    const search = snap.toolsCalled[2]!;
    expect(search.totalCalls).toBe(1);
    expect(search.ticksUsed).toBe(1);
  });

  test("ignores zero-count tool entries", () => {
    const agg = new TickMetricsAggregator(10);
    agg.record(tick({ toolsCalled: { ghost: 0, real: 2 } }));

    const snap = agg.snapshot();
    expect(snap.toolsCalled.map(r => r.name)).toEqual(["real"]);
  });
});
