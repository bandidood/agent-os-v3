import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/auth-password";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Credentials can come from:
//   1. Env vars (AGENTIC_OS_ADMIN_EMAIL + AGENTIC_OS_ADMIN_PASSWORD_HASH)
//   2. ~/.agentic-os/credentials.json  (written by /api/setup onboarding wizard)
// Env vars take priority.
export interface StoredCredentials {
  email: string;
  passwordHash: string;
}

export function loadCredentials(): StoredCredentials | null {
  const emailEnv = process.env.AGENTIC_OS_ADMIN_EMAIL?.trim();
  const hashEnv = process.env.AGENTIC_OS_ADMIN_PASSWORD_HASH?.trim();
  if (emailEnv && hashEnv) return { email: emailEnv, passwordHash: hashEnv };

  const credFile = path.join(os.homedir(), ".agentic-os", "credentials.json");
  if (existsSync(credFile)) {
    try {
      const d = JSON.parse(readFileSync(credFile, "utf-8"));
      if (d?.email && d?.passwordHash) return d as StoredCredentials;
    } catch { /* ignore corrupt file */ }
  }
  return null;
}

/** True when no admin account has been configured yet. */
export function isSetupRequired(): boolean {
  return loadCredentials() === null;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const stored = loadCredentials();
        if (!stored) return null;
        if (credentials.email !== stored.email) return null;
        const valid = verifyPassword(credentials.password as string, stored.passwordHash);
        if (!valid) return null;
        return { id: "1", email: stored.email, name: "Admin" };
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id!;
      return token;
    },
    async session({ session, token }) {
      if (token) session.user.id = token.id as string;
      return session;
    },
  },
});

export type { Session } from "next-auth";
