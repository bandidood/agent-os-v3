# Post-Deploy Verification Checklist

When a Coolify deployment finishes (`status: finished`), the app is NOT guaranteed reachable. Follow this checklist.

## 1. Runtime Logs
```
mcp_coolify_application_logs uuid=<app-uuid> lines=50
```
Look for:
- Warnings about missing config (e.g. `BETTER_AUTH_BASE_URL not set`)
- Server startup line confirming listen port (e.g. `Server listening on 0.0.0.0:3100`)
- Database migration success/failure

## 2. DNS Resolution
```
python3 -c "import socket; print(socket.gethostbyname('app.domain.fr'))"
```
Must resolve to the Hetzner server IP. If it doesn't → DNS/Cloudflare issue.

## 3. External HTTPS Access
```
python3 -c "
import urllib.request
try:
    urllib.request.urlopen('https://app.domain.fr', timeout=10)
    print('OK')
except Exception as e:
    print(f'FAILED: {e}')
"
```
If timeout → Traefik routing issue. Container may not be in the `coolify` Docker network, or labels may be wrong.

## 4. Env Vars
```
mcp_coolify_env_vars action=list resource=application uuid=<app-uuid>
```
- Check for duplicates (same key appearing twice)
- Check for missing required vars (e.g. `BETTER_AUTH_BASE_URL` for Better Auth apps)

## 5. Auth-Specific Verification (NextAuth v5)

If the app uses NextAuth v5 with credentials:
1. Set `AUTH_SECRET` env var in Coolify before deploying — without it, NextAuth throws a runtime error
2. After deploy, test `/login` page loads (no 500 error = `AUTH_SECRET` is present)
3. Test login with configured credentials — a failed login should show an error, not a 500
4. After login, verify redirect to dashboard and that session cookie (`authjs.session-token`) is set
5. Test `/api/auth/session` returns the session object for authenticated users

Common issues:
- Missing `AUTH_SECRET` → server error on any auth request
- Wrong password hash format → login always fails. Must be `salt:hash` (hex) from `scryptSync`
- Missing middleware `config.matcher` for static files → infinite redirect loop on `/_next` assets

## Case: Paperclip (2026-05-26)

- Deploy finished successfully, container listening on 3100
- HTTPS to `paperclip.ccdigital.fr` timed out
- DNS resolved correctly to 95.217.87.114
- Root cause: Traefik routing (container possibly not in coolify network)
- Secondary: `BETTER_AUTH_BASE_URL` missing, `PAPERCLIP_AGENT_JWT_SECRET` duplicated
- Workaround: used `mcp_coolify_scheduled_tasks` to run `paperclip onboard --yes --bind lan` inside container (no docker exec available via MCP)
- See [Traefik routing diagnosis](traefik-routing-diagnosis.md) for the full debugging path