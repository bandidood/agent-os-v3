# Traefik Routing Diagnosis

When a Coolify app container is running (logs confirm server listening, no startup errors) but HTTPS access from outside times out, the problem is almost always Traefik routing.

## Symptoms
- `mcp_coolify_application_logs` shows healthy startup (DB migrations OK, server listening on expected port)
- DNS resolves correctly to the server IP
- `curl https://app.domain.fr` times out (not 502, not 503 — full timeout)
- `mcp_coolify_diagnose_app` reports "healthy" (misleading when `health_check_enabled: false`)

## Root Cause Candidates (Most → Least Likely)

1. **Container not in the `coolify` Docker network** — Traefik only routes to containers in its network. When deploying via Coolify, the container should auto-join, but this can fail silently.
2. **Wrong Traefik labels** — The container must have `traefik.enable=true` and correct `traefik.http.routers.<name>.rule=Host(\`app.domain.fr\`)` labels. Coolify generates these from the app's FQDN config.
3. **Port mismatch** — Traefik forwards to the container's exposed port. If the app listens on 3100 but `ports_exposes` is set to something else, routing fails.
4. **SSL cert not provisioned** — Traefik uses Let's Encrypt via ACME. If the cert doesn't exist yet, the first request may fail. Check Traefik logs for ACME errors.

## Diagnosis Steps (from MCP/API only, no Docker socket)

### 1. Check app FQDN and port
```
mcp_coolify_get_application uuid=<app-uuid>
```
- Verify `fqdn` matches expected domain
- Verify `ports_exposes` matches the port app actually listens on (from logs)

### 2. Check if Traefik knows about the app
```
mcp_coolify_diagnose_app query=paperclip
```
- This reports app health from Coolify's perspective, not Traefik's. A "healthy" result means Coolify reached the container, not that Traefik routes to it.

### 3. Check Coolify proxy logs
Requires SSH or Docker access on the server:
```bash
docker logs coolify-proxy 2>&1 | grep -i paperclip
docker logs coolify-proxy 2>&1 | grep -i ACME | tail -20
```

### 4. Check container Traefik labels and networks
Requires SSH or Docker access:
```bash
docker inspect <container_id> --format '{{json .NetworkSettings.Networks}}' | python3 -m json.tool
docker inspect <container_id> --format '{{json .Config.Labels}}' | python3 -m json.tool | grep traefik
```

### 5. Hairpin NAT check
If running the curl FROM the same server (e.g. from Hermes container), the request hairpins and times out. This is NOT a Traefik issue — test FROM an external machine or use `curl http://<container_ip>:<port>` inside the Docker network instead.

## Fixes

### Container not in coolify network
This typically requires a redeploy. Try:
1. Stop the app: `mcp_coolify_control resource=application action=stop uuid=<app-uuid>`
2. Redeploy: `mcp_coolify_deploy tag_or_uuid=<app-uuid>`
3. If still not routed, the issue may be in Coolify's network configuration — check server resources: `mcp_coolify_server_resources uuid=<server-uuid>`

### Wrong port
Update the app: `mcp_coolify_application action=update uuid=<app-uuid> ports_exposes=3100`

### Missing/wrong labels
Usually fixed by ensuring `fqdn` is set correctly on the app and redeploying. Coolify regenerates labels on each deploy.

## Case: Paperclip (2026-05-26)

- App `paperclip:main-c2` deployed successfully, container listening on :3100
- `https://paperclip.ccdigital.fr` timed out from external
- DNS resolved correctly to 95.217.87.114
- `health_check_enabled: false` → Coolify reported "healthy" despite no external access
- Required SSH/Docker access to check Traefik labels and container network membership
- Agent could not resolve from MCP/API alone — required server-side inspection