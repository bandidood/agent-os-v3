# Docker-Compose Application Optimization for Coolify

## Overview

When deploying a docker-compose project as a Coolify **Application** (build_pack: `dockercompose`), Coolify adds significant automation: Traefik reverse proxy, Let's Encrypt TLS, health checks, and domain management. But the docker-compose must be adapted to exploit these features.

## Domain Configuration

`docker_compose_domains` is the ONLY way to set domains for docker-compose apps. The `fqdn` field is rejected for this build pack.

**MCP limitation**: The `mcp_coolify_application` tool cannot set `docker_compose_domains` — it rejects the JSON. Use either:
- The Coolify web UI (Application → Configuration → Domains)
- Direct API: `PATCH /api/v1/applications/{uuid}` with `docker_compose_domains` as a JSON string

After setting the domain, Coolify auto-injects into the rendered compose:
- `SERVICE_URL_AGENT_OS: 'https://agent-os.ccdigital.fr'`
- `SERVICE_FQDN_AGENT_OS: agent-os.ccdigital.fr`
- Traefik labels: HTTP→HTTPS redirect, TLS with Let's Encrypt, gzip compression
- Caddy labels as fallback

## Port Strategy

| Old approach | Coolify approach |
|---|---|
| `ports: "3000:3000"` | `expose: ["3000"]` |
| Binds to host port | Traefik routes on Docker network |

Traefik reads the `expose` port and routes traffic via Docker labels. No host port binding needed.

## Volume Paths for Non-Root Users

If the Dockerfile runs as a non-root user (e.g. `USER nextjs`, uid 1001):

