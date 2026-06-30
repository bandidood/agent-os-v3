---
name: coolify
description: Manage Coolify self-hosting platform — deploy, debug, monitor apps via MCP and API. Covers crash loop diagnosis, API access, MCP config, and hairpin NAT workarounds.
tags:
  - coolify
  - docker
  - devops
  - deployment
  - mcp
---

# Coolify Infrastructure Management

Manage Coolify self-hosting platform: deploy, debug, and monitor applications via MCP and API.

## Setup

### MCP Server Configuration
The `@masonator/coolify-mcp` package is configured in `/opt/data/config.yaml` under `mcp_servers.coolify`.

**Critical env vars:**
- `COOLIFY_BASE_URL` — NOT `COOLIFY_API_URL`. The package reads `COOLIFY_BASE_URL` and falls back to `http://localhost:3000` if unset.
- `COOLIFY_ACCESS_TOKEN` — API token from Coolify dashboard (Settings → API Tokens).
- Port must be **8080** (not 3000). Coolify v4 listens on 8080 internally.

**Hairpin NAT issue:** If Hermes runs on the same server as Coolify, external URLs (`https://coolify.ccdigital.fr`) time out due to hairpin NAT. Use Docker internal DNS (`http://coolify:8080`) instead.

**Network map (Docker internal):**
- Coolify: `10.0.1.8` / `coolify:8080`
- Traefik: `10.0.1.9`
- Hermes: `10.0.1.10`

### API Direct Access
When MCP tools fail or need debugging, use curl directly:
```bash
curl -sk -H "Authorization: Bearer $COOLIFY_ACCESS_TOKEN" "http://coolify:8080/api/v1/applications"
```

## Application Diagnostics

### Crash Loop Investigation
1. Check app status via API: `GET /api/v1/applications/{uuid}`
   - `status: restarting:unknown` = crash loop
   - `restart_count` = number of restarts
   - `last_restart_type: crash` = process exit, not manual restart
2. Stop the app first to halt the crash loop: `POST /api/v1/applications/{uuid}/stop`
3. Get deployment logs: `GET /api/v1/deployments/{uuid}` — parse `logs` JSON array
4. Application logs (`GET /api/v1/applications/{uuid}/logs`) only work when container is running
5. For Docker-compose apps, env vars come from Coolify's runtime `.env` generation, NOT from the Coolify env-vars endpoint (which returns 404 for docker-compose apps)

### Common Crash Causes
- **EACCES permission denied on volume files**: Docker mounts volumes as `root:root` by default. If the app runs as a non-root user (e.g. `USER claude` UID 1001), any write to the mounted volume fails with `EACCES: permission denied`. Fix: use an `entrypoint.sh` that runs as root, `chown -R` the mounted directories, then `exec gosu <user>:<group>` to drop privileges. Install `gosu` in the Dockerfile. Remove `USER <name>` from the Dockerfile (entrypoint handles the switch).
- **Missing env vars**: docker-compose `env_file: .env` + Coolify injects runtime vars. Check that required tokens (TELEGRAM_BOT_TOKEN, API keys) are set in Coolify project environment.
- **Volume mount overwriting build artifacts**: If a volume mounts to `/app/store`, the `dist/` directory may get wiped. Apps should include a `start.sh` that restores from a backup inside the volume.
- **Native module incompatibility**: `better-sqlite3` and similar pre-built binaries may fail if the build stage architecture differs from runtime.
- **Empty dist/ directory**: TypeScript build output in `dist/` may be lost if a persistent volume mounts over it on restart.

### Useful API Endpoints
- `GET /api/v1/applications` — list all apps with status
- `GET /api/v1/applications/{uuid}` — full app details including `docker_compose`, `restart_count`
- `GET /api/v1/deployments/{uuid}` — deployment details with build/start logs
- `POST /api/v1/applications/{uuid}/restart` — restart app (queues a deployment)
- `POST /api/v1/applications/{uuid}/stop` — stop crash loop
- `GET /api/v1/applications/{uuid}/logs?lines=N` — container logs (only when running)

## Volume Permission Fix — Quick Diagnosis

When an app shows `restarting:unknown` with high `restart_count`:
1. Stop the app via Coolify API to halt the crash loop: `POST /api/v1/applications/{uuid}/stop`
2. Wait for `status: exited:unhealthy` (restart_count resets on successful deploy, not on stop)
3. Check `last_restart_type: crash` confirms process exit
4. Application logs (`GET /api/v1/applications/{uuid}/logs`) fail if container exited too fast — use deployment logs instead: `GET /api/v1/deployments/{deploy_uuid}`
5. Push a Dockerfile fix (entrypoint.sh + gosu pattern), then redeploy via Coolify API: `POST /api/v1/deploy?uuid={uuid}`

### Case Study: auto-claude

`EACCES: permission denied, open '/app/store/claudeclaw.pid'` — The app runs as UID 1001 (`USER claude`) but Docker mounts volumes as `root:root`. Root cause: `USER claude` in Dockerfile before CMD, volumes owned by root.

