import { test, expect, describe } from "bun:test";
import {
  SessionCache,
  AutoDenyPermissionManager,
  AutoApprovePermissionManager,
  ScriptedPermissionManager,
} from "./PermissionManager.ts";

const req = (toolName: string) => ({
  agentName: "TestAgent",
  toolName,
  args: { path: "test.txt" },
});

// ── SessionCache ──────────────────────────────────────────────────────────────

describe("SessionCache", () => {
  test("starts empty", () => {
    const cache = new SessionCache();
    expect(cache.has("write_file")).toBe(false);
  });

  test("add() makes has() return true", () => {
    const cache = new SessionCache();
    cache.add("write_file");
    expect(cache.has("write_file")).toBe(true);
  });

  test("only affects the added key", () => {
    const cache = new SessionCache();
    cache.add("write_file");
    expect(cache.has("download_file")).toBe(false);
  });
});

// ── AutoDenyPermissionManager ─────────────────────────────────────────────────

describe("AutoDenyPermissionManager", () => {
  test("always denies", async () => {
    const pm = new AutoDenyPermissionManager();
    expect(await pm.requestApproval(req("write_file"))).toBe(false);
  });

  test("isSessionApproved returns false when cache is empty", () => {
    const pm = new AutoDenyPermissionManager();
    expect(pm.isSessionApproved("write_file")).toBe(false);
  });

  test("isSessionApproved reflects shared cache", () => {
    const cache = new SessionCache();
    cache.add("write_file");
    const pm = new AutoDenyPermissionManager(cache);
    expect(pm.isSessionApproved("write_file")).toBe(true);
  });
});

// ── AutoApprovePermissionManager ──────────────────────────────────────────────

describe("AutoApprovePermissionManager", () => {
  test("always approves", async () => {
    const pm = new AutoApprovePermissionManager();
    expect(await pm.requestApproval(req("write_file"))).toBe(true);
  });

  test("isSessionApproved reflects cache", () => {
    const cache = new SessionCache();
    cache.add("write_file");
    const pm = new AutoApprovePermissionManager(cache);
    expect(pm.isSessionApproved("write_file")).toBe(true);
  });
});

// ── ScriptedPermissionManager ─────────────────────────────────────────────────

describe("ScriptedPermissionManager", () => {
  test("returns scripted true", async () => {
    const pm = new ScriptedPermissionManager({ write_file: true });
    expect(await pm.requestApproval(req("write_file"))).toBe(true);
  });

  test("returns scripted false", async () => {
    const pm = new ScriptedPermissionManager({ write_file: false });
    expect(await pm.requestApproval(req("write_file"))).toBe(false);
  });

  test("denies unlisted tools by default", async () => {
    const pm = new ScriptedPermissionManager({ write_file: true });
    expect(await pm.requestApproval(req("download_file"))).toBe(false);
  });

  test("isSessionApproved returns false with default empty cache", () => {
    const pm = new ScriptedPermissionManager({ write_file: true });
    expect(pm.isSessionApproved("write_file")).toBe(false);
  });

  test("isSessionApproved reflects a pre-populated SessionCache", () => {
    const cache = new SessionCache();
    cache.add("write_file");
    const pm = new ScriptedPermissionManager({}, cache);
    expect(pm.isSessionApproved("write_file")).toBe(true);
  });

  test("isSessionApproved returns false for tools not in the cache", () => {
    const cache = new SessionCache();
    cache.add("write_file");
    const pm = new ScriptedPermissionManager({}, cache);
    expect(pm.isSessionApproved("download_file")).toBe(false);
  });
});

// ── Shared session cache ──────────────────────────────────────────────────────

describe("Shared SessionCache across managers", () => {
  test("approval in one manager is visible to another sharing the cache", () => {
    const cache = new SessionCache();
    cache.add("write_file");
    const pm1 = new AutoApprovePermissionManager(cache);
    const pm2 = new AutoDenyPermissionManager(cache);
    expect(pm1.isSessionApproved("write_file")).toBe(true);
    expect(pm2.isSessionApproved("write_file")).toBe(true);
  });
});
