// First-run setup API — creates the initial admin account.
// Writes credentials to ~/.agentic-os/credentials.json (persistent volume).
// Returns 409 if an admin is already configured (env vars or credentials file).

import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth-password";
import { isSetupRequired } from "@/lib/auth";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Only allow if no admin is configured yet
  if (!isSetupRequired()) {
    return NextResponse.json({ error: "Admin already configured." }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const email = (body?.email ?? "").trim().toLowerCase();
  const password = body?.password ?? "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = hashPassword(password);
  const dir = path.join(os.homedir(), ".agentic-os");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const credFile = path.join(dir, "credentials.json");
  writeFileSync(credFile, JSON.stringify({ email, passwordHash }, null, 2), "utf-8");

  return NextResponse.json({ ok: true });
}

// GET: check if setup is still required
export async function GET() {
  return NextResponse.json({ setupRequired: isSetupRequired() });
}
