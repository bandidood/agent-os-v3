# Next.js Responsive Mobile Patterns for Coolify-Deployed Apps

## Mobile Hamburger Drawer

When a Next.js app has a sidebar + topbar layout (Shell), mobile needs a hamburger menu that slides in from the left. The default `MobileNav` (bottom tab bar) is less usable for dashboards with many items.

### Component structure

```
src/components/
├── Shell.tsx          # Wraps Sidebar + TopBar + MobileDrawer
├── Sidebar.tsx        # Desktop sidebar (hidden on mobile: hidden md:flex)
├── TopBar.tsx         # Top bar with hamburger button (shown on mobile)
├── MobileDrawer.tsx   # Slide-in drawer overlay for mobile
├── LoginForm.tsx      # Responsive login (min-h-dvh, px-4)
└── LogoutButton.tsx   # Used in both Sidebar and MobileDrawer
```

### MobileDrawer pattern

Key lessons from production iteration:

1. **Drawer must use solid background + border** — `backdrop-blur-sm` on a translucent drawer makes it invisible against the dark background. The overlay also needs `bg-black/70` (opaque), NOT `bg-black/60 backdrop-blur-sm` (looks like just blur to users).
2. **Hamburger button needs solid background** — `bg-[var(--bg-mid)]/90` or a dark solid color so it's visible over content.
3. **Drawer and overlay are SEPARATE elements** — the overlay is a sibling `div` (click to close), the drawer slides in beside it. Don't nest the overlay inside the drawer.
4. **No conditional rendering for drawer** — always render `<aside>` with `translate-x` classes. Only conditionally render the overlay `{open && ...}`. This keeps the drawer animated.

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import LogoutButton from "./LogoutButton";

export default function MobileDrawer({ items }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Hamburger — fixed position, solid bg, mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-4 left-4 z-50 grid place-items-center w-10 h-10 rounded-lg border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        style={{ background: "rgba(28,22,34,0.9)" }}
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Overlay — opaque, NOT backdrop-blur */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer — always rendered, animated via translate-x */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-[280px] overflow-y-auto transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "#1c1622", borderRight: "1px solid rgba(243,235,218,0.1)" }}
      >
        {/* Header with logo + close button */}
        <div className="flex items-center justify-between px-5 h-14" style={{ borderBottom: "1px solid rgba(243,235,218,0.08)" }}>
          <Link href="/" onClick={() => setOpen(false)}>Logo</Link>
          <button onClick={() => setOpen(false)}><X size={16} /></button>
        </div>
        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 py-3">
          {items.map(item => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
              className={pathname === item.href ? "bg-white/5" : "hover:bg-white/[0.03]"}>
              {item.icon} {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto" style={{ borderTop: "1px solid rgba(243,235,218,0.08)" }}>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
```

### Shell integration

**Critical**: Do NOT add `pt-16` or padding for the hamburger on mobile. The hamburger is `position: fixed` and floats over content. Adding top padding shifts all content down and makes it look off-center.

```tsx
// Shell.tsx — responsive layout
export default function Shell({ children }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />                    {/* hidden md:flex, takes no space on mobile */}
      <MobileDrawer items={NAV} />   {/* fixed overlay, takes no layout space */}
      <main className="flex-1 min-w-0">
        <div className="max-w-[1500px] mx-auto px-4 md:px-10 py-6 md:py-8">
          <TopBar />
          {children}
        </div>
      </main>
    </div>
  );
}
```

**Pitfall**: If you set `pt-16 md:pt-8` on the main content area "for the hamburger button", all content shifts down on mobile creating a gap. The hamburger is fixed-position — it doesn't need layout space.

### Key mobile CSS patterns

- `min-h-dvh` instead of `min-h-screen` — accounts for mobile browser chrome/address bar
- `px-4 md:px-10` — tighter padding on mobile, spacious on desktop
- `hidden md:flex` — hide sidebar on mobile, show on desktop
- `fixed inset-0 z-40 bg-black/70` — opaque overlay (NOT backdrop-blur)
- `fixed top-0 left-0 z-50 w-[280px]` with `translate-x` — slide-in drawer
- **No pt-16 for hamburger** — fixed-position elements don't need layout space
- Solid dark backgrounds (`#1c1622` or `var(--bg-mid)`) with visible border-right on the drawer
- `transition-transform duration-300 ease-out` — smooth slide animation