# TheHive 5 + Cortex 4 Deployment (VM 310, Docker Compose)

## VM Info
- Hostname: soc-thehive
- IP: 192.168.200.116/24 (vmbr1 bypass, will migrate to vmbr3 VLAN 20)
- OS: Debian 12 (bookworm), kernel 6.1.0-48-cloud-amd64
- Resources: 4 vCPU, 6G RAM, 80G disk
- SSH: root / SOClab2026!
- Docker: 29.5.0 installed

## Architecture: Docker Compose

TheHive 5 and Cortex 4 run as Docker containers (replacing bare-metal v4/v3).
Docker Compose file: `/opt/docker-compose-thehive.yml`

### Services

| Service | Image | Port | Volume |
|---------|-------|------|--------|
| Cassandra 4.1 | `cassandra:4.1` | 9042 | `cassandra-data` |
| Elasticsearch 8.12 | `docker.elastic.co/elasticsearch/elasticsearch:8.12.0` | 9200 | `es-data` |
| Cortex 4.0.1-1 | `thehiveproject/cortex:4.0.1-1` | 9001 | `cortex-data` |
| TheHive 5.7.2-1 | `strangebee/thehive:5.7.2-1` | 9000 | `thehive-data`, `thehive-logs` |

All on Docker bridge network. ES has xpack security disabled. Cassandra uses 512M heap.

### Deployment Commands

```bash
# Start all
cd /opt && docker compose -f docker-compose-thehive.yml up -d

# Start order: ES + Cassandra → Cortex → TheHive
cd /opt && docker compose -f docker-compose-thehive.yml up -d elasticsearch cassandra
# Wait ~30s for ES + Cassandra
cd /opt && docker compose -f docker-compose-thehive.yml up -d cortex
# Wait ~20s for Cortex
cd /opt && docker compose -f docker-compose-thehive.yml up -d thehive

# Stop all
cd /opt && docker compose -f docker-compose-thehive.yml down

# View logs
docker logs thehive-cortex 2>&1 | tail -20
docker logs thehive5 2>&1 | tail -20
```

## ⚠️ CRITICAL: Auth in Cortex 4.x — Partially Working, Major Caveats

### Bearer (API Key) Auth: BROKEN

Bearer auth (`Authorization: Bearer <key>`) is **BROKEN** in Cortex 4.0.1-1 regardless of `auth.provider` config. The `MultiAuthSrv` never reaches `KeyAuthSrv`. API keys generated via `/api/user/<id>/key/renew` are unusable for Bearer auth.

### Basic Auth: WORKS (with correct config)

Basic auth (`curl -u admin:password`) **works** when Cortex config includes `auth.method.basic = true`:

```hocon
# /opt/cortex4/conf/application.conf — mount this in Docker
auth.provider = [local, key]
auth.method.basic = true
play.http.secret.key = "CortexSecretKey2026NotForProduction"
```

The entrypoint generates `/tmp/cortex-<rand>.conf` which `include file("/etc/cortex/application.conf")`, so custom settings merge correctly.

### TheHive → Cortex: Works via Basic auth

TheHive's internal Cortex client uses `type = "basic"` which works:

```hocon
# /opt/thehive5/conf/application.conf
cortex {
  "SOCLab-cortex" {
    url = "http://cortex:9001"
    type = "basic"
    username = "admin"
    password = "SOCcortex2026!"
  }
}
```

Connection test confirmed: `POST /api/v1/admin/config/cortex/test` returns `{"user":"admin","health":"ok"}`.

### ⚠️ CRITICAL: Cortex 4 Community Edition — Analyzer Management BLOCKED

Cortex 4 Community Edition (Docker image `thehiveproject/cortex:4.0.1-1`) ships with **severely limited capabilities**:

```
capabilities: ["authByKey", "changePassword", "setPassword"]
```

