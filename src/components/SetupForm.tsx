"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Setup failed."); return; }
      router.push("/login?setup=done");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[var(--bg)]">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🤖</div>
          <h1 className="text-2xl font-bold text-[var(--fg)]">Welcome to Agentic OS</h1>
          <p className="text-[var(--fg-dim)] text-sm mt-1.5">Create your admin account to get started.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--fg-dim)] mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full px-4 py-3 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--fg)] placeholder:text-[var(--fg-dimmer)] focus:outline-none focus:border-[var(--accent)] transition text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--fg-dim)] mb-1.5 uppercase tracking-wide">
              Confirm Password
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
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
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-center text-xs text-[var(--fg-dimmer)] mt-6">
          Credentials are stored locally — only you have access.
        </p>
      </div>
    </div>
  );
}