**Fix applied** (commit `2e76ee7` on `bandidood/Auto-claude`):
- Added `gosu` to `apt-get install` in Dockerfile
- Created `scripts/entrypoint.sh` that `chown -R 1001:1001` on mounted volumes then `exec gosu claude:claude /app/scripts/start.sh`
- Removed `USER claude` from Dockerfile, replaced with `ENTRYPOINT ["/app/scripts/entrypoint.sh"]`
- Result: `status: running:unknown`, `restart_count: 0`

## Deployment Monitoring

When deploying via `mcp_coolify_deploy`, the API returns immediately with `status: in_progress`. You must poll `mcp_coolify_deployment action=get` until `status: finished` or `failed`.

**Polling pattern:**
1. Deploy: `mcp_coolify_deploy tag_or_uuid=<app-uuid>`
2. Get deployment UUID from response
3. Poll `mcp_coolify_deployment action=get uuid=<deploy-uuid>` every 30–60s
4. Node.js monorepo builds (pnpm, React) typically take 3–5 minutes
5. When `finished_at` is non-null and `status: finished`, check runtime logs

**Deployment log phases:**
- Helper image preparation → clone repo → build Docker image → rolling update → cleanup
- If stuck on "Building docker image started" for >5 min, check server resources (disk, memory)

## Installing Software in Service Containers (No Docker Exec)

When you need to install packages (e.g., Claude Code, CLI tools) inside a Coolify service container and don't have Docker socket access:

1. **Preferred: Use a pre-built base image** that already includes the runtime. E.g., `node:22-bookworm` instead of `ubuntu:26.04` for Node.js tools.
2. **Update the service compose** with `mcp_coolify_service action=update docker_compose_raw=<new-compose>` — set a `command:` that installs missing packages then exec's into the desired shell.
3. **Deploy**: `mcp_coolify_deploy tag_or_uuid=<service-uuid>`
4. **Verification is limited**: The API returns `running:unknown:excluded` for custom services. You cannot `docker exec` or get logs via the API. Use the Coolify web UI terminal to verify installations.

**Pattern for installing Claude Code in a service container (with persistent volumes):**
```yaml
services:
  ubuntu:
    image: 'node:22-bookworm'  # Pre-built with Node.js 22
    container_name: ubuntu-lab
    tty: true
    stdin_open: true
    restart: unless-stopped
    environment:
      - DEBIAN_FRONTEND=noninteractive
      - TZ=Etc/UTC
      - NPM_CONFIG_PREFIX=/root/.npm-global
    volumes:
      - npm-global:/root/.npm-global
      - npm-cache:/root/.npm
      - claude-config:/root/.claude
    command:
      - bash
      - '-c'
      - |
        export PATH="/root/.npm-global/bin:$PATH"
        if ! command -v claude &> /dev/null; then
          echo "Installing Claude Code..."
          npm install -g @anthropic-ai/claude-code --prefix /root/.npm-global
          echo "Claude Code installed!"
        else
          echo "Claude Code already installed"
        fi
        claude --version
        exec bash -l
volumes:
  npm-global:
  npm-cache:
  claude-config:
```

**Key points for persistent installs:**
- Use `--prefix /root/.npm-global` with `NPM_CONFIG_PREFIX=/root/.npm-global` so npm global packages install into a Docker volume, not the ephemeral container filesystem
- Mount separate volumes for: the global bin directory (`npm-global`), the npm cache (`npm-cache`), and app config (`claude-config` for `~/.claude`)
- The `if ! command -v claude` guard skips reinstallation on subsequent starts — npm packages in the volume survive container restarts
- Always `export PATH` at the top of the command to include the volume bin dir
- Use `exec bash -l` at the end so the container stays running interactively (TTY mode)

**Volumes vs. plain command:** Without volumes, `npm install -g` writes to the container layer which is lost on restart. With volumes, the install happens once and persists across restarts. The `command -v` check makes subsequent starts instant.

## Running One-Time Container Commands (No Docker Exec)

When you need to run a one-shot command inside a Coolify container (e.g. `paperclip onboard`, DB migrations, config generation) but don't have Docker socket access, use **Coolify scheduled tasks** as a workaround:

1. `mcp_coolify_scheduled_tasks action=create resource=application uuid=<app-uuid> name=<task-name> command="<command>" frequency="* * * * *"` — creates a cron task that runs inside the container
2. `mcp_coolify_scheduled_tasks action=update ... enabled=true` — enable it to trigger execution
3. Wait for execution, check logs: `mcp_coolify_scheduled_tasks action=list_executions ...`
4. **Immediately disable** after execution: `mcp_coolify_scheduled_tasks action=update ... enabled=false` — a `* * * * *` cron left enabled will re-run every minute

**Pitfalls:**
- Don't leave scheduled tasks enabled after a one-shot command — they'll re-run every cron interval
- The command runs in the container's working directory with all env vars available
- If the command needs user input, pass non-interactive flags (e.g. `--yes`, `--bind lan`)

## Post-Deploy Reachability Verification

A successful Coolify deployment (`status: finished`) does NOT mean the app is reachable. Coolify only confirms the container started — it does not verify external HTTP access.