Missing capabilities: `manageAnalyzer`, `manageResponder`, `manageOrganization`, `manageUser`, etc. This means:
- `GET /api/analyzer` → **403 AuthorizationError** even for `superadmin`
- `POST /api/analyzer` → **404 NotFound** (route doesn't even exist)
- `GET /api/organization/analyzer` → **403 AuthorizationError**
- TheHive's `/api/v1/connector/cortex/analyzer/template` → **403** (proxied from Cortex)

These restrictions are **license-level** — not configurable via `application.conf` or database. 274 analyzer definitions are available (`GET /api/analyzerdefinition` works with both Basic and session auth), but NONE can be enabled.

**Workaround options**:
1. **Cortex Enterprise license** (paid) — unlocks all capabilities
2. **Direct ES injection** — create analyzer documents in the `cortex_6` ES index directly
3. **Downgrade to Cortex 3.1.x** — older version without capability restrictions
4. **TheHive analyzer management** — TheHive 5 trial platinum has full capabilities; analyzer management via TheHive's CortexModule may work if Cortex capabilities allow it

### Cortex 4 CSRF Login Flow (for web UI operations)

Cortex 4's CSRF login uses **`/api/login`** (NOT `/login`):

```python
import urllib.request, http.cookiejar, json

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

# Step 1: GET / to obtain CSRF token
opener.open('http://localhost:9001/')
xsrf = None
for cookie in jar:
    if 'XSRF' in cookie.name:
        xsrf = cookie.value

# Step 2: POST /api/login (JSON, not form-encoded!)
login_data = json.dumps({'user': 'admin', 'password': 'SOCcortex2026!'}).encode()
req = urllib.request.Request('http://localhost:9001/api/login', data=login_data)
req.add_header('Content-Type', 'application/json')
req.add_header('X-CORTEX-XSRF-TOKEN', xsrf)
resp = opener.open(req)

# Step 3: Update XSRF token after login
for cookie in jar:
    if 'XSRF' in cookie.name:
        xsrf = cookie.value

# Step 4: Use session for API calls
req = urllib.request.Request('http://localhost:9001/api/analyzerdefinition')
req.add_header('X-CORTEX-XSRF-TOKEN', xsrf)
data = json.loads(opener.open(req).read().decode())  # → 274 definitions
```

**Key difference from Cortex 3.x**: Login endpoint is `/api/login` with JSON body, NOT `/login` with form data. The old flow (`POST /login` with `user=...&password=...`) returns 404.

## ⚠️ CRITICAL: TheHive 5 First Boot — Default Credentials & Setup

TheHive 5 creates a default admin user on first boot with a fresh database:
- **Default login**: `admin@thehive.local`
- **Default password**: `secret`

This means the "web UI wizard" step is only needed if you want to create a custom org/user. The default admin already exists. **Change the password immediately via API:**

```bash
# Login with default credentials
curl -s -c /tmp/th-cookies.txt -X POST 'http://localhost:9000/api/v1/login' \
  -H 'Content-Type: application/json' \
  -d '{"user":"admin@thehive.local","password":"secret"}'

# Change password
curl -s -X PATCH 'http://localhost:9000/api/v1/user/current/password' \
  -H 'Content-Type: application/json' \
  -b /tmp/th-cookies.txt \
  -d '{"currentPassword":"secret","newPassword":"SOClab2026!"}'
```

If the DB was previously initialized (has users), TheHive shows a login page — NOT the wizard. In that case, the default password may have already been changed.

### TheHive 5 API Endpoints (authenticated)

- `POST /api/v1/login` — Login with `{"user":"...","password":"..."}` → session cookie
- `GET /api/v1/user/current` — Get current user info (returns userId like "~57344")
- `PATCH /api/v1/user/current/password` — Change password (requires `currentPassword` + `newPassword`). **Note**: The actual working endpoint is `POST /api/v1/user/{userId}/setPassword` (e.g., `~57344` for the default admin). The PATCH endpoint may not work on some versions.
- `POST /api/v1/user/{userId}/key/renew` — Generate/renew API key (returns key as plain text, NOT JSON). Note: `userId` is the internal ID like `~57344`, use `GET /api/v1/user/current` to find it.
- `POST /api/v1/admin/config/cortex` — Add/update Cortex connection config
- `POST /api/v1/admin/config/cortex/test` — Test Cortex connection (requires `name`, `url`, `auth`). Returns `{"user":"admin","health":"ok"}` on success.
- `GET /api/v1/admin/config/cortex/status` — **Returns 404** in TheHive 5.7.x. Use `POST /api/v1/admin/config/cortex/test` instead.
- `GET /api/v1/connector/cortex/analyzer` — List enabled Cortex analyzers (proxied to Cortex). Returns `[]` if no analyzers enabled.
- `GET /api/v1/connector/cortex/analyzer/template` — List analyzer templates. **Returns 403** if Cortex CE has restricted capabilities.
- `GET /api/v1/admin/config/cortex` — List configured Cortex servers

### TheHive 5 Auto-Loads Trial Platinum License

On first boot with empty DB, TheHive 5 automatically loads a 15-day trial platinum license. There is no config option to disable this. Log message: `"trial platinum loaded license for 15 days"`. To start completely fresh, drop the Cassandra keyspace and delete the ES index (see DB Reset section).

## TheHive 5 DB Reset Procedure

## Cortex 4 Initialization (API)

After first start, Cortex needs org + admin creation via init API (no auth required for first user only):

### Step 1: Create Organization

```bash
curl -s -X POST 'http://localhost:9001/api/organization' \
  -H 'Content-Type: application/json' \
  -d '{"name":"SOCLab","description":"SOC Lab Organization","status":"Active"}'
```

### Step 2: Create Admin User

Cortex 4 uses `login` (not `userName`), `name` (combined, not `firstName`/`lastName`), `roles` accepts `orgAdmin`/`superAdmin`:

```bash
curl -s -X POST 'http://localhost:9001/api/user' \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","name":"Admin SOCLab","roles":["orgAdmin"],"password":"SOCcortex2026!","organization":"SOCLab","status":"Ok"}'
```

### Step 3: Set Password & Generate API Key (CSRF Flow)

After init, Cortex 4 requires CSRF tokens for POST operations:

```bash
# 1. Login to get session cookie
curl -s -c /tmp/cx4-step1 -X POST 'http://localhost:9001/api/login' \
  -H 'Content-Type: application/json' \
  -d '{"user":"admin","password":"SOCcortex2026!"}'

# 2. GET / to obtain CSRF cookie (CORTEX-XSRF-TOKEN)
curl -s -b /tmp/cx4-step1 -c /tmp/cx4-step2 'http://localhost:9001/'
CSRF=$(grep CORTEX-XSRF-TOKEN /tmp/cx4-step2 | awk '{print $NF}')

# 3. Set password
curl -s -b /tmp/cx4-step2 -H "X-CORTEX-XSRF-TOKEN: $CSRF" \
  -X POST 'http://localhost:9001/api/user/admin/password/set' \
  -H 'Content-Type: application/json' -d '{"password":"SOCcortex2026!"}'

# 4. Generate API key (NOTE: Bearer auth with this key is BROKEN — use session/Basic auth only)
curl -s -b /tmp/cx4-step2 -H "X-CORTEX-XSRF-TOKEN: $CSRF" \
  -X POST 'http://localhost:9001/api/user/admin/key/renew'
# → Returns the API key as plain text
```

## TheHive 5 DB Reset Procedure

To completely reset TheHive 5 (fresh DB, no users, no license):

```bash
# 1. Stop TheHive
cd /opt && docker compose -f docker-compose-thehive.yml stop thehive

# 2. Drop Cassandra keyspace
docker exec thehive-cassandra cqlsh -e 'DROP KEYSPACE IF EXISTS thehive;'

# 3. Delete ES index (handle alias case)
# First check if "thehive" is an alias pointing to a concrete index
curl -s 'http://localhost:9200/_cat/indices?v' | grep thehive
# If there's a concrete index like "thehive_2024...", delete it first
curl -s -X DELETE 'http://localhost:9200/<concrete-index-name>'
# Then delete the alias (or direct index)
curl -s -X DELETE 'http://localhost:9200/thehive'

# 4. Clean local data files
rm -rf /opt/thehive5/data/index /opt/thehive5/data/files 2>/dev/null

# 5. Restart TheHive (it will recreate keyspace + ES index)
cd /opt && docker compose -f docker-compose-thehive.yml up -d thehive
```

After restart, the default admin user (`admin@thehive.local` / `secret`) is auto-created with a trial platinum license.

## TheHive 5 Requires Elasticsearch (NOT Lucene)

TheHive 5's JanusGraph index backend MUST be Elasticsearch. Setting `index.search.backend = lucene` causes schema errors on startup:
```
org.janusgraph.diskstorage.indexing.StandardIndexInformation...
SchemaViolation...
```

**Docker entrypoint flags** (recommended over config mount):
```
--index-backend elasticsearch --es-hostnames elasticsearch
```

**Custom application.conf** (must also set `--no-config-search` to prevent override):
```hocon
index.search {
  backend = elasticsearch
  hostname = ["elasticsearch"]
  port = 9200
}
```

## TheHive 5 Configuration

TheHive 5's entrypoint auto-generates a config at `/tmp/thehive-<rand>.conf`. However, the auto-generated Cortex config uses `type = "bearer"` with an empty key, which **does not work** due to the Bearer auth bug.

### Recommended: Mount Custom application.conf

Mount `/opt/thehive5/conf/application.conf` with Basic auth Cortex config:

```hocon
play.http.secret.key = "ber7PtFC8l2NQrlXiY1kQB9xDmfszVmiZ6cKWtFTn6j5zdJODJQGHz11jKIL1Z0e"

db.janusgraph {
  storage {
    backend = cql
    hostname = ["cassandra"]
    cql {
      local-datacenter = datacenter1
    }
  }
}

index.search {
  backend = lucene
}

cortex {
  "SOCLab-cortex" {
    url = "http://cortex:9001"
    type = "basic"
    username = "admin"
    password = "SOCcortex2026!"
  }
}
```

### Alternative: Command Flags (simpler, no config mount)

```yaml
# docker-compose.yml thehive service
command: >
  --no-config-cortex
  --cortex-hosts=http://admin:SOCcortex2026!@cortex:9001
```

Note: `--cortex-hosts` with embedded credentials automatically sets Basic auth.

## Cortex 4 Configuration

Mount `/opt/cortex4/conf/application.conf`:

```hocon
# /opt/cortex4/conf/application.conf — mounted in Docker container
play.http.secret.key = "CortexSecretKey2026NotForProduction"

search {
  hostname = ["elasticsearch"]
  index = cortex
}

db.janusgraph {
  storage {
    backend = cql
    hostname = ["cassandra"]
    cql.local-datacenter = datacenter1
  }
  index.search {
    backend = elasticsearch
    hostname = ["elasticsearch"]
    port = 9200
  }
}

# CRITICAL: enable Basic auth for TheHive connection
auth.method.basic = true
auth.provider = [local, key]
```

**Why this config matters**:
- `auth.method.basic = true` — The default `reference.conf` sets this to `false`, which means `curl -u admin:password` returns 401 and TheHive's Basic auth connection may fail. Setting it to `true` enables the Basic auth path.
- `auth.provider = [local, key]` — Adds `key` provider alongside `local`, but Bearer auth still fails due to `MultiAuthSrv` bug. This config is needed for TheHive compatibility.
- `db.janusgraph.index.search.backend = elasticsearch` — Cortex also uses JanusGraph with ES as index backend (same as TheHive). Without this, Cortex defaults to Lucene which causes schema errors.

Note: The entrypoint generates `/tmp/cortex-<rand>.conf` which `include file("/etc/cortex/application.conf")`, so custom settings merge correctly.

## Cortex Analyzer Installation — ⚠️ COMMUNITY EDITION BLOCKED

Cortex 4 **automatically loads analyzer catalogs** from `https://catalogs.download.strangebee.com/latest/json/analyzers.json` at startup (274 analyzers loaded by default). Definitions are visible via:

```bash
# List all analyzer definitions (works with Basic or session auth)
curl -s -u 'admin:SOCcortex2026!' 'http://localhost:9001/api/analyzerdefinition' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"Total: {len(d)}")'
```

**⚠️ HOWEVER: Cortex 4 Community Edition CANNOT enable any analyzers.**

The Docker Community Edition ships with only 3 capabilities:
- `authByKey` — API key authentication
- `changePassword` — password changes  
- `setPassword` — password setting

Missing capabilities: `manageAnalyzer`, `manageResponder`, `manageOrganization`, `manageUser`, etc. This means ALL analyzer management endpoints return **403 AuthorizationError** even for `superadmin`:

```
GET  /api/analyzer                      → 403 AuthorizationError
POST /api/analyzer                      → 404 NotFound (route doesn't exist)
GET  /api/organization/analyzer         → 403 AuthorizationError
GET  /api/analyzerdefinition/VirusTotal  → 404 (only list endpoint works)
```

The `GET /api/analyzerdefinition` (list) endpoint works because it's not gated by `manageAnalyzer` capability.

### Workaround Options

1. **Cortex Enterprise license** (paid) — unlocks all capabilities
2. **Direct ES injection** — create analyzer config documents in the `cortex_6` ES index
3. **Downgrade to Cortex 3.1.x** — older version without capability restrictions
4. **TheHive trial Platinum** — TheHive 5 has full capabilities; if TheHive's CortexModule can proxy analyzer management, this may bypass the restriction

### Identifying Free Analyzers (no API key required)

```python
# Find analyzers that don't require API keys
import urllib.request, json, base64
credentials = base64.b64encode(b'admin:SOCcortex2026!').decode()
req = urllib.request.Request('http://localhost:9001/api/analyzerdefinition')
req.add_header('Authorization', f'Basic {credentials}')
data = json.loads(urllib.request.urlopen(req).read().decode())
free = [d for d in data if not any(i.get('required', False) for i in d.get('configurationItems', []))]
print(f'Free analyzers: {len(free)}')
for f in free[:10]:
    print(f'  {f["id"]} → types: {f.get("dataTypeList")}')
```

~40 analyzers don't require API keys (e.g., DNS Resolve, Shodan Intel, etc.).

### TheHive Connector Endpoints (TheHive 5)

TheHive 5 proxies analyzer management to Cortex via these endpoints:
- `GET /api/v1/connector/cortex/analyzer` — List enabled analyzers (returns `[]` if none)
- `GET /api/v1/connector/cortex/analyzer/template` — List templates (**403** from Cortex CE)
- `POST /api/v1/connector/cortex/actions` — Run analysis (**not yet tested**)

## Migration from Bare-Metal v4/v3 to Docker v5/v4

Old services were systemd-based (TheHive 4.1, Cortex 3.2, ES 8.x). They have been **disabled** and **stopped**:

```bash
systemctl disable thehive cortex elasticsearch cassandra
systemctl stop thehive cortex elasticsearch cassandra
```

Old data remains on disk but is not used:
- Old TheHive data: `/opt/thp/thehive/` (BerkeleyDB — incompatible with v5)
- Old Cortex data: `/etc/cortex/application.conf`, `/opt/cortex/`
- Old configs backup: `/root/backup-v4/`
- Old ES data: `/var/lib/elasticsearch/`
- Old Cassandra data: `/var/lib/cassandra/`

⚠️ TheHive 5 uses **Cassandra** as backend (not BerkeleyDB like v4). No data migration path — fresh install only.

## Credentials

| Service | User | Password | Notes |
|---------|------|----------|-------|
| VM SSH | `root` | `SOClab2026!` | |
| Cortex 4 org | `SOCLab` | — | Organization name |
| Cortex 4 admin | `admin` | `SOCcortex2026!` | orgAdmin, Basic auth BROKEN (CSRF flow only) |
| Cortex 4 superadmin | `superadmin` | `SOCcortex2026!` | superAdmin role |
| TheHive 5 default | `admin@thehive.local` | `secret` | Auto-created on fresh DB — CHANGE immediately |
| TheHive 5 (after change) | `admin@thehive.local` | `SOClab2026!` | |
| TheHive 5 API key | `r4kW2dHwksPH6QjjI13anEXjnpyicIYP` | — | Generated via `POST /api/v1/user/~57344/key/renew`, userId `~57344` |
| Cortex 4 admin key (Basic) | `b1+THE+zANKMBhtMUDziULuDGo5AR83U` | — | Bearer auth BROKEN. Usable only via CSRF session. |
| Cortex 4 superadmin key | `cGKidTvERwdg2zNqixRvKT0KjpqA+Lco` | — | Bearer auth BROKEN. Usable only via CSRF session. |

## Pitfalls

- **Cortex 4 Bearer auth is BROKEN**: `MultiAuthSrv` never reaches `KeyAuthSrv`. API keys are unusable for Bearer auth. Do NOT use `--cortex-keys` or `TH_CORTEX_KEYS`. For TheHive→Cortex: use `type = "basic"`. For direct API: use CSRF cookie flow or Basic auth.
- **Cortex 4 Basic auth works with `auth.method.basic = true`**: Default `reference.conf` sets `auth.method.basic = false`. Without overriding this, `curl -u admin:password` returns 401. The fix is mounting a custom `application.conf` with `auth.method.basic = true` and `auth.provider = [local, key]`.
- **Cortex 4 Community Edition CANNOT enable analyzers**: Only 3 capabilities (`authByKey`, `changePassword`, `setPassword`). All analyzer management endpoints return 403 even for `superadmin`. 274 definitions are visible but cannot be enabled. See "Cortex Analyzer Installation" section for workarounds.
- **Cortex 4 CSRF login endpoint is `/api/login`** (NOT `/login`): POST JSON body `{"user":"admin","password":"..."}` with `Content-Type: application/json`. Old form-encoded `/login` returns 404.
- **TheHive 5 default credentials**: On fresh DB, login is `admin@thehive.local` / `secret`. The web UI shows a login page (not a wizard) if this default user exists. Change password immediately via API.
- **TheHive 5 auto-loads trial platinum license**: 15-day trial loaded automatically on first boot. No config to disable. Resets on DB wipe.
- **TheHive 5 auto-config generates broken Cortex config**: The entrypoint creates `type = "bearer"` with empty key. Must override with custom `application.conf` or `--no-config-cortex --cortex-hosts` flags.
- **TheHive 5 auto-config uses Lucene by default**: The entrypoint's generated config sets `index.search.backend = lucene` which causes JanusGraph schema errors. Must override with `--index-backend elasticsearch --es-hostnames elasticsearch` or mount a custom config with `index.search.backend = elasticsearch`.
- **TheHive 5 Docker entrypoint config flags**: Important flags: `--no-config-cortex` (prevent broken Bearer config), `--index-backend elasticsearch` (use ES instead of Lucene), `--es-hostnames elasticsearch` (ES hostname), `--cortex-hosts=http://admin:SOCcortex2026!@cortex:9001` (Basic auth Cortex). These are passed as `command:` in docker-compose.yml.
- **Cortex 4 CSRF tokens**: After init mode, all POST operations require CSRF tokens. Cookie name: `CORTEX-XSRF-TOKEN`, header name: `X-CORTEX-XSRF-TOKEN`. Flow: (1) `POST /api/login` → session cookie, (2) `GET /` → CSRF cookie, (3) Use both cookies + CSRF header for POST requests.
- **Cortex init API is one-shot**: After creating the first org + user, the init API is permanently locked. To reset: `curl -X DELETE 'http://localhost:9200/cortex_*'` and restart Cortex container.
- **Cortex 4 init document and ES lifecycle**: Cortex automatically creates an `init` document (`_id: "init"`, `relations: "init"`) when it first starts with an empty ES index. This locks the `relations` field as `text` type in ES dynamic mapping. **DO NOT** manually create the `cortex_6` index — let Cortex create it. But be aware that org/user creation via API stores `relations` as strings, locking the field before Workers can use it as object. This is the root cause of the analyzer activation ES mapping conflict.
- **Cortex 4 `hasPassword: false` on user creation**: The init `POST /api/user` creates the user but returns `hasPassword: false` even when `password` is included. However, login via CSRF flow works correctly — the password IS set, just not reflected in the response. No separate `POST /api/user/<login>/password/set` call is needed if you include `password` in the creation payload.
- **Cassandra datacenter name**: TheHive 5 defaults to `datacenter1`. Cassandra Docker also defaults to `datacenter1`. Must match.
- **Memory**: 6G total. Cassandra 512M + ES 512M + Cortex ~512M + TheHive ~1-2G. Monitor with `docker stats`.
- **Cortex 4 uses Java 11** (Amazon Corretto), handled internally by the container.
- **Old v4/v3 data is incompatible**: TheHive v4 used BerkeleyDB, v5 uses Cassandra. No migration path — fresh install only.
- **Cortex init API is one-shot**: After creating the first org + user, the init API is permanently locked. To reset: `curl -X DELETE 'http://localhost:9200/cortex_*'` and restart Cortex container.
- **Cortex 4 init document and ES lifecycle**: Cortex automatically creates an `init` document (`_id: "init"`, `relations: "init"`) when it first starts with an empty ES index. This locks the `relations` field as `text` type in ES dynamic mapping. **DO NOT** manually create the `cortex_6` index — let Cortex create it. But be aware that org/user creation via API stores `relations` as strings, locking the field before Workers can use it as object. This is the root cause of the analyzer activation ES mapping conflict.
- **Cortex 4 `hasPassword: false` on user creation**: The init `POST /api/user` creates the user but returns `hasPassword: false` even when `password` is included. However, login via CSRF flow works correctly — the password IS set, just not reflected in the response. No separate `POST /api/user/<login>/password/set` call is needed if you include `password` in the creation payload.
- **Cortex 4 CSRF token extraction**: The two-step cookie flow is essential: (1) `POST /api/login` with `-c` saves session cookie, (2) `GET /` with `-b` saves the `CORTEX-XSRF-TOKEN` cookie. Extract with: `CSRF=$(grep CORTEX-XSRF-TOKEN /tmp/cookies.txt | awk '{print $NF}')`. Use `-b /tmp/cookies2` and `-H "X-CORTEX-XSRF-TOKEN: $CSRF"` for all POST requests.
- **Cortex 4 `superAdmin` role**: Use `roles: ["superAdmin"]` (single string) — NOT comma-separated roles like `["readAll","orgAdmin","superAdmin"]`.
- **Cortex 4 `key/renew` returns plain text**: The API key is returned as raw text, not JSON. Keys may contain `+` characters which are valid in `Authorization: Bearer` headers.
- **Tailscale for web UI access**: VM 310 (192.168.200.116) is on Proxmox's internal vmbr1. Browser access requires Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh && tailscale up`. Authenticate via the provided URL. Tailscale IP (e.g., 100.95.128.32) then provides access to TheHive (port 9000) and Cortex (port 9001) web UIs.
- **TheHive 5 container name**: The Docker Compose service is `thehive` but the container is named `thehive5`. Use `docker logs thehive5` and `docker exec thehive5` commands.
- **TheHive 5 `--no-config-cortex` flag**: When mounting a custom `application.conf` with a `cortex {}` block, add `--no-config-cortex` to the command to prevent the entrypoint from generating a conflicting Bearer auth config (which doesn't work anyway).