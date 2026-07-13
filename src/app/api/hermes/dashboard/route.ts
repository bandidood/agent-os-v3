import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { config } from "@/lib/config";

// Lifecycle for the Hermes web dashboard (FastAPI on :9119). Agent OS embeds it
// in the Hermes → Manage tab so you can configure model/provider, API keys,
// sessions, cron, skills, MCP, channels, logs, analytics and system ops without
// leaving Agent OS. GET = status; POST = ensure it's running (start if down).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DASH_URL = "http://127.0.0.1:9119";

async function isUp(): Promise<boolean> {
  try {
    const r = await fetch(`${DASH_URL}/api/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json({ running: await isUp(), url: DASH_URL });
}

export async function POST() {
  if (await isUp()) {
    return NextResponse.json({ running: true, url: DASH_URL, started: false });
  }

  const bin = config.hermes ?? "hermes";

  // Pre-check: if the binary is null/missing, spawn() would emit an async
  // 'error' event. Without a listener that becomes an uncaughtException that
  // crashes the entire Next.js server — every fetch then returns the HTML
  // error page, producing "Unexpected token '<'" in the browser.
  if (!bin) {
    return NextResponse.json(
      { running: false, url: DASH_URL, error: "Hermes binary not found. Set AGENTIC_OS_HERMES_BIN or install Hermes." },
      { status: 503 },
    );
  }

  try {
    // --no-open keeps it headless (we frame it). Note: Hermes >=0.16 dropped the
    // old --tui flag, so passing it errors — keep the args minimal.
    const child = spawn(bin, ["dashboard", "--no-open", "--port", "9119"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    // MUST listen for 'error' — otherwise an ENOENT (binary missing) becomes
    // an uncaughtException and crashes the whole server.
    child.on("error", (err) => {
      console.error("[hermes/dashboard] spawn failed:", err.message);
    });
    child.unref();
  } catch (e) {
    return NextResponse.json({ running: false, url: DASH_URL, error: String(e) }, { status: 500 });
  }

  // First launch may build the frontend; poll up to ~30s.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isUp()) {
      return NextResponse.json({ running: true, url: DASH_URL, started: true });
    }
  }
  return NextResponse.json({
    running: false,
    url: DASH_URL,
    started: true,
    warn: "Dashboard is still starting (first launch builds the UI). Try Refresh in a few seconds.",
  });
}