**Verification sequence:**
1. Check runtime logs: `mcp_coolify_application_logs uuid=<app-uuid>` — look for startup errors, missing env vars, auth warnings
2. Check DNS: `python3 -c "import socket; print(socket.gethostbyname('your.domain'))"` — must resolve to server IP
3. Test HTTPS externally: `python3 -c "import urllib.request; urllib.request.urlopen('https://your.domain', timeout=10)"` — if timeout → Traefik routing issue
4. If container runs but HTTPS times out, the container is likely not in the Traefik `coolify` network or labels are wrong — see [Traefik routing diagnosis](references/traefik-routing-diagnosis.md)

**Key insight:** `running:unknown` status + `health_check_enabled: false` means Coolify CANNOT verify app health. The app may be completely unreachable but Coolify reports it as "running". Always enable health checks for production apps.

**Common missing env vars that break apps silently:**
- `BETTER_AUTH_BASE_URL` — Paperclip and Better Auth apps need this for login/redirect to work. Without it, the app starts but auth callbacks fail.
- Set to the public URL, e.g. `BETTER_AUTH_BASE_URL=https://paperclip.ccdigital.fr`

## Pitfalls
- Coolify API port is **8080** internally, not 3000. The v4 dashboard runs on 3000 but the API is on 8080.
- Docker-compose apps don't support the `/env-vars` endpoint — env vars are managed via Coolify's project/environment UI and injected as `.env` at deploy time.
- From a Docker container on the same host, external domain URLs timeout (hairpin NAT). Always use Docker DNS names or internal IPs.
- The MCP `list_applications` tool sometimes returns connection errors even when the API is reachable via curl — fall back to direct API calls.
- **MCP config.yaml env vars**: Use literal values, NOT `${VARIABLE}` interpolation. The npx process launched by Hermes does not resolve YAML env var templates — `${COOLIFY_BASE_URL}` is passed as the literal string `${COOLIFY_BASE_URL}`, causing the MCP to fall back to `http://localhost:3000`. Always put the actual value: `COOLIFY_BASE_URL: http://coolify:8080`.
- **`hermes mcp add` args parsing**: The CLI's argparse may consume flags meant for the subprocess (e.g., `-y` gets eaten as a Hermes flag rather than passed to `npx`). If `hermes mcp add` fails silently, edit `/opt/data/config.yaml` directly under `mcp_servers:` instead.
- **`@masonator/coolify-mcp` env var name**: The package reads `COOLIFY_BASE_URL` (not `COOLIFY_API_URL`). Setting the wrong var name causes silent fallback to `http://localhost:3000`.
- **`environments get` requires `name`**: `mcp_coolify_environments action=get project_uuid=X` returns an error — you must pass `name=production` (or the environment name) as well.
- **Duplicate env vars**: Coolify allows creating the same env var key twice on an app. The `create` action appends without checking for existing keys. **Prevention:** always `list` env vars first and use `update` (with the existing `env_uuid`) if the key already exists. If you see two entries with the same `key`, delete one via `mcp_coolify_env_vars action=delete` to avoid unpredictable behavior.
- **`running:unknown` is not "healthy"**: When `health_check_enabled: false`, Coolify marks the app `running:unknown` regardless of actual reachability. The app may be listening on the wrong port, have broken Traefik labels, or be entirely unreachable — Coolify won't notice. Always enable health checks.
- **Deploying does not mean reachable**: A finished deployment only means the container started and the rolling update completed. Verify external HTTP access separately (DNS + HTTPS curl) before declaring success.
- **Ghost CMS is a service, not an application**: Ghost deployed via Coolify's one-click service template appears in `mcp_coolify_list_services`, NOT `mcp_coolify_list_applications`. The `list_applications` API will not return it. Use `mcp_coolify_get_service` with the service UUID to inspect Ghost, and `mcp_coolify_env_vars resource=service` (not `resource=application`) to manage its environment variables. Similarly, databases within the service (MySQL) are sub-resources of the service, queried via `mcp_coolify_get_service` not `mcp_coolify_get_database` with a separate UUID.
- **Changing a Ghost domain regenerates API keys**: When you update the `fqdn`/`SERVICE_URL_GHOST` for a Ghost service (e.g., from `sslip.io` to a custom domain), Ghost regenerates the Admin API integration key. The old key returns `INVALID_JWT` errors. Always retrieve fresh keys from Ghost Admin → Settings → Integrations after a domain change.
- **Coolify auto-sets `:2368` port on Ghost FQDN**: When configuring a custom domain for a Ghost service, Coolify auto-generates `SERVICE_URL_GHOST_2368` and `SERVICE_FQDN_GHOST_2368` with the port suffix (e.g., `https://la-cyber-en-clair.ccdigital.fr:2368`). Ghost's `url` env var is set to `$SERVICE_URL_GHOST` which resolves correctly, but `SERVICE_URL_GHOST_2368` with `:2368` can leak into redirect URLs and break admin access via the reverse proxy. After changing a Ghost domain, always check and fix these env vars to remove the port. Use `mcp_coolify_env_vars action=update` to set them to the clean URL (e.g., `https://la-cyber-en-clair.ccdigital.fr` and `la-cyber-en-clair.ccdigital.fr` respectively), then redeploy.
- **Ghost env vars to audit after domain change**: `url`, `SERVICE_URL_GHOST`, `SERVICE_URL_GHOST_2368`, `SERVICE_FQDN_GHOST`, `SERVICE_FQDN_GHOST_2368` — all must use the clean domain without `:2368`. The compose template also has `SERVICE_URL_GHOST_2368` which Coolify injects; verify it's overridden or the compose won't use the port-bearing URL for the `url` field.
- **Ghost one-click template has wrong SMTP defaults**: Coolify's Ghost service template sets `MAIL_OPTIONS_SERVICE=Mailgun` and `MAIL_OPTIONS_HOST=""` (empty). When Ghost starts with an empty `MAIL_OPTIONS_HOST`, it falls back to `127.0.0.1:465`, causing all password reset and notification emails to fail with `ECONNREFUSED 127.0.0.1:465`. After deploying Ghost, always override `MAIL_OPTIONS_SERVICE` to `SMTP`, set `MAIL_OPTIONS_HOST` to your SMTP server (e.g. `smtp.hostinger.com` for Hostinger, `smtp.eu.mailgun.org` for Mailgun EU), and verify `MAIL_OPTIONS_AUTH_USER`/`MAIL_OPTIONS_AUTH_PASS` match the SMTP provider credentials — NOT the Ghost admin password.
- **Accessing Ghost from the same Docker host**: Ghost's Content API and Admin API are reachable internally via `http://coolify-proxy` (or `https://coolify-proxy`) with the `Host` header set to the Ghost domain. Direct access via the sslip.io URL from outside may timeout if firewall rules don't allow the port. Always test with `Host:` header via the internal proxy first.
- **Ghost password reset when SMTP is broken**: If Ghost admin login is inaccessible and SMTP isn't working, password reset by email will fail. Use `docker exec ghost-<container> ghostctl reset-password --email <email>` on the host server to reset the password from the command line. Coolify has no API endpoint for container exec — you must SSH to the server or use the Coolify terminal UI.
- **Ghost Admin API JWT after domain change**: When the Ghost domain changes, the Content API key usually stays valid, but the Admin API key is regenerated. To use the Admin API, generate a JWT from the new key (format: `key_id:secret`, split on `:` → kid and secret, sign with HS256, aud=`/admin/`). If you get `INVALID_JWT`, the key has changed — fetch the new one from Ghost Admin → Settings → Integrations.
- **Running commands in Coolify containers without Docker access**: Hermes runs inside Docker without access to the host Docker socket. To execute commands inside Coolify-managed containers, either: (1) use Coolify's built-in terminal in the web UI, (2) SSH to the host server and run `docker exec`, or (3) create a Coolify scheduled task with the command, run it once, then disable it.
- **Coolify services are second-class citizens in the API**: Services created via `docker_compose_raw` (the `mcp_coolify_service` tools) have limited API support compared to applications. Key gaps: `mcp_coolify_application_logs`, `mcp_coolify_diagnose_app`, and `mcp_coolify_deployment action=list_for_app` all return "Application not found" for service sub-applications. Deployments list is also empty for services. To inspect a service, use `mcp_coolify_get_service` to read the service UUID, then check status via the embedded `applications[]` array. Logs must be accessed via the Coolify web UI terminal or `docker logs` on the host.
- **Inline `build:` in `docker_compose_raw` doesn't work for Coolify services**: There's no build context available. Use a pre-built public image (e.g., `node:22-bookworm` instead of `ubuntu:26.04`) combined with a `command:` that installs additional packages at startup. For persistent installs (surviving container restarts without reinstalling), use Docker named volumes mounted at the package install paths plus a `command -v` guard to skip reinstallation. See the "Pattern for installing Claude Code" section above. Without volumes, push a custom image to a registry (Docker Hub, GHCR) and reference it in the compose.
- **`starting:unhealthy` during long `command:` scripts is normal**: When a service's `command:` runs a long startup script (e.g., `npm install -g` for 100+ MB of packages), Coolify reports `starting:unhealthy` because the container hasn't passed health checks yet. The container IS running — the app just hasn't finished its init script. Wait 1-3 minutes for npm installs before assuming failure.
- **`docker_compose_domains` cannot be set via MCP**: The `mcp_coolify_application` tool rejects the `docker_compose_domains` field for docker-compose build pack apps. Use the Coolify web UI (Application → Configuration → Domains) or a direct API `PATCH /api/v1/applications/{uuid}` with `docker_compose_domains` as a JSON array string. This is the ONLY way to set domains for docker-compose applications — the `fqdn` field is also rejected.
- **Old volumes remain after path changes**: When changing volume mount paths (e.g., `/root/` → `/home/nextjs/`), the old named volumes still exist on the server. They won't cause conflicts (Coolify uses prefix-scoped names), but they take up disk space. Clean up manually if needed.
- **Docker-compose apps need `expose` not `ports`**: Coolify with Traefik doesn't need host port bindings. Use `expose: ["3000"]` instead of `ports: ["3000:3000"]`. Traefik routes via Docker network labels.
- **Alpine vs Bookworm for CLI-heavy containers**: `node:22-alpine` uses musl (not glibc) — native npm modules may fail at runtime. For containers that install CLI tools (claude, hermes, etc.), prefer `node:22-bookworm`. Bookworm also includes `wget` for Docker healthcheck (Alpine requires `apk add wget`).
- **`package-lock.json` must be committed for `npm ci`**: When adding a dependency to `package.json`, always run `npm install --package-lock-only` and commit the updated lock file. Dockerfile `RUN npm ci` fails (exit 1) without a valid lock file.
- **`node:sqlite` requires Node 22+**: The `node:sqlite` built-in module only exists from Node 22. If a Next.js app imports `node:sqlite` (e.g., `kanbanDb.ts`), the build will fail on Node 20 local dev with `ERR_UNKNOWN_BUILTIN_MODULE`. This is fine in Docker (which uses `node:22-bookworm`) but will block `npx next build` locally on older Node versions.
- **Next.js route groups for auth**: When adding login/auth to a Next.js app, the root `layout.tsx` typically wraps all pages including `/login` with the app shell (sidebar, topbar). Use a `(dashboard)` route group to scope the Shell layout to authenticated pages only — the login page gets a bare layout. See [Docker-compose app optimization](references/docker-compose-app-optimization.md) for file structure.
- **Mobile hamburger drawer pitfalls**: (1) Do NOT use `backdrop-blur-sm` on the overlay or drawer — on dark themes it just looks like a blur effect, not an overlay. Use `bg-black/70` (opaque). (2) Do NOT add `pt-16` for hamburger space — fixed-position buttons don't need layout space, and the padding shifts all content off-center on mobile. (3) Drawer background must be solid (e.g. `#1c1622`) with a visible `border-right`. See [Next.js responsive mobile](references/nextjs-responsive-mobile.md).
- **NextAuth v5 Edge Runtime: no node:crypto in middleware**: If `auth.ts` imports `auth-password.ts` (which uses `node:crypto`), the middleware crashes. **Best fix**: add `export const runtime = "nodejs"` to `middleware.ts` to force Node.js runtime (allows crypto imports). The `auth-edge.ts` approach (providers: []) creates a separate JWT context — sessions from the full `auth.ts` are NOT readable, so the middleware always redirects to `/login`. Full details in [Docker-compose app optimization](references/docker-compose-app-optimization.md).
- **NextAuth v5 UntrustedHost behind Traefik**: NextAuth validates the Host header. Behind Traefik, the forwarded host differs, causing `UntrustedHost` errors. Set `AUTH_TRUST_HOST=true` in both docker-compose env and Coolify env vars.
- **NextAuth v5 `signIn()` typing**: `signIn("credentials", { redirectTo })` returns type `never` in v5. Use `redirect: false` for client-side error handling. See the reference for code.
- **Next.js 16 `node_modules` type errors**: Next.js 16 beta ships with broken type defs. Add `typescript: { ignoreBuildErrors: true }` to `next.config.ts`. The `eslint` key was removed in v16 — don't add it.
- **`package-lock.json` cross-Node compatibility**: Lock files generated on Node 20 may fail `npm ci` on Node 22 Docker. Use `npm install --frozen-lockfile 2>/dev/null || npm install` in the Dockerfile.
- **NextAuth v5 `NEXTAUTH_URL` behind proxy**: Without `NEXTAUTH_URL`, NextAuth constructs callback URLs from the container's internal address (`0.0.0.0:3000`) causing `ERR_ADDRESS_INVALID` after login. Set `NEXTAUTH_URL=https://your.domain.fr` in both docker-compose env and Coolify env vars. This is separate from `AUTH_TRUST_HOST` — trust allows the host header, NEXTAUTH_URL tells NextAuth what the public base URL is.
- **NextAuth v5 is beta**: Use `next-auth@^5.0.0-beta.29` or later. The v4 API is incompatible. `AUTH_SECRET` must be set or NextAuth throws at runtime.
- **NextAuth v5 session not shared between configs**: Creating a separate `auth-edge.ts` with `providers: []` for middleware creates a DIFFERENT JWT signing context. Sessions from the full `auth.ts` are NOT readable by `auth-edge.ts`, so the middleware always sees `session: null` and redirects to `/login` on every request. Use `export const runtime = "nodejs"` in middleware instead.
- **Shell interpolation in node -e**: When writing `node -e` scripts in shell, single quotes prevent `$1` expansion. Use `process.argv[1]` and pass the arg after the script string instead: `node -e "... process.argv[1] ..." "$1"`.
- **Git executable bit for shell scripts**: Shell scripts committed to git default to mode `100644` (no exec). Even with `chmod +x` in the Dockerfile, a fresh `git clone` resets permissions based on the stored mode. Run `git update-index --chmod=+x scripts/foo.sh && git commit` to store as `100755`. Without this, `./scripts/foo.sh` fails with `Permission denied` in the container. **Important**: `git add -A` can RESET the mode back to `100644` because it stages the working-tree copy, which may differ from the index. The reliable sequence is: `git add -A` → `git update-index --chmod=+x scripts/foo.sh` → `git commit`. Always run `git update-index --chmod=+x` AFTER `git add`, or as a separate step before commit.
- **Gateway daemon sub-commands may differ**: Always check the actual CLI's `--help` output for correct gateway start commands. For OpenClaw, the correct command is `openclaw gateway run` (not `openclaw gateway --port`). The `--allow-unconfigured` flag is required — without it, the gateway crashes with "Missing config. Run openclaw setup". For Hermes, there is NO persistent gateway — the dashboard calls `hermes -z PROMPT --yolo --accept-hooks` per request (oneshot mode). Always add `sleep 3 && kill -0 $!` verification after starting a daemon to catch immediate failures.
- **pgrep pattern matching**: When verifying background processes, use short process names like `pgrep -f "ollama"` or `pgrep -f "openclaw"` — not full command strings like `"ollama serve"` or `"openclaw gateway"` which may not match the actual process argv. Always check what the process name actually is (`ps aux | grep <name>`).
- **OpenClaw gateway requires config.json**: The gateway crashes with "Missing config. Run openclaw setup" if `/root/.openclaw/config.json` doesn't exist. The entrypoint must auto-create a minimal config: `{"gateway":{"mode":"local","port":8989}}`. Also pass `--allow-unconfigured` to bypass remaining setup checks.
- **Ollama in container for local LLMs**: Install Ollama via `curl -fsSL https://ollama.com/install.sh | sh` in the entrypoint. Start with `OLLAMA_HOST=0.0.0.0 nohup ollama serve &`. Auto-pull models via `OLLAMA_PULL_MODELS` env var (comma-separated). Set `OLLAMA_HOST=0.0.0.0` (not `localhost`) so the API is reachable from agent CLIs on the container network. Persist models with a Docker volume at `/root/.ollama`. Expose port `11434` in docker-compose.
- **PEP 668 blocks pip install on Debian Bookworm**: `node:22-bookworm` ships Python 3.11+ which enforces PEP 668 — `pip install` into the system Python is blocked with "error: externally-managed-environment". When installing Python-based npm packages (like `hermes-agent`), use `pip3 install --break-system-packages` as fallback. The entrypoint pattern: try `npm install -g` first → verify `command -v` → if missing, try `pip3 install --break-system-packages`. Without `--break-system-packages`, pip exits with PEP 668 error and npm reports success but the binary is missing.
- **zstd is required for Ollama installer**: The Ollama install script (`curl -fsSL https://ollama.com/install.sh | sh`) fails with "This version requires zstd for extraction" on Debian Bookworm if `zstd` is not installed. Add `zstd` to the Dockerfile's `apt-get install` line alongside `wget` and `python3-pip`. Do NOT rely on runtime `apt-get install` in the entrypoint for these packages — they should be baked into the image for faster cold starts and to avoid apt lock contention with background install processes.
- **Ollama cloud models are instant to pull**: Ollama models with `:cloud` tags (e.g. `kimi-k2.6:cloud`, `deepseek-v4-flash:cloud`) download only a manifest, not multi-GB weights. Auto-pulling them at startup via `OLLAMA_PULL_MODELS` env var takes seconds, not minutes. Use comma-separated format: `OLLAMA_PULL_MODELS=kimi-k2.6:cloud,deepseek-v4-flash:cloud`.
- **Pre-install system packages in Dockerfile, not entrypoint**: For agent containers that install CLI tools at runtime, bake `wget`, `zstd`, `python3-pip`, and `python3-venv` into the Dockerfile. Runtime `apt-get install` in the entrypoint adds 10-30 seconds per boot and can fail if the apt lock is held by another process. The pattern: `RUN apt-get update && apt-get install -y --no-install-recommends wget zstd python3-pip python3-venv && rm -rf /var/lib/apt/lists/*` in Dockerfile, then skip the apt-get step in entrypoint entirely.
- **Hermes config + secrets + skills injection**: Hermes needs `config.yaml` (provider/model config), `.env` (API keys, secrets), and skills (~69MB, 98 SKILL.md files). None belong in git. **Architecture**:
  1. **config.yaml (no secrets)**: Bake directly into the Docker image under `hermes-config/config.yaml`. **ALWAYS copy to volume on boot** — do NOT use a write-once guard (`if [ ! -f ]`). If a volume gets corrupted (e.g. truncated base64, bad UTF-8), the write-once guard prevents the clean image copy from overwriting it, and the app fails with parse errors on every restart forever. Adapt URLs for container (e.g. `localhost:11434` instead of Docker hostname). Pattern: `cp /app/hermes-config/config.yaml /root/.hermes/config.yaml` (unconditional).
  2. **.env (secrets)**: Inject via Coolify env vars (`mcp_coolify_env_vars action=bulk_update` with `is_runtime:true`). The bootstrap script writes them to `/root/.hermes/.env` using shell variable expansion (`echo "HERMES_PASSWORD=${HERMES_PASSWORD:-}"`). **ALWAYS rewrite .env on boot** — don't use a write-once guard. Coolify env vars change (key rotations, new services) and the on-container .env must stay in sync. Writing every boot costs nothing and ensures consistency.
  3. **Skills (~69MB)**: Inject once via `docker cp` into the `agent-hermes-config` Docker volume (too large for Docker image or env vars). Persists across redeployments.
  **Critical**: if `.env` is missing, Hermes falls back to OpenRouter without auth → 401 errors. The `.env` must contain at minimum `OPENAI_API_KEY`, `HERMES_PASSWORD`, and any provider keys.
