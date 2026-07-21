import { NextRequest, NextResponse } from "next/server";
import { exec } from "node:child_process";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dangerous command patterns that must be blocked
const BLOCKED_PATTERNS = [
  /rm\s+(-\w*r\w*f|--recursive)\s+([\/~]|$)/i,
  /\brm\s+--no-preserve-root\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bformat\s+[a-zA-Z]:/i,
  /:\(\)\{.*:\|:&\}\s*;/i, // fork bomb
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\binit\s+[06]/i,
  />\s*\/dev\/sd/i,
  /\bchmod\s+(-\w*R\w*|)\s+[067]777\s+\//i,
  /\bchown\b.*\broot\b/i,
  /\bmv\b.*\s+\/dev\/null/i,
];

interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { command, cwd } = body as { command?: string; cwd?: string };

    if (typeof command !== "string" || !command.trim()) {
      return NextResponse.json({ error: "Missing or empty command" }, { status: 400 });
    }

    // Block dangerous commands
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return NextResponse.json(
          {
            stdout: "",
            stderr: `⛔ Command blocked by safety policy: ${command.slice(0, 80)}`,
            exitCode: 126,
            durationMs: 0,
          },
          { status: 200 }
        );
      }
    }

    const workDir = typeof cwd === "string" && cwd.trim()
      ? path.resolve(cwd.replace(/^~/, os.homedir()))
      : os.homedir();

    const result = await new Promise<TerminalResult>((resolve) => {
      const started = Date.now();
      const timeoutMs = 30_000;

      exec(command, {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024, // 2MB
        env: {
          ...process.env,
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: os.homedir(),
          SHELL: process.env.SHELL || "/bin/bash",
          TERM: "dumb",
        },
      }, (error, stdout, stderr) => {
        const durationMs = Date.now() - started;
        let exitCode = 0;
        if (error) {
          exitCode = typeof error.code === "number" ? error.code : 1;
          if ("killed" in error && (error as { killed: boolean }).killed) {
            stderr += "\n⏱ Command timed out after 30s";
          }
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode,
          durationMs,
        });
      });
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
