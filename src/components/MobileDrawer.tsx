"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  accent: string;
  dim: string;
}

const ORCHESTRATION = new Set(["/paperclip", "/room", "/pipeline", "/agent-kanban"]);
const AGENTS = new Set(["/claude", "/openclaw", "/hermes", "/antigravity", "/codex", "/kimi", "/glm", "/grok", "/freeclaude", "/fusion", "/sakana", "/local"]);

function sectionOf(href: string) {
  if (href === "/") return "Workspace";
  if (ORCHESTRATION.has(href)) return "Agent Orchestration";
  if (AGENTS.has(href)) return "Agents";
  return "Self";
}

export default function MobileDrawer({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Hamburger — mobile only, fixed top-left */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-4 left-4 z-50 grid place-items-center w-10 h-10 rounded-lg border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        style={{ background: "rgba(28,22,34,0.9)" }}
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-[280px] overflow-y-auto transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "#1c1622", borderRight: "1px solid rgba(243,235,218,0.1)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-14"
          style={{ borderBottom: "1px solid rgba(243,235,218,0.08)" }}
        >
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="text-lg font-medium tracking-tight"
            style={{ color: "var(--cream)", fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            Agentic <span className="hand text-[1.3em]" style={{ color: "var(--gold)" }}>OS</span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="grid place-items-center w-8 h-8 rounded-md border text-white/60 hover:text-white hover:border-white/20 transition-colors"
            style={{ borderColor: "rgba(255,255,255,0.1)" }}
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 py-3">
          {items.map((item, i) => {
            const sec = sectionOf(item.href);
            const prevSec = i > 0 ? sectionOf(items[i - 1].href) : null;
            const showSection = sec !== prevSec && !(i === 0 && sec === "Workspace");

            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

            return (
              <div key={item.href}>
                {showSection && (
                  <div className="sidebar-section-label mt-4 mb-1.5 px-5">{sec}</div>
                )}
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 py-2.5 px-5 transition-colors ${
                    active ? "bg-white/5" : "hover:bg-white/[0.03]"
                  }`}
                >
                  <span
                    className="shrink-0 grid place-items-center w-7 h-7 rounded-md"
                    style={{ color: active ? item.accent : "var(--cream-dim)" }}
                  >
                    {item.icon}
                  </span>
                  <span className="text-sm" style={{ color: active ? "var(--cream)" : "var(--cream-dim)" }}>
                    {item.label}
                  </span>
                </Link>
              </div>
            );
          })}
        </nav>
      </div>
    </>
  );
}
