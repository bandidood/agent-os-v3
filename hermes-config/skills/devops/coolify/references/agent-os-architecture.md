# Agent-OS Architecture & Integration Notes

## Agent-OS on Coolify

**Repo**: `github.com/bandidood/agent-os` (private)  
**Coolify app UUID**: `cywfcmwh3qe7ha833xkxbcnt`  
**Build pack**: `dockercompose` (Git-linked, auto-deploy on push)  
**Domain**: `agent-os.ccdigital.fr`  
**Project UUID**: `ao5n10dk8dgl5l0n158sy1fm`, environment: `production` (id 14)  
**Auth**: NextAuth v5 (Credentials + JWT, no DB)  
**Container user**: root (for easier CLI installs via Coolify terminal)  
**Architecture**: Monolith container with entrypoint script that auto-installs CLI agents at boot

### Key Environment Variables
- `AUTH_SECRET` — JWT signing secret
- `AUTH_TRUST_HOST=true` — Trust Traefik X-Forwarded-Host
- `NEXTAUTH_URL=https://agent-os.ccdigital.fr` — Public base URL for callbacks
- `AGENTIC_OS_ADMIN_EMAIL` — Default admin email
- `AGENTIC_OS_ADMIN_PASSWORD_HASH` — Scrypt hash (salt:hex format)
- `ANTHROPIC_API_KEY` — Claude Code API key (non-interactive auth)
- `OPENAI_API_KEY` — Codex API key
- `GOOGLE_API_KEY` — Gemini CLI API key
- `OPENCLAW_GATEWAY_PORT=8989` — OpenClaw gateway daemon port
- `HERMES_GATEWAY_PORT=8787` — Hermes gateway daemon port
- `OLLAMA_PULL_MODELS` — Comma-separated list of models to auto-pull at startup (e.g. `llama3.2,qwen2.5`)
- `OLLAMA_HOST=0.0.0.0` — Ollama listen address (must be `0.0.0.0` not `localhost` for container network access)
- `OLLAMA_PORT=11434` — Ollama API port

### Route Structure
```
src/app/
├── layout.tsx              ← Root (fonts, body — NO Shell)
├── login/                  ← Login page (outside dashboard group)
├── api/auth/[...nextauth]/ ← NextAuth route handler
└── (dashboard)/            ← Route group: all authenticated pages
    ├── layout.tsx          ← Shell (Sidebar + TopBar + MobileDrawer)
    ├── page.tsx            ← Home
    ├── claude/, hermes/, codex/, gemini/, openclaw/  ← Agent pages
    ├── memory/, goals/, journal/, kanban/           ← Self pages
    └── ...                 ← Other dashboard pages
```

### Agent CLI Installation (entrypoint.sh)
The entrypoint runs agent installs **asynchronously** — the app starts immediately, installs happen in the background. This means the dashboard is available within seconds, and agents progressively become available as each install completes.

All `npm install -g` go to `/root/.npm-global` (persisted via Docker volume). `curl | bash` installs may go to `/usr/local/bin` or `/root/.local/bin` — both are in the entrypoint's `$PATH`.

**API Key Auth (not interactive OAuth):** Claude Code and other CLIs require API keys in containers since there's no browser for OAuth. Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` as Coolify env vars (`is_runtime: true`). The entrypoint writes `ANTHROPIC_API_KEY` to `/root/.claude/api-key.json` so Claude Code never prompts for login.

**Python dependency (Hermes):** `npm install -g hermes-agent` calls `pip` internally. The entrypoint installs `python3-pip` if missing before attempting hermes install. Always verify `command -v hermes` after install — npm can report success but the binary is missing if pip fails.