**❌ Wrong** (volumes owned by root, user can't write):
```yaml
volumes:
  - app-config:/root/.config
  - npm-bin:/usr/local/bin
```

**✅ Correct** (volumes under user's home, pre-created with chown):
```yaml
volumes:
  - app-config:/home/nextjs/.config
  - npm-prefix:/home/nextjs/.npm-global
```

**Dockerfile pre-creation pattern**:
```dockerfile
RUN mkdir -p /home/nextjs/.agentic-os \
             /home/nextjs/.claude \
             /home/nextjs/.npm-global \
             /home/nextjs/.npm \
    && chown -R nextjs:nodejs /home/nextjs
```

Docker creates named volumes as `root:root`. The `mkdir + chown` in the Dockerfile ensures the directories have correct ownership when the volume is first populated.

## NPM Global Installs in Containers

Never mount over `/usr/local/bin` or `/usr/local/lib/node_modules` — this hides system binaries.

**Correct pattern**:
```dockerfile
ENV NPM_CONFIG_PREFIX=/home/nextjs/.npm-global
ENV PATH="/home/nextjs/.npm-global/bin:/usr/local/bin:$PATH"
```

```yaml
volumes:
  - npm-prefix:/home/nextjs/.npm-global
  - npm-cache:/home/nextjs/.npm
```

## Entrypoint Script Pattern

For containers that need to install CLI tools on first boot (agents, CLIs):

**Synchronous pattern** (app blocked until installs finish):
```bash
#!/bin/sh
set -e
export NPM_CONFIG_PREFIX="/root/.npm-global"
export PATH="/root/.npm-global/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! command -v claude >/dev/null 2>&1; then
  echo "📦 Installing Claude Code..."
  npm install -g @anthropic-ai/claude-code 2>&1 | tail -1
else
  echo "✅ Claude Code already installed"
fi

exec node server.js
```

**Async pattern** (app starts immediately, installs in background):
```bash
#!/bin/sh
set -e
export NPM_CONFIG_PREFIX="/root/.npm-global"
export PATH="/root/.npm-global/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

install_agents() {
  # Install each agent with command -v guard + verify after install
  if ! command -v claude >/dev/null 2>&1; then
    npm install -g @anthropic-ai/claude-code 2>&1 | tail -3
    command -v claude >/dev/null 2>&1 || echo "⚠️ Claude install failed"
  fi
  # ... repeat for each agent ...
  
  # Configure API key auth (avoids interactive OAuth)
  if [ -n "$ANTHROPIC_API_KEY" ]; then
    mkdir -p /root/.claude
    printf '{"apiKey":"%s"}\n' "$ANTHROPIC_API_KEY" > /root/.claude/api-key.json
  fi
}

install_agents &  # ← Non-blocking: run in background

exec node server.js
```

Key points:
- `command -v` guard skips reinstall on subsequent starts (volumes persist installs)
- `2>&1 | tail -3` reduces npm noise in logs
- `exec` replaces the shell process with node (proper signal handling)
- `NPM_CONFIG_PREFIX` ensures installs go to the persistent volume
- `/root/.local/bin` in PATH — some CLIs (like `agy`) install there
- **Always verify `command -v` after `npm install`** — npm can exit 0 but the binary is missing if a sub-installer (pip, cargo) fails
- **Python-based npm packages** (e.g. `hermes-agent`) need `pip` — install `python3-pip` first
- **PEP 668 on `node:22-bookworm`**: Debian Bookworm's Python 3.11+ enforces PEP 668, blocking `pip install` into the system Python. When `npm install -g hermes-agent` runs pip internally, it fails with "externally-managed-environment". **Proven fix**: skip npm for Python packages — use `pip3 install --break-system-packages hermes-agent` directly. This installs to `/usr/local/bin/hermes`. Set `AGENTIC_OS_HERMES_BIN=/usr/local/bin/hermes` in docker-compose env. The entrypoint chains: try `npm install -g hermes-agent` → verify `command -v hermes` → if missing, `pip3 install --break-system-packages hermes-agent`.
- **Hermes: oneshot mode, no gateway daemon** — The dashboard calls `hermes -z PROMPT --yolo --accept-hooks` per request. Do NOT try `hermes serve` or `hermes gateway` — these commands don't exist.
- **OpenClaw gateway: correct command is `openclaw gateway run`** — Discovered by inspecting `dist/gateway-cli-*.js` in the npm package. Do NOT use `openclaw gateway --port`.
- **OpenClaw gateway requires config.json** — Crashes with "Missing config" if `/root/.openclaw/config.json` doesn't exist. Auto-create minimal config in entrypoint: `echo '{"gateway":{"mode":"local","port":8989}}' > /root/.openclaw/config.json`. Also pass `--allow-unconfigured` flag.
- **Ollama in container for local LLMs** — Install via `curl -fsSL https://ollama.com/install.sh | sh`, start with `OLLAMA_HOST=0.0.0.0 nohup ollama serve &`. Auto-pull models from `OLLAMA_PULL_MODELS` env var. Set `OLLAMA_HOST=0.0.0.0` (not localhost) for container network access. Volume at `/root/.ollama` persists models. Expose port 11434.
- **API key auth** — Containers can't do browser OAuth. Set API keys as env vars and write them to CLI config files

Dockerfile:
```dockerfile
COPY --chown=nextjs:nodejs entrypoint.sh ./
ENTRYPOINT ["sh", "./entrypoint.sh"]
```

## Healthcheck Timing

If the entrypoint runs synchronously (installs before `exec node`), set `start_period` generously:

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/vitals"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s  # ← 60s minimum for npm installs
```

**Async entrypoint** (app starts immediately, installs in background): Use a shorter `start_period` since the app is ready in seconds:

```yaml
healthcheck:
  start_period: 30s  # ← App is ready immediately; background installs don't block
```

Also enable the health check in Coolify (it's disabled by default for docker-compose apps):
```
mcp_coolify_application action=update uuid=<uuid> health_check_enabled=true health_check_path=/api/vitals health_check_port=3000
```

## Root-User Pattern (Alternative to Non-Root)

For personal/self-hosted tools where you need to install packages via Coolify's terminal UI, running as **root** is simpler than the gosu/nextjs pattern. The tradeoff: less security isolation, but no permission issues and `npm install -g` / `apt-get install` just work.

**Dockerfile (root pattern)**:
```dockerfile
FROM node:22-bookworm  # bookworm includes wget for healthcheck, better binary compat than alpine
# No USER directive — stays root
ENV NPM_CONFIG_PREFIX=/root/.npm-global
ENV PATH="/root/.npm-global/bin:/usr/local/bin:$PATH"
RUN mkdir -p /root/.agentic-os /root/.claude /root/.npm-global /root/.npm
COPY entrypoint.sh ./
ENTRYPOINT ["sh", "./entrypoint.sh"]
```

**entrypoint.sh (root pattern)**:
```bash
#!/bin/sh
set -e
export NPM_CONFIG_PREFIX="/root/.npm-global"
export PATH="/root/.npm-global/bin:$PATH"

if ! command -v claude >/dev/null 2>&1; then
  echo "📦 Installing Claude Code..."
  npm install -g @anthropic-ai/claude-code 2>&1 | tail -1
else
  echo "✅ Claude Code already installed"
fi

if ! command -v hermes >/dev/null 2>&1; then
  echo "📦 Installing Hermes Agent..."
  npm install -g hermes-agent 2>&1 | tail -1
else
  echo "✅ Hermes Agent already installed"
fi

exec node server.js
```

**docker-compose.yml (root pattern)**:
```yaml
services:
  application:
    build: .
    expose:
      - "3000"
    environment:
      - AUTH_SECRET=${AUTH_SECRET}
      - AGENTIC_OS_ADMIN_EMAIL=${AGENTIC_OS_ADMIN_EMAIL}
      - AGENTIC_OS_ADMIN_PASSWORD_HASH=${AGENTIC_OS_ADMIN_PASSWORD_HASH}
    volumes:
      - agentic-os-config:/root/.agentic-os
      - claude-config:/root/.claude
      - hermes-config:/root/.hermes
      - npm-global:/root/.npm-global
      - npm-cache:/root/.npm
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/vitals"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

**Why `node:22-bookworm` over `node:22-alpine`**: Alpine uses musl (not glibc), causing native module issues with some npm packages. Bookworm includes `wget` for healthcheck (Alpine needs separate install). Root doesn't need `gosu`.

## Agent-OS Specific Architecture

Agent-os is a Next.js dashboard that spawns CLI agents (claude, hermes, gemini, etc.) via `child_process.spawn()`. The agents must be **in the same container** — there's no remote execution layer.

The config resolution order (from `src/lib/config.ts`):
1. Environment variable (e.g. `AGENTIC_OS_CLAUDE_BIN`)
2. `~/.agentic-os/config.json` file
3. `which` auto-detection on PATH

This means entrypoint-installed CLIs are auto-detected if `$PATH` includes the npm-global bin. No explicit `AGENTIC_OS_*_BIN` env vars needed unless you want to override the path.

## NextAuth v5 Integration Pattern

For adding authentication to a Next.js app deployed on Coolify, NextAuth v5 (beta) provides credentials-based auth without a database.

### Files to create
1. `src/lib/auth.ts` — NextAuth config with CredentialsProvider, JWT session strategy (24h expiry)
2. `src/lib/auth-password.ts` — Password hashing with `node:crypto` `scryptSync` (salt:hash format)
3. `src/middleware.ts` — Redirect unauthenticated users to `/login`; allow `/login`, `/api/auth/*`, `/_next/*`
4. `src/app/api/auth/[...nextauth]/route.ts` — Export `GET`/`POST` handlers from `auth.ts`
5. `src/app/login/page.tsx` + `layout.tsx` — Login page with isolated layout (no app shell)
6. `src/components/LoginForm.tsx` — Email/password form + `LogoutButton.tsx` in TopBar

### Coolify env vars required
- `AUTH_SECRET` — Random 32+ char string for JWT signing
- `AUTH_TRUST_HOST` — Set to `true` (trusts Traefik X-Forwarded-Host header)
- `NEXTAUTH_URL` — Public base URL (e.g. `https://agent-os.ccdigital.fr`). Without this, login redirects to the container's internal address.
- `AGENTIC_OS_ADMIN_EMAIL` — Default admin email (e.g. `contact@johann-lebel.fr`)
- `AGENTIC_OS_ADMIN_PASSWORD_HASH` — Scrypt hash in `salt:hash` format

### Generating password hash
```bash
node -e "
const crypto = require('crypto');
const password = 'changeme';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
console.log(salt + ':' + hash);
"
```

Pitfall: The `next-auth` package must be `^5.0.0-beta.29` or later for v5. The v4 API is incompatible — v5 uses `auth.ts` config, not `pages/api/auth/[...nextauth].ts`.

### Edge Runtime: node:crypto breaks middleware

Next.js middleware runs in the **Edge Runtime**, which does NOT support `node:crypto`. If `src/lib/auth.ts` imports `auth-password.ts` (which uses `scryptSync` from `node:crypto`), the middleware (`src/middleware.ts`) importing `auth` from `@/lib/auth` will crash the build with:

```
A Node.js module is loaded ('node:crypto' at line 1) which is not supported in the Edge Runtime.
```

**Two approaches** (pick one):

**Approach A — Force Node.js runtime (recommended, simpler)**:
Force the middleware to run in Node.js runtime instead of Edge. This allows importing `auth.ts` directly (with `node:crypto`):
```ts
// src/middleware.ts
import { auth } from "@/lib/auth";

export async function middleware(request) {
  const session = await auth();
  if (!session) { /* redirect to /login */ }
}

// Force Node.js runtime — Edge doesn't support node:crypto
export const runtime = "nodejs";
```

Trade-off: Slightly slower cold start than Edge, but negligible behind a reverse proxy.

**Approach B — Separate auth-edge.ts (NOT recommended)**:
Create `src/lib/auth-edge.ts` with `providers: []` and import it in middleware. **Pitfall**: Two NextAuth configs create separate JWT signing contexts — sessions created by the full `auth.ts` may NOT be readable by `auth-edge.ts`, so the middleware ALWAYS sees `session: null` and every request redirects to `/login`.

```ts
// src/lib/auth-edge.ts — IF you must use Edge Runtime
import NextAuth from "next-auth";
export const { auth } = NextAuth({
  providers: [],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
});
```

The full `auth.ts` (with Credentials provider + `verifyPassword`) is only used by API routes and server components — those run in Node.js runtime where `node:crypto` is available.

### NEXTAUTH_URL: public base URL

Without `NEXTAUTH_URL`, NextAuth v5 constructs callback/redirect URLs from the container's internal listener address (`0.0.0.0:3000` or `localhost:3000`). After a successful login, the user gets redirected to `https://0.0.0.0:3000/` — which browsers reject as `ERR_ADDRESS_INVALID`.

**Fix**: Set `NEXTAUTH_URL` to the public domain in both docker-compose and Coolify env vars:
```yaml
environment:
  - NEXTAUTH_URL=https://agent-os.ccdigital.fr
  - AUTH_TRUST_HOST=true
```

`NEXTAUTH_URL` tells NextAuth the public base URL for generating callback URLs. `AUTH_TRUST_HOST` allows the forwarded Host header. Both are required behind Traefik/Caddy.

### Password hash script pitfall

When writing a shell script that generates a password hash via `node -e`, **single quotes prevent `$1` expansion** inside the JS string:

```bash
# ❌ Wrong — '$1' is literal JS, not the shell arg
node -e "const hash = scryptSync('$1', salt, 32);"
```

```bash
# ✅ Correct — pass password via process.argv
node -e "
const { scryptSync, randomBytes } = require('crypto');
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(process.argv[1], salt, 32).toString('hex');
console.log(salt + ':' + hash);
" "$1"
```

### AUTH_TRUST_HOST behind reverse proxy

NextAuth v5 validates the request Host header against `AUTH_URL`. Behind Traefik/Caddy, the forwarded host differs from the container's localhost, causing `UntrustedHost` errors:

```
[auth][error] UntrustedHost: Host must be trusted. URL was: https://my.domain.fr/api/auth/session
```

**Fix**: Set `AUTH_TRUST_HOST=true` in:
1. `docker-compose.yml` environment section
2. Coolify env vars (via `mcp_coolify_env_vars`)

This tells NextAuth to trust the `X-Forwarded-Host` header set by Traefik.

### signIn() client-side typing

In NextAuth v5, `signIn("credentials", { redirectTo })` returns type `never` (it redirects server-side). To handle errors client-side, use `redirect: false`:

```ts
const result = await signIn("credentials", {
  email, password,
  callbackUrl: callbackUrl || "/",
  redirect: false,  // ← prevents server redirect, returns typed result
});
if (result?.error) {
  setError("Invalid email or password");
} else if (result?.url) {
  window.location.href = result.url;
}
```

### Route Groups: Keeping Shell out of Login

By default, a Next.js root `layout.tsx` wraps all pages — including `/login`. This means the sidebar and top bar appear on the login page, and logged-out users can still navigate.

**Fix**: Use a Next.js **route group** `(dashboard)` to scope the Shell layout:

```
src/app/
├── layout.tsx              ← Root (fonts, body — NO Shell)
├── login/
│   ├── layout.tsx          ← Bare layout (just {children})
│   └── page.tsx            ← Login form
├── api/                    ← API routes (no Shell)
└── (dashboard)/
    ├── layout.tsx          ← Shell layout (Sidebar + TopBar)
    ├── page.tsx            ← Home page
    ├── claude/page.tsx
    ├── hermes/page.tsx
    └── ...                 ← All authenticated pages
```

Route groups `(name)` do NOT appear in the URL — `/claude` stays `/claude`. The middleware still protects all paths except `/login` and `/api/auth`.

**Root layout (no Shell)**:
```tsx
export default function RootLayout({ children }) {
  return <html>...</html>;  // Just fonts + body, no Shell
}
```

**Dashboard layout**:
```tsx
import Shell from "@/components/Shell";
export default function DashboardLayout({ children }) {
  return <Shell>{children}</Shell>;
}
```

### package-lock.json and Node version compatibility

When adding `next-auth` (or any new dependency) to `package.json`, you MUST regenerate and commit `package-lock.json`. The Dockerfile runs `npm ci` which requires a valid lock file — without it, the build fails at `RUN npm ci` with exit code 1. Always run `npm install --package-lock-only` after editing `package.json` and commit the result.

**Cross-Node lock file mismatch**: If `package-lock.json` was generated on Node 20 (local dev) but the Dockerfile uses Node 22, `npm ci` may still fail. Use this fallback pattern in the Dockerfile:
```dockerfile
RUN npm install --frozen-lockfile 2>/dev/null || npm install
```
This tries strict install first, then falls back to a regular install that resolves dependencies for the current Node version.

### next.config.ts: ignoreBuildErrors for Next.js 16

Next.js 16 beta ships with broken type definitions in `node_modules` (`@auth/core`, `next/dist` types). These cause `next build` to fail at the TypeScript check phase with errors like "Module has no default export" or "Cannot find name".

Add `ignoreBuildErrors: true` to suppress these during build:
```ts
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,  // node_modules type errors in Next.js 16 beta
  },
};
```

Note: `eslint.ignoreDuringBuilds` was removed in Next.js 16 — don't add it.

## Coolify Injected Environment Variables

When Coolify deploys a docker-compose application, it automatically injects:
- `COOLIFY_BRANCH` — current git branch
- `COOLIFY_RESOURCE_UUID` — Coolify resource ID
- `COOLIFY_CONTAINER_NAME` — generated container name
- `COOLIFY_URL` / `COOLIFY_FQDN` — the configured domain
- `SERVICE_URL_<SERVICENAME>` — full URL with scheme
- `SERVICE_FQDN_<SERVICENAME>` — domain without scheme
- `SERVICE_NAME_<SERVICENAME>` — service name

These are available inside the container for the app to know its own public URL.