- **NEVER embed large base64 in shell scripts**: Base64 strings >~4KB get truncated or have padding corrupted in shell scripts, causing "invalid leading UTF-8 octet" YAML parse errors. For config files that belong in the image, bake them directly into the Docker image (`COPY hermes-config/ /app/hermes-config/`) and copy to volumes at boot. For secrets, use Coolify env vars with shell expansion — never base64-encode them into scripts.
- **Coolify env var size limit**: The MCP API (`mcp_coolify_env_vars`) can't handle values larger than ~4KB. For configs like Hermes config.yaml (~14KB base64), bake the file into the Docker image instead. The env var endpoint silently fails or truncates large values. The Coolify API also rejects direct curl calls with "Unauthenticated" — always use the MCP tools or verify auth tokens are correct.
- **Corrupted volume recovery**: If a persistent volume contains corrupted data (e.g., a truncated base64 config), the safest fix is to **always overwrite config from the Docker image on every boot**. This eliminates the corruption class entirely. If you still use a write-once guard and hit corruption, delete the volume via `mcp_coolify_storages action=delete` and force redeploy. The lesson: write-once guards for config files are a trap — any corruption or encoding issue makes the app fail on every restart forever because the guard prevents the clean copy from overwriting the bad file.
- **Coolify env vars bulk_update for secrets**: Use `mcp_coolify_env_vars action=bulk_update` with `is_runtime:true, is_buildtime:false` to inject many secrets at once. Each entry needs `key` and `value` — the API returns UUIDs for each. Prefer this over creating vars one by one. Warning: bulk_update creates duplicates if the key already exists — always `list` first and `update` existing keys by UUID instead.

