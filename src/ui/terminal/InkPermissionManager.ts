import { EventEmitter } from "node:events";
import type { PermissionManager, PermissionRequest } from "../../core/PermissionManager.ts";
import { SessionCache } from "../../core/PermissionManager.ts";

export interface PendingPermission {
  request: PermissionRequest;
  resolve: (approved: boolean) => void;
}

/**
 * PermissionManager for use inside an Ink UI. Instead of reading from stdin
 * directly (which conflicts with Ink), it emits a "permission_request" event
 * and suspends until the Ink component resolves the promise.
 */
export class InkPermissionManager extends EventEmitter implements PermissionManager {
  private readonly cache: SessionCache;

  constructor(cache: SessionCache = new SessionCache()) {
    super();
    this.cache = cache;
  }

  isSessionApproved(toolName: string): boolean {
    return this.cache.has(toolName);
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    if (this.cache.has(request.toolName)) return true;

    return new Promise<boolean>((resolve) => {
      const pending: PendingPermission = { request, resolve };
      this.emit("permission_request", pending);
    });
  }

  addSessionApproval(toolName: string): void {
    this.cache.add(toolName);
  }
}
