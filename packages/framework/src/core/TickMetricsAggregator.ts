import type { TickMetrics } from "./types.ts";

/**
 * Rolling buffer of TickMetrics with derived aggregates.
 *
 * Subscribe an instance to a BaseAgent's `tick_metrics` event and call
 * `snapshot()` to read summary stats. Cheap: O(N) over the window per snapshot.
 *
 *     const agg = new TickMetricsAggregator(50);
 *     agent.on("tick_metrics", (m) => agg.record(m));
 *     const stats = agg.snapshot();
 *
 * Default window size is 50 ticks.
 */
export class TickMetricsAggregator {
  private readonly capacity: number;
  private readonly buffer: TickMetrics[] = [];

  constructor(capacity = 50) {
    if (capacity < 1) throw new RangeError("TickMetricsAggregator capacity must be >= 1");
    this.capacity = capacity;
  }

  record(m: TickMetrics): void {
    this.buffer.push(m);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  clear(): void {
    this.buffer.length = 0;
  }

  /** Number of ticks currently in the window. */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Aggregated view across the current window.
   * `pluginContextMs` is averaged per plugin name and sorted descending by avgMs
   * (the dev-tool-friendly order).
   */
  snapshot(): TickMetricsSnapshot {
    const n = this.buffer.length;
    if (n === 0) return EMPTY_SNAPSHOT;

    let totalMs = 0;
    let llmMs = 0;
    let collectMessagesMs = 0;
    let collectSystemPromptMs = 0;
    let augmentMs = 0;
    let dispatchMs = 0;
    let systemPromptChars = 0;
    let toolsChars = 0;
    let historyChars = 0;
    let toolCount = 0;
    let contextContributors = 0;
    let ignoredCount = 0;
    let erroredCount = 0;
    let abortedCount = 0;
    let retriesSum = 0;
    let queueDepthAtStartSum = 0;
    let queueDepthAtStartMax = 0;

    // sum and per-plugin sum
    const pluginTotals = new Map<string, { sum: number; count: number; max: number }>();
    // per-tool: total invocations, ticks where tool was used at least once
    const toolTotals = new Map<string, { totalCalls: number; ticksUsed: number }>();

    for (const m of this.buffer) {
      // The following three counters reflect what happened in the window
      // regardless of success/failure — retries and aborts in errored ticks
      // still occurred; queue depth at start is observed before the failure.
      retriesSum += m.retries;
      if (m.aborted) abortedCount++;
      queueDepthAtStartSum += m.queueDepthAtStart;
      if (m.queueDepthAtStart > queueDepthAtStartMax) queueDepthAtStartMax = m.queueDepthAtStart;
      if (m.errored) {
        // Errored ticks have partial timings — including them would skew the
        // success-path averages. Count them but exclude from timing/size sums.
        erroredCount++;
        continue;
      }
      totalMs += m.totalMs;
      llmMs += m.llmMs;
      collectMessagesMs += m.collectMessagesMs;
      collectSystemPromptMs += m.collectSystemPromptMs;
      augmentMs += m.augmentMs;
      dispatchMs += m.dispatchMs;
      systemPromptChars += m.systemPromptChars;
      toolsChars += m.toolsChars;
      historyChars += m.historyChars;
      toolCount += m.toolCount;
      contextContributors += m.contextContributors;
      if (m.ignored) ignoredCount++;

      for (const [name, ms] of Object.entries(m.pluginContextMs)) {
        const entry = pluginTotals.get(name) ?? { sum: 0, count: 0, max: 0 };
        entry.sum += ms;
        entry.count++;
        if (ms > entry.max) entry.max = ms;
        pluginTotals.set(name, entry);
      }

      for (const [name, calls] of Object.entries(m.toolsCalled)) {
        if (calls <= 0) continue;
        const entry = toolTotals.get(name) ?? { totalCalls: 0, ticksUsed: 0 };
        entry.totalCalls += calls;
        entry.ticksUsed++;
        toolTotals.set(name, entry);
      }
    }

    // Successful-tick denominator for averages. When every tick in the window
    // errored, fall back to 1 to avoid NaN — the resulting averages are all 0.
    const successCount = n - erroredCount;
    const avgDenom = successCount === 0 ? 1 : successCount;

    const pluginContextMs: PluginAggregateRow[] = [...pluginTotals.entries()]
      .map(([name, e]) => ({
        name,
        avgMs: e.sum / e.count,
        maxMs: e.max,
        samples: e.count,
      }))
      .sort((a, b) => b.avgMs - a.avgMs);

    const toolsCalled: ToolAggregateRow[] = [...toolTotals.entries()]
      .map(([name, e]) => ({
        name,
        totalCalls: e.totalCalls,
        ticksUsed: e.ticksUsed,
        callsPerTick: e.totalCalls / n,
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls);

    return {
      sampleCount: n,
      ignoredCount,
      erroredCount,
      abortedCount,
      retriesSum,
      avg: {
        totalMs: totalMs / avgDenom,
        llmMs: llmMs / avgDenom,
        collectMessagesMs: collectMessagesMs / avgDenom,
        collectSystemPromptMs: collectSystemPromptMs / avgDenom,
        augmentMs: augmentMs / avgDenom,
        dispatchMs: dispatchMs / avgDenom,
        systemPromptChars: systemPromptChars / avgDenom,
        toolsChars: toolsChars / avgDenom,
        historyChars: historyChars / avgDenom,
        toolCount: toolCount / avgDenom,
        contextContributors: contextContributors / avgDenom,
        retries: retriesSum / n,
        queueDepthAtStart: queueDepthAtStartSum / n,
      },
      maxQueueDepthAtStart: queueDepthAtStartMax,
      pluginContextMs,
      toolsCalled,
    };
  }
}

export interface PluginAggregateRow {
  name: string;
  avgMs: number;
  maxMs: number;
  samples: number;
}

export interface ToolAggregateRow {
  name: string;
  /** Total invocations across the window. */
  totalCalls: number;
  /** Number of ticks where this tool was called at least once. */
  ticksUsed: number;
  /** totalCalls / sampleCount — fractional average per tick. */
  callsPerTick: number;
}

export interface TickMetricsSnapshot {
  sampleCount: number;
  ignoredCount: number;
  /** Number of ticks in the window that threw before completing. */
  erroredCount: number;
  /** Number of ticks in the window whose AbortController fired before act() returned. */
  abortedCount: number;
  /** Total tool-retry attempts charged across the window (sum, not average). */
  retriesSum: number;
  avg: {
    totalMs: number;
    llmMs: number;
    collectMessagesMs: number;
    collectSystemPromptMs: number;
    augmentMs: number;
    dispatchMs: number;
    systemPromptChars: number;
    toolsChars: number;
    historyChars: number;
    toolCount: number;
    contextContributors: number;
    /** Mean retries per tick across the window (includes errored ticks in the denominator). */
    retries: number;
    /** Mean combined queue depth at start across all ticks in the window. */
    queueDepthAtStart: number;
  };
  /** Largest combined queue depth observed at start of any tick in the window. */
  maxQueueDepthAtStart: number;
  pluginContextMs: PluginAggregateRow[];
  /** Per-tool invocation totals across the window, sorted descending by totalCalls. */
  toolsCalled: ToolAggregateRow[];
}

const EMPTY_SNAPSHOT: TickMetricsSnapshot = {
  sampleCount: 0,
  ignoredCount: 0,
  erroredCount: 0,
  abortedCount: 0,
  retriesSum: 0,
  avg: {
    totalMs: 0,
    llmMs: 0,
    collectMessagesMs: 0,
    collectSystemPromptMs: 0,
    augmentMs: 0,
    dispatchMs: 0,
    systemPromptChars: 0,
    toolsChars: 0,
    historyChars: 0,
    toolCount: 0,
    contextContributors: 0,
    retries: 0,
    queueDepthAtStart: 0,
  },
  maxQueueDepthAtStart: 0,
  pluginContextMs: [],
  toolsCalled: [],
};