## Docker-Compose Applications on Coolify

Coolify has two models: **Applications** (linked to a Git repo, build from source) and **Services** (docker-compose raw). A docker-compose Application (`build_pack: dockercompose`) gets the best of both — Git-based deploys AND Coolify's Traefik/proxy automation.

### Key differences from Services
- Applications support `health_check_enabled`, `fqdn`, deployment history, and logs via API
- `docker_compose_domains` (not `fqdn`) sets the domain per service — Coolify auto-generates Traefik/Caddy labels and Let's Encrypt certs
- The `docker_compose_raw` is the source of truth; Coolify injects its own environment (COOLIFY_BRANCH, SERVICE_URL_*, etc.) and labels into the rendered compose
- When you push to the linked Git branch, Coolify auto-rebuilds if webhooks are configured

### Setting domains for docker-compose apps
The `mcp_coolify_application` tool does NOT handle `docker_compose_domains` correctly — it rejects the JSON. You must set it via the Coolify web UI (Application → Configuration → Domains) or via direct API PATCH:
```bash
curl -X PATCH "http://coolify:8080/api/v1/applications/{uuid}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"docker_compose_domains":"[{\"service_name\":\"myservice\",\"domain\":\"https://my.domain.fr\"}]"}'
```
After setting the domain, Coolify automatically adds Traefik labels (HTTP→HTTPS redirect, TLS, gzip) and Caddy labels to the rendered compose.

