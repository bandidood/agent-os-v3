# Paperclip Deployment on Coolify

Paperclip (https://github.com/paperclipai/paperclip) is an open-source control plane for AI agent companies — org charts, task management, budgets, heartbeats. It integrates with the same agents as agent-os (Claude Code, Codex, OpenClaw, Cursor, Gemini, etc.).

## Stack

- **Runtime**: Node.js + Express + React (Vite) monorepo (pnpm workspaces)
- **Database**: PostgreSQL (Drizzle ORM) — embedded PGlite fallback for dev
- **Auth**: Better Auth (sessions + API keys)
- **Default port**: 3100
- **Dev setup**: `pnpm install && pnpm dev` (leaves PGlite when DATABASE_URL unset)

## Docker Deployment on Coolify

### docker-compose.yml (production)

Paperclip ships a production Docker compose at `docker/docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: paperclip
      POSTGRES_PASSWORD: paperclip
      POSTGRES_DB: paperclip
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U paperclip -d paperclip"]
      interval: 2s
      timeout: 5s
      retries: 30
    volumes:
      - pgdata:/var/lib/postgresql/data

  server:
    build:
      context: ..
      dockerfile: Dockerfile
    ports:
      - "3100:3100"
    environment:
      DATABASE_URL: postgres://paperclip:paperclip@db:5432/paperclip
      PORT: "3100"
      SERVE_UI: "true"
      PAPERCLIP_DEPLOYMENT_MODE: "authenticated"
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "private"
      PAPERCLIP_PUBLIC_URL: "${PAPERCLIP_PUBLIC_URL:-http://localhost:3100}"
      BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET must be set}"
    volumes:
      - paperclip-data:/paperclip
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
  paperclip-data:
```

### Coolify adaptations

1. **`expose` instead of `ports`** — Traefik routes on Docker network, no host binding needed
2. **`BETTER_AUTH_SECRET`** — Generate with `openssl rand -hex 32`, set in Coolify env vars
3. **`PAPERCLIP_PUBLIC_URL`** — Must be the public domain (e.g., `https://paperclip.ccdigital.fr`)
4. **`PAPERCLIP_DEPLOYMENT_MODE: "authenticated"`** — Required for login page
5. **Domain** — Set via Coolify domains UI or `docker_compose_domains` API for the `server` service
6. **Postgres data** — Named volume `pgdata` persists across restarts

### Deployment modes

Paperclip supports two modes (via `PAPERCLIP_DEPLOYMENT_MODE` env var):
- **`local_trusted`** — No auth, single operator, board access implicit. Good for personal use.
- **`authenticated`** — Better Auth sessions, login page, company scoping. Required for multi-user or SaaS.

And two exposure levels (`PAPERCLIP_DEPLOYMENT_EXPOSURE`):
- **`private`** — Only accessible within network/VPN
- **`public`** — Accessible from the internet

### Agent adapters

Paperclip includes built-in adapters for local CLI agents:
- `acpx-local`, `claude-local`, `codex-local`, `cursor-local`, `cursor-cloud`
- `gemini-local`, `grok-local`, `opencode-local`, `pi-local`
- `openclaw-gateway` — remote agent via HTTP

External adapter plugins can be loaded at runtime via `~/.paperclip/adapter-plugins.json`.

### Integration with agent-os

Paperclip and agent-os are complementary:
- **agent-os** = chat interface + terminal + command palette per agent
- **Paperclip** = org chart + task hierarchy + budget tracking + heartbeat scheduling

Options:
1. **Iframe embed** — Add `/paperclip` route in agent-os that iframes the Paperclip instance
2. **API client** — agent-os calls Paperclip REST API to create/track tasks
3. **Deep integration** — Import Paperclip React components into agent-os shell

## Pitfalls

- `BETTER_AUTH_SECRET` must be set or Paperclip crashes at startup. Use `openssl rand -hex 32`.
- `PAPERCLIP_PUBLIC_URL` defaults to `http://localhost:3100` — behind Traefik, set to the public domain.
- The Dockerfile uses `node:lts-trixie-slim` and installs `gosu`, `gh`, `git`, `wget`, `ripgrep`, `python3` — the image is large (~1GB).
- `embedded-postgres` package is included for dev (PGlite). In production with external Postgres, this is unused but still bundled.
- `pnpm install` in Docker may take 3-5 minutes on first build due to monorepo workspace resolution.