import { join, resolve } from "node:path";
import { mkdir, rename, unlink } from "node:fs/promises";
import type { AgentPlugin } from "@2b/framework/core/Plugin.ts";
import type { StyleBudget, StyleGuideManifest, StyleSection } from "./types.ts";
import { findLibrarySection } from "./library/index.ts";

const BUDGET_CAP = 4000;

/**
 * Section-based workspace style guide. Bodies live in
 * `.episteme/style-guide/<id>.md`; order and enabled state live in
 * `manifest.json`. The plugin is always active — it has no tool surface and no
 * activation gate. The agent simply consumes the assembled system-prompt
 * fragment.
 *
 * All writes funnel through `enqueue` so concurrent PATCHes from multiple tabs
 * don't interleave file writes. Episteme is single-server / single-workspace,
 * so an in-process promise chain is sufficient.
 */
export class StyleGuidePlugin implements AgentPlugin {
  name = "StyleGuide";

  private sections: StyleSection[] = [];
  private writeChain: Promise<unknown> = Promise.resolve();

  private readonly dir: string;
  private readonly manifestPath: string;
  private readonly legacyPath: string;
  private readonly legacyBackupPath: string;

  constructor(workspaceRoot: string) {
    const root = resolve(workspaceRoot);
    this.dir = join(root, ".episteme", "style-guide");
    this.manifestPath = join(this.dir, "manifest.json");
    this.legacyPath = join(root, ".episteme", "style-guide.md");
    this.legacyBackupPath = join(root, ".episteme", "style-guide.legacy.md");
  }

  async onInit(): Promise<void> {
    await this.migrateLegacyIfNeeded();
    await this.reload();
  }

  /** Re-read manifest + all section files into memory. */
  async reload(): Promise<void> {
    const manifest = await this.readManifest();
    const loaded: StyleSection[] = [];
    for (const entry of manifest.sections) {
      let body = "";
      try {
        body = await Bun.file(this.sectionPath(entry.id)).text();
      } catch {
        body = "";
      }
      loaded.push({ ...entry, body });
    }
    loaded.sort((a, b) => a.order - b.order);
    this.sections = loaded;
  }

  // --- Prompt fragment + budget ------------------------------------------

  getSystemPromptFragment(): string {
    const { included } = this.assemble();
    if (included.length === 0) return "";
    const parts = included.map((s) => `### ${s.title}\n${s.body.trim()}`);
    return (
      "## Style Guide\n" +
      "A style guide is active. It takes precedence over default voice and formatting when editing or generating text.\n\n" +
      parts.join("\n\n")
    );
  }

  getBudget(): StyleBudget {
    const { used, dropped } = this.assemble();
    return { used, cap: BUDGET_CAP, droppedSectionIds: dropped.map((s) => s.id) };
  }

  /**
   * Greedily include enabled sections in order until the cumulative body length
   * would exceed the cap; drop the rest (highest `order` first). `used` is the
   * total length of all enabled bodies, so the meter can show an over-budget
   * state even though over-budget sections are dropped from the prompt.
   */
  private assemble(): { included: StyleSection[]; dropped: StyleSection[]; used: number } {
    const enabled = this.sections
      .filter((s) => s.enabled)
      .sort((a, b) => a.order - b.order);
    const included: StyleSection[] = [];
    const dropped: StyleSection[] = [];
    let running = 0;
    let used = 0;
    let overflowing = false;
    for (const section of enabled) {
      const len = section.body.trim().length;
      used += len;
      if (!overflowing && running + len <= BUDGET_CAP) {
        running += len;
        included.push(section);
      } else {
        overflowing = true;
        dropped.push(section);
      }
    }
    return { included, dropped, used };
  }

  // --- CRUD ---------------------------------------------------------------

  listSections(): StyleSection[] {
    return this.sections.map((s) => ({ ...s }));
  }

