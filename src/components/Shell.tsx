"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function Shell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[1500px] mx-auto px-4 md:px-10 py-6 md:py-8">
          <TopBar onMenuOpen={() => setMobileOpen(true)} />
          {children}
        </div>
      </main>
    </div>
  );
}