### Optimizing a docker-compose for Coolify
1. **`expose:` instead of `ports:`** — Traefik routes on the Docker network, no host port needed
2. **Volumes under the app user's home** — If the Dockerfile uses `USER nextjs` (uid 1001), mount volumes under `/home/nextjs/` not `/root/`. Pre-create dirs with `chown` in Dockerfile. For **root-user pattern** (personal tools), use `/root/` paths and `node:22-bookworm` — see [Docker-compose app optimization](references/docker-compose-app-optimization.md) for the full root-pattern reference.
3. **Entrypoint script for CLI installs** — Use an `entrypoint.sh` that installs agents on first boot (with `command -v` guard) then `exec node server.js`. Set `NPM_CONFIG_PREFIX` and `PATH` for persistent npm-global installs.
4. **Healthcheck** — Set `start_period: 60s+` if the entrypoint installs packages; Coolify's health check needs time before marking healthy.
5. **Don't mount over system paths** — Never mount a volume over `/usr/local/bin` or `/usr/local/lib/node_modules`. Use a prefix directory like `/home/nextjs/.npm-global` (or `/root/.npm-global` for root) instead.
6. **Auth for personal tools** — NextAuth v5 with Credentials provider + JWT sessions works without a DB. Store `AUTH_SECRET` + admin credentials hash as Coolify env vars. See [NextAuth v5 pattern](references/docker-compose-app-optimization.md) for file structure.