**PEP 668 on Debian Bookworm**: `node:22-bookworm` uses Python 3.11+ which enforces PEP 668 ("externally-managed-environment"). Running `pip install` into the system Python is blocked. When npm calls pip internally, it fails with this error. **Proven fix**: skip `npm install -g hermes-agent` entirely (it fails because npm calls pip without `--break-system-packages`). Use `pip3 install --break-system-packages hermes-agent` directly, which installs the binary to `/usr/local/bin/hermes`. The entrypoint chains: try `npm install -g hermes-agent` → verify `command -v hermes` → if missing, `pip3 install --break-system-packages hermes-agent`. Set `AGENTIC_OS_HERMES_BIN=/usr/local/bin/hermes` to point to the correct location.

**7 agents + Ollama installed:**
1. **Claude Code** — `npm install -g @anthropic-ai/claude-code`
2. **Hermes** — `pip3 install --break-system-packages hermes-agent` → `/usr/local/bin/hermes` (PEP 668 blocks npm's internal pip call, so pip3 is used directly)
3. **OpenClaw** — `npm install -g openclaw@latest`
4. **Gemini CLI** — `npm install -g @google/gemini-cli`
5. **Antigravity (agy)** — `curl -fsSL https://antigravity.google/cli/install.sh | bash` → `/root/.local/bin/agy`
6. **Codex** — `npm install -g @openai/codex`
7. **Ollama** — `curl -fsSL https://ollama.com/install.sh | sh` → local LLM server on port 11434

**System packages baked into Dockerfile (not installed at runtime):** `wget`, `zstd` (required by Ollama installer — the install script crashes without it), `python3-pip`, `python3-venv` (required by Hermes pip install). Pre-installing these avoids 10-30s apt-get delays on cold starts and prevents apt lock contention when the entrypoint's background installer runs `apt-get` concurrently with `npm install`.

### Gateway Daemons
After agent installation, the entrypoint starts persistent gateway processes where applicable:

- **Ollama** on port 11434 — `OLLAMA_HOST=0.0.0.0 nohup ollama serve &` (LLM inference server for local/cloud models). Models auto-pulled via `OLLAMA_PULL_MODELS` env var (comma-separated). Cloud models (`:cloud` tag) pull instantly (manifest only, no weights download). Volume `agent-ollama` at `/root/.ollama` persists downloaded models between deploys. Current model list: `kimi-k2.6:cloud`, `deepseek-v4-flash:cloud`, `deepseek-v4-pro:cloud`, `gemma4:31b-cloud`, `qwen3.5:cloud`, `glm-5.1:cloud`, `qwen3-coder-next:cloud`, `minimax-m3:cloud`, `nemotron-3-super:cloud`, `ministral-3:14b-cloud`.
- **OpenClaw gateway** on port 8989 — `openclaw gateway run --port 8989 --allow-unconfigured` (the correct sub-command is `gateway run`, discovered by inspecting OpenClaw's `dist/gateway-cli-*.js`). The `--allow-unconfigured` flag is required — without it, the gateway crashes with "Missing config. Run openclaw setup". The entrypoint also auto-creates `/root/.openclaw/config.json` with `{"gateway":{"mode":"local","port":8989}}` if missing.
- **Hermes** — NO persistent gateway/daemon. The dashboard calls `hermes -z PROMPT --yolo --accept-hooks` per request (oneshot CLI mode). Do NOT try `hermes serve` or `hermes gateway` — these don't exist.

Both gateways run as background processes with logs written to their respective config volumes:
- Ollama: `/root/.ollama/logs/` (default Ollama log location)
- OpenClaw: `/root/.openclaw/gateway.log`
- Hermes: N/A (oneshot mode, no persistent process)

The entrypoint verifies each gateway started (`nohup` + `sleep 5` + `kill -0 $!`) and reports status. The final summary uses `pgrep -f` with short process names (`ollama`, `openclaw`) — not full command strings like `"ollama serve"` or `"openclaw gateway"` which may not match the actual process argv. The dashboard's `/api/vitals` endpoint calls `openclaw health` which checks if the gateway event loop is running.

**Ollama for agent backends**: Hermes and OpenClaw can use Ollama as their LLM backend by setting `OLLAMA_HOST=http://localhost:11434` in the container environment. This allows using local/cloud-pulled models instead of API-key-based providers.

### Hermes Config & Skills Injection

Hermes needs `config.yaml` + 98+ skills (~69MB, 627 files) to function. These CANNOT go in the git repo (secrets in config, size for skills) and CANNOT go in Coolify env vars (MCP API limit ~4KB, Hermes config is 14KB base64).

**Config injection — baked into Docker image:**
1. `hermes-config/config.yaml` baked directly into the Docker image (`COPY hermes-config/ /app/hermes-config/` in Dockerfile) — contains provider/model config, NO secrets
2. `hermes-bootstrap.sh` copies to `/root/.hermes/config.yaml` on first boot only (`if [ ! -f ... ]` guard — never overwrites)
3. URLs adapted for container (e.g. `localhost:11434` instead of Docker hostname)
4. Config persists in Docker volume `agent-hermes-config:/root/.hermes`

**Secrets injection — Coolify env vars → .env file:**
1. All secrets (API keys, tokens, passwords) stored as Coolify env vars (`is_runtime:true, is_buildtime:false`)
2. `hermes-bootstrap.sh` writes `/root/.hermes/.env` from Coolify env vars using shell expansion: `echo "HERMES_PASSWORD=${HERMES_PASSWORD:-}"` — Coolify injects actual values at container start
3. Write-once guard: `.env` only written if it doesn't exist yet, preserving manual edits across redeployments
4. **Critical**: Hermes reads `config.yaml` for provider/model config AND `.env` for API keys. If `.env` is missing, Hermes falls back to OpenRouter without auth → 401 errors. Minimum required: `OPENAI_API_KEY`, `HERMES_PASSWORD`, and all provider keys.
5. All 22+ secrets injected via `mcp_coolify_env_vars action=bulk_update` — nothing in git

**Skills injection — one-time Docker cp:**
1. Skills are ~69MB, 627 files — too large for Docker image, git, or env vars
2. After first deploy, use Coolify terminal or `docker cp` to inject into `/root/.hermes/skills/`
3. Skills persist in Docker volume `agent-hermes-config` across redeployments
4. **Never put secrets, config, or skills in the git repo**

**Corrupted volume recovery**: If a volume contains bad data (e.g. truncated base64 config from a previous approach), delete it via `mcp_coolify_storages action=delete` and force redeploy. The bootstrap script recreates the file from the Docker image on next start.

**⚠️ DO NOT use base64 in shell scripts for large configs**: A previous approach embedded config.yaml as base64 in hermes-bootstrap.sh. This caused "invalid leading UTF-8 octet" YAML parse errors because the base64 string was truncated (14KB+ is too long for a single `echo '...' | base64 -d` in shell). Use direct file COPY from the Docker image instead.

### Docker Compose Environment Variables
All `AGENTIC_OS_*_BIN` paths point to the actual install location. **Important**: `AGENTIC_OS_HERMES_BIN=/usr/local/bin/hermes` (NOT `/root/.npm-global/bin/hermes`) because PEP 668 prevents npm from installing hermes — it's installed via `pip3 install --break-system-packages` which puts the binary in `/usr/local/bin/`. For curl-installed agents (agy), the path is `/root/.local/bin/agy`. The config.ts also falls back to `which` auto-detection if the env var is unset.

### vaultRoot Fallback
In the Docker container, there's no Obsidian vault. `config.ts` `defaultVault()` returns null, causing `ENOENT: mkdir ''`. Fix: fallback chain is `defaultVault() ?? process.env.AGENTIC_OS_VAULT ?? "/root/.agentic-os/vault"`. The Docker compose mounts a volume at `/root/.agentic-os` so the fallback directory is writable and persisted.

### Files Modified from Original Repo
- `Dockerfile` — root user, `npm install` fallback, entrypoint.sh
- `docker-compose.yml` — Coolify-optimized (expose, volumes, env vars, API keys, gateway ports)
- `entrypoint.sh` — Installs 6 CLI agents async + starts gateway daemons + calls hermes-bootstrap.sh
- `hermes-config/config.yaml` — Adapted Hermes config (Ollama custom provider on localhost:11434), baked into Docker image
- `hermes-bootstrap.sh` — Copies config.yaml + builds .env from Coolify env vars on first boot
- `next.config.ts` — `output: "standalone"`, `ignoreBuildErrors: true`
- `src/lib/auth.ts` — NextAuth v5 config (Credentials provider)
- `src/lib/auth-password.ts` — scrypt password hashing
- `src/lib/config.ts` — vaultRoot fallback for Docker container
- `src/middleware.ts` — Auth guard with `export const runtime = "nodejs"`
- `src/components/MobileDrawer.tsx` — Mobile hamburger drawer
- `src/components/Shell.tsx` — Responsive Shell (Sidebar + MobileDrawer)
- `src/components/LoginForm.tsx` — Client-side login with `redirect: false`

## ClaudeClaw V3 (Potential Integration)

**Source**: User-provided zip (Mark Kashef's personal AI OS kit)  
**NOT executable code** — a system of prompts/blueprints for Claude Code to scaffold the system  
**Repo**: https://github.com/paperclipai/paperclip (separate, different project)

### Architecture (3 layers)
```
┌─────────────────────────────────────────────────┐
│  THE BRIDGE  (Telegram, Slack, Discord, Web)    │
├─────────────────────────────────────────────────┤
│  THE WRAPPER  (agents, skills, scheduler, memory)│
├─────────────────────────────────────────────────┤
│  THE BRAIN  (Claude Code / Codex / swap)         │
└─────────────────────────────────────────────────┘
         │
         ▼
  Local filesystem + SQLite database
```

### Key Concepts
- **Agent = folder** with `agent.yaml` (model + tools) + `CLAUDE.md` (persona)
- **Skill = folder** with `SKILL.md` + optional `scripts/`, `references/`, `assets/`
- **SQLite + WAL mode** — single DB, multi-process IPC without Redis/message bus
- **Three-layer memory** — FTS5 keyword + semantic embeddings + salience scoring
- **War Room** — `/standup` (agent reports) + `/discuss <question>` (multi-agent council with consolidator)
- **Kill switches** — 6 booleans in `.env`, hot-reloadable (~2s)
- **Audit log** — append-only, 90-day retention
- **Exfiltration guard** — scans outgoing content for API key patterns
- **Auto-assign** — Gemini Flash classifier routes tasks to agents

### Convergence with Agent-OS
| Feature | Agent-OS | ClaudeClaw |
|---|---|---|
| Agent dashboard | ✅ Sidebar pages | ✅ Agent folders |
| Skills | ✅ (same pattern) | ✅ SKILL.md + scripts |
| Bridge | ✅ Hermes (Telegram) | ✅ Telegram/Slack/Discord |
| Memory | ✅ Memory page | ✅ 3-tier (FTS5 + embeddings + salience) |
| War Room | ❌ | ✅ `/standup` `/discuss` |
| Hive Mind viz | ❌ | ✅ 2D/3D graph |
| Kill switches | ❌ | ✅ 6 hot-reloadable booleans |
| Audit log | ❌ | ✅ Append-only |
| Auto-assign | ❌ | ✅ Gemini Flash classifier |

### Integration Options (Discussed)
1. **Iframe** — deploy ClaudeClaw/Paperclip separately, embed in `/paperclip` route
2. **API client** — agent-os becomes a client of Paperclip's REST API for tasks/org
3. **Deep fusion** — import Paperclip React components into agent-os shell

**User direction**: Interested in integrating ClaudeClaw concepts natively into agent-os as new dashboard pages, starting with War Room.