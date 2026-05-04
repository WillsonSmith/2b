import type { ServerWebSocket } from "bun";
import type { ClientMsg } from "../../protocol.ts";
import type { WsContext } from "../context.ts";

export type ResearchMsg = Extract<
  ClientMsg,
  {
    type:
      | "ingest_url"
      | "ingest_pdf"
      | "search_request"
      | "detect_gaps_request"
      | "contradictions_request"
      | "contradiction_scan_request"
      | "graph_request"
      | "check_citations_request"
      | "format_citation_request";
  }
>;

export async function handleResearch(
  msg: ResearchMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  const { send, agent, research, citation, contradiction } = ctx;

  switch (msg.type) {
    case "ingest_url": {
      const url = msg.url?.trim();
      if (!url) return;
      // Strip control characters to prevent prompt injection via crafted URLs
      const safeUrl = url.replace(/[\n\r\t]/g, "");
      agent.addDirect(`Call the ingest_url tool with url: ${JSON.stringify(safeUrl)}`);
      send(ws, { type: "ingest_result", success: true, message: `Ingesting ${safeUrl}…` });
      return;
    }

    case "ingest_pdf": {
      const path = msg.path?.trim();
      if (!path) return;
      const safePath = path.replace(/[\n\r\t]/g, "");
      agent.addDirect(`Call the ingest_pdf tool with path: ${JSON.stringify(safePath)}`);
      send(ws, { type: "ingest_result", success: true, message: `Ingesting PDF ${safePath}…` });
      return;
    }

    case "search_request": {
      const query = msg.query?.trim();
      if (!query) return;
      research.unifiedSearch(query).then((results) => {
        send(ws, { type: "search_result", results });
      }).catch(() => {
        send(ws, { type: "error", message: "Search failed." });
      });
      return;
    }

    case "detect_gaps_request": {
      const topic = msg.topic?.trim();
      if (!topic) return;
      research.detectGaps(topic).then((markdown) => {
        send(ws, { type: "detect_gaps_result", markdown });
      }).catch(() => {
        send(ws, { type: "error", message: "Gap detection failed." });
      });
      return;
    }

    case "contradictions_request": {
      send(ws, { type: "contradictions_data", contradictions: contradiction.listContradictions() });
      return;
    }

    case "contradiction_scan_request": {
      contradiction.runScan().then((found) => {
        send(ws, { type: "contradictions_data", contradictions: contradiction.listContradictions() });
        if (found.length > 0) {
          send(ws, {
            type: "speak",
            text: `Contradiction scan complete — ${found.length} new conflict(s) found.`,
          });
        }
      }).catch(() => {
        send(ws, { type: "error", message: "Contradiction scan failed." });
      });
      return;
    }

    case "graph_request": {
      send(ws, { type: "graph_data", data: contradiction.buildKnowledgeGraph() });
      return;
    }

    case "check_citations_request": {
      citation.checkCitations().then((result) => {
        send(ws, { type: "check_citations_result", result });
      }).catch(() => {
        send(ws, { type: "error", message: "Citation check failed." });
      });
      return;
    }

    case "format_citation_request": {
      const url = msg.url?.trim();
      if (!url) return;
      citation.formatCitation(url).then((bibtex) => {
        send(ws, { type: "format_citation_result", bibtex });
      }).catch(() => {
        send(ws, { type: "error", message: "Citation formatting failed." });
      });
      return;
    }
  }
}