  createSection(input: { title: string; body: string }): Promise<StyleSection> {
    return this.enqueue(async () => {
      const title = input.title.trim() || "Untitled";
      const id = this.uniqueId(title);
      const order = this.sections.reduce((max, s) => Math.max(max, s.order), -1) + 1;
      const section: StyleSection = { id, title, body: input.body, enabled: true, order };
      this.sections.push(section);
      await Bun.write(this.sectionPath(id), section.body);
      await this.writeManifest();
      return { ...section };
    });
  }

  updateSection(
    id: string,
    patch: Partial<Pick<StyleSection, "title" | "body" | "enabled">>,
  ): Promise<StyleSection> {
    return this.enqueue(async () => {
      const section = this.sections.find((s) => s.id === id);
      if (!section) throw new Error(`No style section "${id}".`);
      let bodyChanged = false;
      if (patch.title !== undefined) section.title = patch.title.trim() || "Untitled";
      if (patch.enabled !== undefined) section.enabled = patch.enabled;
      if (patch.body !== undefined && patch.body !== section.body) {
        section.body = patch.body;
        bodyChanged = true;
      }
      if (bodyChanged) await Bun.write(this.sectionPath(id), section.body);
      await this.writeManifest();
      return { ...section };
    });
  }

  deleteSection(id: string): Promise<void> {
    return this.enqueue(async () => {
      const idx = this.sections.findIndex((s) => s.id === id);
      if (idx === -1) return;
      this.sections.splice(idx, 1);
      this.normalizeOrder();
      await unlink(this.sectionPath(id)).catch(() => {});
      await this.writeManifest();
    });
  }

  reorder(orderedIds: string[]): Promise<void> {
    return this.enqueue(async () => {
      const rank = new Map(orderedIds.map((id, i) => [id, i]));
      this.sections.sort((a, b) => {
        const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ra - rb;
      });
      this.normalizeOrder();
      await this.writeManifest();
    });
  }

  importFromLibrary(librarySlug: string): Promise<StyleSection> {
    const item = findLibrarySection(librarySlug);
    if (!item) return Promise.reject(new Error(`No library section "${librarySlug}".`));
    return this.createSection({ title: item.title, body: item.body });
  }

  // --- Internals ----------------------------------------------------------

  private sectionPath(id: string): string {
    return join(this.dir, `${id}.md`);
  }

  /** Reindex `order` to match the current array position. Callers keep the
   * array in the intended display order; this just makes `order` contiguous. */
  private normalizeOrder(): void {
    this.sections.forEach((s, i) => { s.order = i; });
  }

  private uniqueId(title: string): string {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "section";
    const taken = new Set(this.sections.map((s) => s.id));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  private async readManifest(): Promise<StyleGuideManifest> {
    try {
      const raw = await Bun.file(this.manifestPath).json();
      if (raw && Array.isArray(raw.sections)) {
        return { version: 1, sections: raw.sections };
      }
    } catch {
      /* missing or malformed — treat as empty */
    }
    return { version: 1, sections: [] };
  }

  private async writeManifest(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const manifest: StyleGuideManifest = {
      version: 1,
      sections: this.sections
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(({ id, title, enabled, order }) => ({ id, title, enabled, order })),
    };
    await Bun.write(this.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }

  /** Serialize all writes so concurrent PATCHes can't interleave. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(op, op);
    // Keep the chain alive even if this op rejects; swallow here, surface to caller.
    this.writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * One-time migration of the legacy single-file style guide into a "Default"
   * section. Idempotent: if the manifest already exists, this is a no-op.
   */
  private async migrateLegacyIfNeeded(): Promise<void> {
    if (await Bun.file(this.manifestPath).exists()) return;

    const legacy = Bun.file(this.legacyPath);
    let content = "";
    if (await legacy.exists()) {
      content = (await legacy.text()).trim();
    }

    await mkdir(this.dir, { recursive: true });

    if (content) {
      await Bun.write(this.sectionPath("default"), content);
      this.sections = [{ id: "default", title: "Default", body: content, enabled: true, order: 0 }];
      await this.writeManifest();
      // Preserve the old file for recovery rather than deleting it.
      await rename(this.legacyPath, this.legacyBackupPath).catch(() => {});
    } else {
      this.sections = [];
      await this.writeManifest();
    }
  }
}
