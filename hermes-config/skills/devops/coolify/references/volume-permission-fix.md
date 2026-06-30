# Volume Permission Fix Pattern for Coolify Docker-Compose Apps

## Problem
Docker mounts named volumes as `root:root`. Apps that switch to a non-root user via `USER <name>` in the Dockerfile cannot write to those volumes, causing `EACCES: permission denied` crashes on startup.

The Coolify compose parser converts `container_name: auto-claude` into `auto-claude-<hash>`, so volume paths and permissions must work generically.

## Solution: entrypoint.sh with gosu

### 1. Install gosu in Dockerfile
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    gosu \
    && rm -rf /var/lib/apt/lists/*
```

### 2. Create scripts/entrypoint.sh
```sh
#!/bin/sh
set -e
# Fix volume permissions — Docker mounts volumes as root:root
# This script runs as root (ENTRYPOINT), then drops to the app user
echo "[entrypoint] Fixing ownership of mounted volumes..."
chown -R 1001:1001 /app/store 2>/dev/null || true
chown -R 1001:1001 /workspace 2>/dev/null || true
chown -R 1001:1001 /home/claude/.claude 2>/dev/null || true
chown -R 1001:1001 /home/claude/.claude_session 2>/dev/null || true
echo "[entrypoint] Switching to claude user..."
exec gosu claude:claude /app/scripts/start.sh
```

### 3. Update Dockerfile
```dockerfile
# Remove: USER claude
# Remove: CMD ["sh", "scripts/start.sh"]
# Add:
RUN chmod +x scripts/entrypoint.sh scripts/start.sh
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
```

### 4. Keep start.sh as the app launcher (no permission logic needed)
```sh
#!/bin/sh
BACKUP="/app/store/dist-backup"
DIST="/app/dist"
if [ -f "${BACKUP}/index.js" ] && [ ! -f "${DIST}/dashboard.js" ]; then
  echo "[startup] Restoring dist from backup..."
  cp -r "${BACKUP}/." "${DIST}/"
fi
exec node "${DIST}/index.js"
```

## Diagnosis Checklist
When an app shows `restarting:unknown` with high `restart_count`:
1. Stop the app via Coolify API to halt the crash loop
2. Check API field `last_restart_type: crash` confirms process exit
3. Look for `EACCES` errors in application logs
4. Compare volume mount paths against the app's write directories
5. Verify the Dockerfile `USER` directive matches the UID that needs write access

## Alternative: init subreaper
If `gosu` is unavailable, `su-exec` (Alpine) or `setpriv` (util-linux) work similarly. For minimal images, `tini` + `chown` in a root CMD script also works:

```sh
#!/bin/sh
chown -R 1001:1001 /app/store 2>/dev/null || true
exec su-exec claude:claude node /app/dist/index.js
```

## Related
- Coolify sets `restart: unless-stopped` in compose, so crash loops auto-retry indefinitely
- Coolify docker-compose apps inject `.env` at deploy time — env var gaps are another top crash cause
- The `restart_count` field in the API resets when a deployment succeeds, not when stopped