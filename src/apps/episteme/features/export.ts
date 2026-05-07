import { join } from "node:path";
import { tmpdir } from "node:os";

export type ExportFormat = "pdf" | "html";

export interface ExportOptions {
  format: ExportFormat;
  includeFrontmatter: boolean;
}

export let pandocAvailable = false;

export async function checkPandoc(): Promise<boolean> {
  try {
    const result = await Bun.$`which pandoc`.quiet();
    pandocAvailable = result.exitCode === 0;
  } catch {
    pandocAvailable = false;
  }
  return pandocAvailable;
}

export async function exportDocument(
  content: string,
  baseFilename: string,
  options: ExportOptions,
): Promise<{ path: string; filename: string }> {
  if (!pandocAvailable) {
    throw new Error("Pandoc not found. Install it with: brew install pandoc");
  }

  const exportDir = join(tmpdir(), "episteme-exports");
  await Bun.$`mkdir -p ${exportDir}`.quiet();

  const stamp = Date.now();
  const baseName = baseFilename.replace(/\.md$/i, "");
  const inputPath = join(exportDir, `${baseName}-${stamp}-input.md`);
  const ext = options.format === "pdf" ? "pdf" : "html";
  const outputFilename = `${baseName}-${stamp}.${ext}`;
  const outputPath = join(exportDir, outputFilename);

  let mdContent = content;
  if (!options.includeFrontmatter && content.startsWith("---\n")) {
    const end = content.indexOf("\n---\n", 4);
    if (end !== -1) mdContent = content.slice(end + 5);
  }

  await Bun.write(inputPath, mdContent);

  if (options.format === "pdf") {
    await Bun.$`pandoc ${inputPath} -o ${outputPath}`.quiet();
  } else {
    await Bun.$`pandoc ${inputPath} -o ${outputPath} --standalone --embed-resources`.quiet();
  }

  await Bun.$`rm -f ${inputPath}`.quiet();
  return { path: outputPath, filename: outputFilename };
}
