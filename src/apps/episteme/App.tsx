import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef } from "react";

type ServerMsg =
  | { type: "speak"; text: string }
  | { type: "state_change"; state: "idle" | "thinking" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "error"; message: string };

type Message = { role: "user" | "assistant"; text: string };

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "thinking" | "disconnected">("disconnected");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`ws://${location.host}`);
    wsRef.current = ws;

    ws.onopen = () => setStatus("idle");
    ws.onclose = () => setStatus("disconnected");

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMsg;
      switch (msg.type) {
        case "state_change":
          setStatus(msg.state);
          break;
        case "speak":
          setMessages((prev) => [...prev, { role: "assistant", text: msg.text }]);
          break;
        case "error":
          setMessages((prev) => [...prev, { role: "assistant", text: `[Error] ${msg.message}` }]);
          break;
      }
    };

    return () => ws.close();
  }, []);

  function send() {
    const text = input.trim();
    if (!text || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "send", text }));
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", padding: 20 }}>
      <h1 style={{ marginBottom: 8, fontSize: 20, color: "#a0cfff" }}>
        Episteme <span style={{ fontSize: 13, color: "#666" }}>— Phase 0 scaffold</span>
      </h1>
      <div style={{ flex: 1, overflow: "auto", marginBottom: 12, padding: 12, background: "#111", borderRadius: 8 }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: 12,
              padding: "8px 12px",
              borderRadius: 6,
              background: m.role === "user" ? "#2a2a3a" : "#1e2e1e",
              borderLeft: `3px solid ${m.role === "user" ? "#6699ff" : "#66cc88"}`,
            }}
          >
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
              {m.role === "user" ? "You" : "Episteme"}
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{m.text}</div>
          </div>
        ))}
        {status === "thinking" && (
          <div style={{ color: "#888", fontStyle: "italic", fontSize: 13 }}>Thinking…</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 6,
            background: "#2a2a2a", border: "1px solid #444", color: "#e0e0e0", fontSize: 14,
          }}
          value={input}
          placeholder={status === "disconnected" ? "Connecting…" : "Ask Episteme…"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          disabled={status === "disconnected" || status === "thinking"}
        />
        <button
          style={{
            padding: "10px 20px", borderRadius: 6,
            background: "#3366cc", color: "#fff", border: "none", cursor: "pointer", fontSize: 14,
          }}
          onClick={send}
          disabled={status === "disconnected" || status === "thinking"}
        >
          Send
        </button>
        <div style={{
          padding: "10px 14px", borderRadius: 6, fontSize: 12, color: "#888",
          background: "#2a2a2a", border: "1px solid #333", display: "flex", alignItems: "center",
        }}>
          {status === "idle" ? "● ready" : status === "thinking" ? "◉ thinking" : "○ offline"}
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#555", textAlign: "center" }}>
        Phase 0 scaffold — editor UI builds in Phase 1
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
