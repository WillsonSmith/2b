import { EventEmitter } from "node:events";
import type { PermissionManager, PermissionRequest } from "../../core/PermissionManager.ts";
import { SessionCache } from "../../core/PermissionManager.ts";

export interface WebPermissionRequest {
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * PermissionManager for use with a WebSocket-based UI.
 * Queues permission requests and delivers/resolves them over the transport.
 */
export class WebPermissionManager extends EventEmitter implements PermissionManager {
  private readonly cache: SessionCache;
  private send: ((msg: unknown) => void) | null = null;
  private pendingResolve: ((approved: boolean) => void) | null = null;

  constructor(cache: SessionCache = new SessionCache()) {
    super();
    this.cache = cache;
  }

  /** Register the WebSocket send function so requests can be forwarded. */
  setTransport(send: (msg: unknown) => void): void {
    this.send = send;
  }

  isSessionApproved(toolName: string): boolean {
    return this.cache.has(toolName);
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    if (this.cache.has(request.toolName)) return true;

    return new Promise<boolean>((resolve) => {
      this.pendingResolve = resolve;
      this.send?.({
        type: "permission_request",
        request: {
          agentName: request.agentName,
          toolName: request.toolName,
          args: request.args,
        } satisfies WebPermissionRequest,
      });
    });
  }

  /** Called when the client responds to a permission dialog. */
  resolvePermission(approved: boolean, alwaysApprove: boolean): void {
    if (alwaysApprove && this.pendingResolve) {
      // We need the toolName to add to the cache — it arrives via the request
      // but we don't store it here. The caller (server.ts) must call
      // addSessionApproval() before resolvePermission() when alwaysApprove=true.
    }
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.(approved);
  }

  addSessionApproval(toolName: string): void {
    this.cache.add(toolName);
  }
}
