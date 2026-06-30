# Coolify Infrastructure Reference

## Instance Details

- **Dashboard URL**: https://dashboard.ccdigital.fr
- **API URL (internal)**: http://coolify:8080 (Docker DNS)
- **API URL (external)**: https://coolify.ccdigital.fr (hairpin NAT blocks from container)
- **API Token**: stored in .env as `COOLIFY_ACCESS_TOKEN`
- **MCP env var name**: `COOLIFY_BASE_URL` (NOT `COOLIFY_API_URL`)
- **Version**: Coolify 4.0.0
- **Proxy**: Traefik v3.6

## Docker Network Map

| Service | Container DNS | IP | Ports |
|---------|--------------|-----|-------|
| Hermes | — | 10.0.1.10 | — |
| Coolify | `coolify` | 10.0.1.8 | 8080 (API), 9000 |
| Traefik | `coolify-proxy` | 10.0.1.9 | 80 (HTTP), 443 (HTTPS), 8080 (dashboard) |

## Coolify MCP Server Config

In `/opt/data/config.yaml`:

```yaml
mcp_servers:
  coolify:
    command: npx
    args:
      - "-y"
      - "@masonator/coolify-mcp@latest"
    env:
      COOLIFY_BASE_URL: http://coolify:8080
      COOLIFY_ACCESS_TOKEN: <token>
```

**Key pitfalls:**
- `COOLIFY_BASE_URL` not `COOLIFY_API_URL` — check `dist/index.js` for `process.env.*`
- `env:` values are NOT templated from .env — use literal values
- Port 8080, not 3000 — Coolify's actual listen port inside Docker
- Hairpin NAT: external domain unreachable from same-server containers

## API Quick Reference (via curl from Hermes container)

```bash
# Version
curl -sk -H "Authorization: Bearer $TOKEN" http://coolify:8080/api/v1/version

# List apps
curl -sk -H "Authorization: Bearer $TOKEN" http://coolify:8080/api/v1/applications

# App details (replace UUID)
curl -sk -H "Authorization: Bearer $TOKEN" http://coolify:8080/api/v1/applications/<UUID>

# Restart app
curl -sk -X POST -H "Authorization: Bearer $TOKEN" http://coolify:8080/api/v1/applications/<UUID>/restart

# List deployments
curl -sk -H "Authorization: Bearer $TOKEN" http://coolify:8080/api/v1/deployments

# App env vars (compose apps use Environment model, not Application)
curl -sk -H "Authorization: Bearer $TOKEN" http://coolify:8080/api/v1/applications/<UUID>/env-vars
```

## Known Applications

| App | UUID | Status | Notes |
|-----|------|--------|-------|
| auto-claude:main | yqtmj6dmmlj1l8oybwjrrafq | restarting (crash loop) | Repo: bandidood/Auto-claude |
| ciso-assistant-industry:main | mcj9fwurglrtyfe59i5ke4y5 | running | |
| johann-lebel-portfolio:master | hek9a71h1lry25kg9w7kne7y | running | |
| paperclip:main-c2 | h11l8xv8ftcarv2qqlwdrsue | running | |

## Diagnosing Crash Loops

1. Check `restart_count` and `last_restart_type` in app details
2. Stop the app first to halt the crash loop: `POST /api/v1/applications/<UUID>/stop`
3. Deployment UUID from restart response → `GET /api/v1/deployments/<uuid>` for build logs
4. Docker compose apps: `docker_compose_raw` field shows runtime compose with resolved env vars
5. Application logs endpoint only works when container is running (`status: running:unknown`)
6. Docker-compose apps return 404 on `/env-vars` — env vars are managed via Coolify project/environment UI and injected as `.env` at deploy time
7. Check volumes for app logs: `/data/coolify/volumes/<app-name>-*/`

### auto-claude crash loop (97 restarts)
- **Root cause suspects**: Missing `TELEGRAM_BOT_TOKEN` in Coolify env, or volume `/app/store` wiping `dist/` on restart
- **start.sh** restores `dist/` from `store/dist-backup/` but if backup was never created (first run), app crashes
- **Fix**: Check env vars in Coolify project settings, ensure required tokens are set; verify `dist-backup` exists in persistent volume