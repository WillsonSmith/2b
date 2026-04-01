import { test, expect, describe } from "bun:test";
import { InkPermissionManager } from "./InkPermissionManager.ts";
import { SessionCache } from "../../core/PermissionManager.ts";
import type { PendingPermission } from "./InkPermissionManager.ts";

const req = (toolName: string) => ({
  agentName: "TestAgent",
  toolName,
  args: { path: "test.txt" },
});

// ── isSessionApproved ─────────────────────────────────────────────────────────

describe("isSessionApproved", () => {
  test("returns false for unknown tool", () => {
    const pm = new InkPermissionManager();
    expect(pm.isSessionApproved("write_file")).toBe(false);
  });

  test("returns true after addSessionApproval", () => {
    const pm = new InkPermissionManager();
    pm.addSessionApproval("write_file");
    expect(pm.isSessionApproved("write_file")).toBe(true);
  });

  test("only affects the approved tool", () => {
    const pm = new InkPermissionManager();
    pm.addSessionApproval("write_file");
    expect(pm.isSessionApproved("delete_file")).toBe(false);
  });

  test("reflects a pre-populated SessionCache", () => {
    const cache = new SessionCache();
    cache.add("write_file");
    const pm = new InkPermissionManager(cache);
    expect(pm.isSessionApproved("write_file")).toBe(true);
  });
});

// ── requestApproval — session cache bypass ────────────────────────────────────

describe("requestApproval — session cache bypass", () => {
  test("returns true immediately without emitting an event when session-approved", async () => {
    const pm = new InkPermissionManager();
    pm.addSessionApproval("write_file");

    let eventFired = false;
    pm.on("permission_request", () => { eventFired = true; });

    const result = await pm.requestApproval(req("write_file"));

    expect(result).toBe(true);
    expect(eventFired).toBe(false);
  });
});

// ── requestApproval — event emission ─────────────────────────────────────────

describe("requestApproval — event emission", () => {
  test("emits 'permission_request' with the request and a resolve function", async () => {
    const pm = new InkPermissionManager();
    let captured: PendingPermission | null = null;

    pm.on("permission_request", (pending: PendingPermission) => {
      captured = pending;
      pending.resolve(true);
    });

    await pm.requestApproval(req("write_file"));

    expect(captured).not.toBeNull();
    expect(captured!.request.toolName).toBe("write_file");
    expect(captured!.request.agentName).toBe("TestAgent");
  });

  test("resolves true when listener calls resolve(true)", async () => {
    const pm = new InkPermissionManager();
    pm.on("permission_request", ({ resolve }: PendingPermission) => resolve(true));

    const result = await pm.requestApproval(req("write_file"));
    expect(result).toBe(true);
  });

  test("resolves false when listener calls resolve(false)", async () => {
    const pm = new InkPermissionManager();
    pm.on("permission_request", ({ resolve }: PendingPermission) => resolve(false));

    const result = await pm.requestApproval(req("write_file"));
    expect(result).toBe(false);
  });

  test("suspends until listener resolves", async () => {
    const pm = new InkPermissionManager();
    let resolvePermission!: (approved: boolean) => void;

    pm.on("permission_request", ({ resolve }: PendingPermission) => {
      resolvePermission = resolve;
    });

    let settled = false;
    const promise = pm.requestApproval(req("write_file")).then((v) => {
      settled = true;
      return v;
    });

    // Promise should not be settled yet
    await Promise.resolve(); // flush microtasks
    expect(settled).toBe(false);

    resolvePermission(true);
    const result = await promise;

    expect(settled).toBe(true);
    expect(result).toBe(true);
  });
});

// ── addSessionApproval — bypasses future requests ─────────────────────────────

describe("addSessionApproval", () => {
  test("subsequent requestApproval calls bypass the event after session approval", async () => {
    const pm = new InkPermissionManager();
    let eventCount = 0;

    pm.on("permission_request", ({ resolve }: PendingPermission) => {
      eventCount++;
      resolve(true);
    });

    // First call: not yet session-approved → event fires
    await pm.requestApproval(req("write_file"));
    expect(eventCount).toBe(1);

    // Grant session approval
    pm.addSessionApproval("write_file");

    // Second call: session-approved → no event
    await pm.requestApproval(req("write_file"));
    expect(eventCount).toBe(1);
  });
});

// ── Multiple concurrent requests ──────────────────────────────────────────────

describe("multiple concurrent requests", () => {
  test("each request gets its own independent pending object", async () => {
    const pm = new InkPermissionManager();
    const pending: PendingPermission[] = [];

    pm.on("permission_request", (p: PendingPermission) => pending.push(p));

    const p1 = pm.requestApproval(req("write_file"));
    const p2 = pm.requestApproval(req("delete_file"));

    expect(pending).toHaveLength(2);
    expect(pending[0]!.request.toolName).toBe("write_file");
    expect(pending[1]!.request.toolName).toBe("delete_file");

    // Resolve them in reverse order
    pending[1]!.resolve(false);
    pending[0]!.resolve(true);

    expect(await p1).toBe(true);
    expect(await p2).toBe(false);
  });
});