### Old service volumes migration
When converting from a service (root user, `/root/` paths) to an application (non-root user, `/home/nextjs/` paths), the old named volumes still exist but are empty. The new Dockerfile must `mkdir -p` and `chown` all volume mount points so the non-root user can write.

## Async Entrypoint Pattern

When an entrypoint installs many CLI agents (Claude, Hermes, Gemini, etc.), the install phase can take 2-3 minutes on first boot. This blocks the app from becoming available. **Solution: start the app immediately, install agents in a background subshell.**

```bash
#!/bin/sh
set -e
export NPM_CONFIG_PREFIX="/root/.npm-global"
export PATH="/root/.npm-global/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

install_agents() {
  # ... install logic with command -v guards ...
}

# Non-blocking: app starts immediately, installs happen async
install_agents &

echo "=== Starting Agent OS ==="
exec node server.js
```

**Key points:**
- `install_agents &` runs in background — `node server.js` starts within seconds
- `/root/.local/bin` must be in PATH (some CLIs like `agy` install there via `curl | bash`)
- Set `healthcheck start_period: 30s` (not 120s) since the app is ready immediately
- First boot installs everything; subsequent boots skip due to `command -v` guards + persistent volumes
- Agent availability is progressive — agents appear in the dashboard as the background installer finishes each one

