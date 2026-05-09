import { join } from "node:path";
import { tmpdir } from "node:os";
import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const DEEP_INGEST_SYSTEM = `You are a research assistant performing structured extraction from academic or technical content.
Extract and organize the content into the following Markdown template exactly. Fill every section with relevant content.
If a section's information is not present in the source, write "Not explicitly stated."

---
title: "<paper or document title>"
authors: ["Author Name"]
year: YYYY
source: "<url_or_filename>"
tags: [research, ingested]
---

## Abstract
<extracted abstract, or a synthesized 2-4 sentence overview if no explicit abstract>

## Methodology
<research methods, experimental design, analytical approach, or main techniques used>

## Key Findings
<main results, conclusions, novel contributions, or key arguments>

## Limitations
<stated limitations, caveats, or scope restrictions>

## Citation
<APA-style citation: Author, A., & Author, B. (Year). Title. Source/Journal/URL.>

Return ONLY the Markdown template with all sections filled in. No preamble or additional commentary.`;

export async function deepIngestPdf(
  pdfData: ArrayBuffer,
  source: string,
  config: EpistemeConfig,
): Promise<string> {
  const text = await extractPdfText(pdfData);
  if (!text.trim()) throw new Error("No text could be extracted from the PDF.");

  const llm = createProvider(featureModel(config, "research"));
  const agent = new HeadlessAgent(llm, [], DEEP_INGEST_SYSTEM, {
    agentName: "DeepIngestor",
  });

  return agent.ask(
    `Source: ${source}\n\nExtract structured information from this content:\n\n${text.slice(0, 10000)}`,
  );
}

async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const check = await Bun.$`which pdftotext`.quiet().catch(() => null);
  if (!check || check.exitCode !== 0) {
    throw new Error("pdftotext not found. Install with: brew install poppler");
  }
  const tmpPath = join(tmpdir(), `episteme-pdf-${Date.now()}.pdf`);
  try {
    await Bun.write(tmpPath, data);
    const result = await Bun.$`pdftotext ${tmpPath} -`.quiet();
    return result.stdout.toString();
  } finally {
    await Bun.$`rm -f ${tmpPath}`.quiet().catch(() => {});
  }
}
