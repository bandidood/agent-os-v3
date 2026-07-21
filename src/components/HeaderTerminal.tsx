"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TerminalIcon, X } from "lucide-react";

interface ShellLine {
  id: number;
  ts: string;
  type: "stdin" | "stdout" | "stderr";
  text: string;
}

export default function HeaderTerminal() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ShellLine[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const exec = useCallback(async (cmd: string) => {
    const id = Date.now();
    setLines((prev) => [...prev, { id, ts: new Date().toISOString(), type: "stdin", text: `$ ${cmd}` }]);
    setLoading(true);
    setHistory((prev) => [cmd, ...prev]);
    setHistIdx(-1);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      const output = data.stderr
        ? (data.stdout ? data.stdout + "\n" : "") + data.stderr
        : data.stdout || data.error || `Exit ${data.exitCode ?? res.status}`;
      setLines((prev) => [...prev, {
        id: id + 1,
        ts: new Date().toISOString(),
        type: res.ok && !data.stderr ? "stdout" : "stderr",
        text: output || "(no output)",
      }]);
    } catch (e) {
      setLines((prev) => [...prev, {
        id: id + 1,
        ts: new Date().toISOString(),
        type: "stderr",
        text: e instanceof Error ? e.message : "Command failed",
      }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = input.trim();
      if (cmd) { exec(cmd); setInput(""); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      if (history[next]) setInput(history[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next >= 0 ? history[next] : "");
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Terminal"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--line-soft)] text-[12px] text-[var(--cream-dim)] hover:text-[var(--cream)] hover:border-[var(--gold)] transition"
      >
        <TerminalIcon size={13} />
        <span className="hidden md:inline">Terminal</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="header-terminal"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "50vh", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="fixed top-0 left-0 right-0 z-[60] overflow-hidden border-b border-[var(--line-soft)] bg-[var(--bg-deep)] shadow-2xl"
          >
            <div className="h-full flex flex-col p-4 gap-3">
              <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-[12px] uppercase tracking-widest text-[var(--cream-dim)]">
                  <TerminalIcon size={14} />
                  <span>Root Terminal</span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-md hover:bg-[rgba(255,255,255,0.06)] text-[var(--cream-dim)] hover:text-[var(--cream)] transition"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 min-h-0 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] overflow-y-auto"
                style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
              >
                <div className="p-4 text-sm leading-relaxed">
                  {lines.length === 0 && (
                    <div className="text-[var(--cream-dim)] text-center py-8">
                      Type a command below and press Enter
                    </div>
                  )}
                  {lines.map((line) => (
                    <div
                      key={line.id}
                      className={`py-0.5 ${
                        line.type === "stdin" ? "text-[var(--gold)]" :
                        line.type === "stderr" ? "text-[var(--rust)]" :
                        "text-[var(--cream)]"
                      }`}
                    >
                      <span className="opacity-40 text-[10px] mr-2 select-none">
                        {new Date(line.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className="whitespace-pre-wrap">{line.text}</span>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex items-center gap-2 text-[var(--cream-dim)] text-sm">
                      <div className="w-2 h-2 border border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
                      Running…
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gold)] text-sm font-mono">$</span>
                  <input
                    autoFocus
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Enter command…"
                    disabled={loading}
                    className="w-full pl-8 pr-3 py-2.5 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-elev)] text-[var(--cream)] text-sm font-mono placeholder:text-[var(--cream-dim)] focus:outline-none focus:border-[var(--gold)] transition disabled:opacity-50"
                  />
                </div>
                <button
                  onClick={() => { const cmd = input.trim(); if (cmd) { exec(cmd); setInput(""); } }}
                  disabled={loading || !input.trim()}
                  className="px-4 py-2.5 rounded-lg bg-[var(--gold)] text-[var(--bg-dark)] text-sm font-medium hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Run
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
