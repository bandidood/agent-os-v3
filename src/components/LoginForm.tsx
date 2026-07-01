"use client";

import { signIn } from "next-auth/react";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginFormInner({ callbackUrl }: { callbackUrl?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const params = useSearchParams();

  useEffect(() => {
    if (params?.get("setup") === "done") setNotice("Account created — sign in below.");
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: callbackUrl || "/",
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password.");
      setLoading(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[var(--bg)]">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🤖</div>
          <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
            Agentic OS
          </h1>
          <p className="text-[var(--fg-dim)] text-sm mt-1.5">Mission Control</p>
        </div>

        {notice && (
          <p className="text-sm text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2 mb-4 text-center">
            {notice}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--fg-dim)] mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="admin@example.com"
              className="w-full px-4 py-3 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--fg)] placeholder:text-[var(--fg-dimmer)] focus:outline-none focus:border-[var(--accent)] transition text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--fg-dim)] mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--fg)] placeholder:text-[var(--fg-dimmer)] focus:outline-none focus:border-[var(--accent)] transition text-sm"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-sm transition disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-[var(--fg-dimmer)] mt-6">
          Credentials are stored locally — only you have access.
        </p>
      </div>
    </div>
  );
}

export default function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <Suspense>
      <LoginFormInner callbackUrl={callbackUrl} />
    </Suspense>
  );
}