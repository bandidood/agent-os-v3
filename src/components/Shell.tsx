import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import MobileDrawer from "./MobileDrawer";
import AgentAvatar from "./AgentAvatar";
import {
  LayoutGrid, Brain, Sparkles as SparklesIcon, TrendingUp, Columns3, NotebookText, Film,
  Building2, Workflow, MessagesSquare, Image as ImageIcon, Gamepad2, Music2, Network,
  Clapperboard, Repeat, Cpu, LayoutDashboard, Palette,
} from "lucide-react";

const NAV = [
  { href: "/",         label: "Mission Control", icon: <LayoutGrid size={16} />, accent: "#a855f7", dim: "rgba(168,85,247,0.16)" },
  { href: "/paperclip", label: "Paperclip", icon: <Building2 size={16} />, accent: "#d4a574", dim: "rgba(212,165,116,0.16)" },
  { href: "/room",     label: "AI Agent Mastermind", icon: <MessagesSquare size={16} />, accent: "#a855f7", dim: "rgba(168,85,247,0.16)" },
  { href: "/pipeline", label: "Pipeline", icon: <Workflow size={16} />, accent: "#34d399", dim: "rgba(52,211,153,0.16)" },
  { href: "/claude",   label: "Claude",   icon: <AgentAvatar agent="claude" size={22} />,   accent: "#d97757", dim: "rgba(217,119,87,0.16)" },
  { href: "/openclaw", label: "OpenClaw", icon: <AgentAvatar agent="openclaw" size={22} />, accent: "#f472b6", dim: "rgba(244,114,182,0.16)" },
  { href: "/hermes",   label: "Hermes",   icon: <AgentAvatar agent="hermes" size={22} />,   accent: "#60a5fa", dim: "rgba(96,165,250,0.16)" },
  { href: "/antigravity", label: "Antigravity", icon: <AgentAvatar agent="antigravity" size={22} />, accent: "#7c3aed", dim: "rgba(124,58,237,0.16)" },
  { href: "/codex",       label: "Codex",       icon: <AgentAvatar agent="codex" size={22} />,       accent: "#22c55e", dim: "rgba(34,197,94,0.16)" },
  { href: "/kimi",        label: "Kimi Code",   icon: <AgentAvatar agent="kimi" size={22} />,        accent: "#00CCFF", dim: "rgba(0,204,255,0.16)" },
  { href: "/glm",         label: "GLM 5.2",     icon: <AgentAvatar agent="glm" size={22} />,         accent: "#34E5B0", dim: "rgba(52,229,176,0.16)" },
  { href: "/grok",        label: "Grok Build",  icon: <AgentAvatar agent="grok" size={22} />,        accent: "#cdd3f7", dim: "rgba(205,211,247,0.16)" },
  { href: "/freeclaude",  label: "Free Claude Code", icon: <AgentAvatar agent="fcc" size={22} />,    accent: "#10b981", dim: "rgba(16,185,129,0.16)" },
  { href: "/fusion",      label: "Fusion",      icon: <Network size={18} />,                         accent: "#d4a574", dim: "rgba(212,165,116,0.16)" },
  { href: "/sakana",      label: "Sakana Fugu", icon: <Network size={18} />,                         accent: "#ff5f9e", dim: "rgba(255,95,158,0.16)" },
  { href: "/local",       label: "Local",       icon: <Cpu size={18} />,                             accent: "#5eead4", dim: "rgba(94,234,212,0.16)" },
  { href: "/agent-kanban", label: "Agent Kanban", icon: <LayoutDashboard size={18} />,               accent: "#7dd3fc", dim: "rgba(125,211,252,0.16)" },
  { href: "/loop",     label: "Loop",     icon: <Repeat size={16} />,   accent: "#2dd4bf", dim: "rgba(45,212,191,0.16)" },
  { href: "/seo",      label: "SEO",      icon: <TrendingUp size={16} />, accent: "#a3e635", dim: "rgba(163,230,53,0.16)" },
  { href: "/opendesign", label: "Open Design", icon: <Palette size={16} />, accent: "#e879f9", dim: "rgba(232,121,249,0.16)" },
  { href: "/video",    label: "Video",    icon: <Film size={16} />,      accent: "#ef4444", dim: "rgba(239,68,68,0.16)" },
  { href: "/openmontage", label: "OpenMontage", icon: <Clapperboard size={16} />, accent: "#f0a868", dim: "rgba(240,168,104,0.16)" },
  { href: "/music",    label: "Music",    icon: <Music2 size={16} />,    accent: "#c084fc", dim: "rgba(192,132,252,0.16)" },
  { href: "/games",    label: "Game Studio", icon: <Gamepad2 size={16} />, accent: "#39ff8e", dim: "rgba(57,255,142,0.16)" },
  { href: "/thumbnails", label: "Thumbnails", icon: <ImageIcon size={16} />, accent: "#fb7185", dim: "rgba(251,113,133,0.16)" },
  { href: "/notebook", label: "Notebook", icon: <NotebookText size={16} />, accent: "#fde047", dim: "rgba(253,224,71,0.16)" },
  { href: "/kanban",   label: "Kanban",   icon: <Columns3 size={16} />,  accent: "#14b8a6", dim: "rgba(20,184,166,0.16)" },
  { href: "/memory",   label: "Memory",   icon: <Brain size={16} />,     accent: "#22d3ee", dim: "rgba(34,211,238,0.16)" },
  { href: "/guide",    label: "Build Guide", icon: <SparklesIcon size={16} />, accent: "#ec4899", dim: "rgba(236,72,153,0.16)" },
];

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <MobileDrawer items={NAV} />
      <main className="flex-1 min-w-0">
        <div className="max-w-[1500px] mx-auto px-4 md:px-10 py-6 md:py-8 pt-16 md:pt-6">
          <TopBar />
          {children}
        </div>
      </main>
    </div>
  );
}
