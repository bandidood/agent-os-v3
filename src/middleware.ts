import type { NextRequest } from "next/server";
import { auth, isSetupRequired } from "@/lib/auth";
import { NextResponse } from "next/server";

const publicPaths = ["/login", "/setup", "/api/auth", "/api/setup"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets — always pass through
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  // First-run setup: no admin configured → gate everything behind /setup
  const needsSetup = isSetupRequired();
  if (needsSetup) {
    if (pathname.startsWith("/setup") || pathname.startsWith("/api/setup") || pathname.startsWith("/api/auth")) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  // Allow public auth paths
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check session
  const session = await auth();
  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// Force Node.js runtime (not Edge) so node:crypto + node:fs work
export const runtime = "nodejs";