### Gateway Startup in Entrypoint

Some agents (OpenClaw, Hermes) have persistent gateway/daemon processes that must run alongside the web app. The entrypoint can start these as background processes after installation:

```bash
# Start gateways after agent install completes
if command -v openclaw >/dev/null 2>&1; then
  echo "[gateway] 🚀 Starting OpenClaw gateway on port $OPENCLAW_GATEWAY_PORT..."
  openclaw gateway --port "$OPENCLAW_GATEWAY_PORT" --host "0.0.0.0" >/root/.openclaw/gateway.log 2>&1 &
  sleep 3
  if kill -0 $! 2>/dev/null; then
    echo "[gateway] ✅ OpenClaw gateway running (PID $!)"
  else
    echo "[gateway] ⚠️  OpenClaw gateway failed — check /root/.openclaw/gateway.log"
  fi
fi
```

**Key points:**
- Gateways start AFTER the async install completes (inside the `install_agents &` function)
- Each gateway gets its own log file in the agent's config volume
- `sleep 3` + `kill -0 $!` verifies the process didn't exit immediately
- Gateway ports should be configurable via env vars (e.g. `OPENCLAW_GATEWAY_PORT=8989`, `HERMES_GATEWAY_PORT=8787`)
- Gateway sub-commands may differ from what's documented — check actual CLI help and adjust. The entrypoint pattern is: install → verify → start daemon → verify running

**Pitfall**: The `gateway` / `serve` sub-command names are assumptions based on common patterns. If the gateway fails to start, check the log file and the actual CLI's `--help` output for the correct command.

### API Key Auth for Container Agents

Interactive OAuth login (Claude Code's browser-based auth) does NOT work in containers — no browser, session lost on restart. **Use API keys instead:**

- `ANTHROPIC_API_KEY=sk-ant-...` — Claude Code uses this directly (no OAuth prompt)
- `OPENAI_API_KEY=sk-...` — Codex
- `GOOGLE_API_KEY=AIza...` — Gemini CLI

Set these as Coolify env vars with `is_runtime: true` (NOT `is_buildtime`). The entrypoint can also write the key to the CLI's config file:
```bash
if [ -n "$ANTHROPIC_API_KEY" ] && command -v claude >/dev/null 2>&1; then
  mkdir -p /root/.claude
  printf '{"apiKey":"%s"}\n' "$ANTHROPIC_API_KEY" > /root/.claude/api-key.json
fi
```

### Python-based npm packages need pip

`npm install -g hermes-agent` internally calls `pip install`. If the container doesn't have `pip`, the install fails silently (npm exits 0 but the binary is missing). **Fix**: install pip before hermes in the entrypoint:
```bash
if ! command -v hermes >/dev/null 2>&1; then
  # Ensure pip is available
  if ! python3 -m pip --version >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y --no-install-recommends python3-pip python3-venv >/dev/null 2>&1 || {
      curl -fsSL https://bootstrap.pypa.io/get-pip.py | python3 2>&1 | tail -3
    }
  fi
  npm install -g hermes-agent 2>&1 | tail -3
  # Verify install actually succeeded
  if ! command -v hermes >/dev/null 2>&1; then
    echo "⚠️  Hermes install failed — check pip/python setup"
  fi
fi
```

**PEP 668 workaround for Debian Bookworm**: `node:22-bookworm` enforces PEP 668 — `pip install` into system Python fails with "externally-managed-environment". For Python-based npm packages (like `hermes-agent`), chain fallbacks:
```bash
# Try npm first, then pip3 with --break-system-packages
npm install -g hermes-agent 2>&1 | tail -3
if ! command -v hermes >/dev/null 2>&1; then
  pip3 install --break-system-packages hermes-agent 2>&1 | tail -3
fi
```

**Important**: Always verify `command -v <binary>` AFTER npm install, not just check the npm exit code. npm can report success but the binary is missing if a sub-installer (pip, cargo, etc.) fails.

## References
- [Volume permission fix pattern](references/volume-permission-fix.md) — gosu entrypoint pattern for Docker-volume EACCES crashes
- [Traefik routing diagnosis](references/traefik-routing-diagnosis.md) — container runs but HTTPS times out: network, labels, debug steps
- [Deploy verification checklist](references/deploy-verification-checklist.md) — post-deploy reachability checks, env var audit, health check enablement
- [Docker-compose app optimization](references/docker-compose-app-optimization.md) — Coolify-specific docker-compose patterns, domains, volumes, NextAuth v5
- [Next.js responsive mobile](references/nextjs-responsive-mobile.md) — Mobile hamburger drawer, responsive layout, dvh units
- [Paperclip deployment](references/paperclip-deployment.md) — Deploying Paperclip (agent orchestration) on Coolify: docker-compose, auth, adapters
- [Agent-OS architecture](references/agent-os-architecture.md) — Agent-OS on Coolify: setup, routes, env vars, NextAuth, and ClaudeClaw integration notes