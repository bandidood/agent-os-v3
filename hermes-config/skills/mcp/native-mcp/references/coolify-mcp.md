# Coolify MCP Server Reference

## Package: `@masonator/coolify-mcp`

### Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `COOLIFY_BASE_URL` | Yes | `http://localhost:3000` | **NOT** `COOLIFY_API_URL` — this is the most common misconfiguration |
| `COOLIFY_ACCESS_TOKEN` | Yes | (empty) | Generate from Coolify UI: Profile → API Tokens |

### Full Config (config.yaml)

```yaml
mcp_servers:
  coolify:
    command: npx
    args:
      - "-y"
      - "@masonator/coolify-mcp@latest"
    env:
      COOLIFY_BASE_URL: http://coolify:3000
      COOLIFY_ACCESS_TOKEN: "1|abcd..."
```

### Hairpin NAT / Self-Host Networking

When Hermes runs as a Coolify-managed container on the same host as Coolify itself:
- **External URL** (`https://coolify.example.com`) will **time out** — the container cannot reach its own public IP (hairpin NAT)
- **localhost:3000** will **fail** — Coolify and Hermes are separate containers with isolated network stacks
- **Docker DNS** (`http://coolify:3000`) works — use the container hostname resolved by Docker's internal DNS

To discover internal hostnames from inside the Hermes container:
```bash
python3 -c "import socket; print(socket.getaddrinfo('coolify', None))"
# Output includes: ('10.0.1.8', 0) for IPv4, ('fdfa:...::8', ...) for IPv6
```

Typical internal layout on the same host:
- Hermes container: `10.0.1.10`
- Coolify container: `10.0.1.8`
- Traefik proxy: `10.0.1.9`

### Token Generation

1. Log into Coolify UI → Profile → API Tokens
2. Generate a new token (format: `{id}|{hash}`)
3. Store in `.env` AND in `config.yaml` `mcp_servers.coolify.env` (both needed — `.env` for reference, config.yaml for the MCP subprocess)

### 38 Available Tools

Infrastructure: `get_version`, `get_mcp_version`, `get_infrastructure_overview`, `list_servers`, `get_server`, `server_resources`, `server_domains`, `validate_server`, `find_issues`, `diagnose_server`

Apps: `list_applications`, `get_application`, `application`, `application_logs`, `diagnose_app`, `deploy`, `control` (start/stop/restart)

Databases: `list_databases`, `get_database`, `database`, `database_backups`

Services: `list_services`, `get_service`, `service`

Projects/Envs: `projects`, `environments`

Deployments: `list_deployments`, `deployment`

Config: `env_vars`, `bulk_env_update`, `private_keys`, `github_apps`, `teams`, `cloud_tokens`

Operations: `restart_project_apps`, `redeploy_project`, `stop_all_apps`, `search_docs`