# Cortex 4 Analyzer Activation — orgAdmin CSRF Flow & ES Mapping Bug

## Key Discovery: orgAdmin CAN Enable Analyzers

While `superAdmin` gets 403 on all analyzer endpoints (no org membership), **`orgAdmin` with CSRF session auth CAN call `POST /api/organization/analyzer/{definitionId}`**. The endpoint is gated by org membership, not `manageAnalyzer` capability.

**HOWEVER**, there is a blocking ES mapping bug that prevents this from working.

## Analyzer API Endpoints (from JS reverse engineering of `app.6bc44b44155745ba28d1.js`)

```
POST   /api/organization/analyzer/{definitionId}  → Enable analyzer (orgAdmin session auth)
GET    /api/organization/analyzer                  → List enabled analyzers (orgAdmin)
GET    /api/analyzerconfig/{id}                    → Get analyzer config
PATCH  /api/analyzerconfig/{id}                    → Update analyzer config
DELETE /api/analyzer/{id}                          → Disable/delete analyzer
GET    /api/analyzerdefinition                     → List all 274 definitions (any auth)
GET    /api/user                                   → List users (session auth)
POST   /api/organization                           → Create org (init mode only, no auth)
POST   /api/user                                   → Create user (init mode only, no auth)
POST   /api/login                                  → CSRF login (JSON body)
```

## Full CSRF Python Flow for Analyzer Activation

```python
import urllib.request, http.cookiejar, json

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

# Step 1: Get CSRF token
opener.open('http://localhost:9001/')
xsrf = [c.value for c in jar if 'XSRF' in c.name][0]

# Step 2: Create org (init mode only — no auth required)
org_data = json.dumps({'name': 'SOCLab', 'description': 'SOC Lab Organization'}).encode()
req = urllib.request.Request('http://localhost:9001/api/organization', data=org_data, method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('X-CORTEX-XSRF-TOKEN', xsrf)
opener.open(req)

# Step 3: Create admin user (init mode only)
xsrf = [c.value for c in jar if 'XSRF' in c.name][0]
req = urllib.request.Request('http://localhost:9001/api/user', data=json.dumps({
    'name': 'Admin SOCLab', 'login': 'admin', 'password': 'SOCcortex2026!',
    'roles': ['orgadmin'], 'organization': 'SOCLab', 'status': 'Ok'
}).encode(), method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('X-CORTEX-XSRF-TOKEN', xsrf)
opener.open(req)

# Step 4: Login as orgAdmin
xsrf = [c.value for c in jar if 'XSRF' in c.name][0]
req = urllib.request.Request('http://localhost:9001/api/login',
    data=json.dumps({'user': 'admin', 'password': 'SOCcortex2026!'}).encode())
req.add_header('Content-Type', 'application/json')
req.add_header('X-CORTEX-XSRF-TOKEN', xsrf)
opener.open(req)
xsrf = [c.value for c in jar if 'XSRF' in c.name][0]

# Step 5: Enable an analyzer
payload = {
    'name': 'ThreatMiner',
    'workerDefinitionId': 'ThreatMiner_1_0',
    'configuration': {},      # MUST be JSON object {}, NOT a string
    'baseConfig': 'ThreatMiner',
}
req = urllib.request.Request('http://localhost:9001/api/organization/analyzer/ThreatMiner_1_0',
    data=json.dumps(payload).encode(), method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('X-CORTEX-XSRF-TOKEN', xsrf)
# Returns 200 OK with analyzer document — BUT SEE BLOCKING BUG BELOW
```

## ⚠️ BLOCKING BUG: ES `cortex_6` `relations` Field Mapping Conflict

The analyzer activation call fails with **500 InternalError** because:

1. Organization documents store `relations` as a **string** (e.g., `"organization"`)
2. User documents store `relations` as a **string** (e.g., `"user"`)
3. Worker (analyzer) documents store `relations` as an **object** (e.g., `{"parent": "SOCLab", "name": "worker"}`)
4. Elasticsearch's dynamic mapping locks `relations` to the type of the **first document** written
5. Since org/user docs are created first (during init), `relations` becomes `text` type
6. When a Worker document tries to write `relations` as an object, ES throws `document_parsing_exception`

**Error**: `ElasticError(document_parsing_exception, [1:662] failed to parse field [relations] of type [text] in document with id '...' Preview of field's value: '{parent=SOCLab, name=worker}')`

### Attempted Fixes That Didn't Work

- Pre-creating `cortex_6` index with `relations` as `object` type → org/user creation fails because `"organization"` string can't be stored in an object field
- Pre-creating `cortex_6` with `relations` as `text` type → Worker creation fails (object value can't be stored in text field)
- Setting `configuration` as JSON string in API payload → `JsResultException: error.expected.jsobject` (API expects object, not string)
- Injecting Worker docs directly into ES via bulk API → Cortex doesn't recognize them (Elastic4Play manages lifecycle)

### Potential Fixes (NOT YET SUCCESSFUL)

1. **Let Cortex create the index via its web UI init wizard** — tried deleting `cortex_6` and letting Cortex recreate it. Cortex creates the index dynamically with `_routing` and `_parent` based on Elastic4Play conventions. However, the init API creates org/user docs with `relations` as strings, locking the `text` mapping before Workers can set it as `object`.
2. **Create a Worker document FIRST before org/user docs** — NOT YET TESTED. Would require bypassing Cortex init (since init forces org creation first) and injecting a Worker directly into ES with `relations` as an object. This would lock `relations` as `object` type, which CAN store strings (ES stores strings inside object fields). **This is the most promising untested approach.**
3. **Create the index with `relations` as `object` AND insert org/user with `relations` as `{name:"organization"}`** — NOT YET TESTED. This requires understanding whether Elastic4Play could accept `relations` as an object for org/user docs, or if the API always stores it as a plain string.
4. **Pre-create `cortex_6` with explicit mapping where `relations` is `object` type** — TESTED. Created the index with `relations: {type: "object", dynamic: true}`. But when org docs are created via the API, Cortex stores `relations: "organization"` (a string), which fails with `object mapping for [relations] tried to parse field as object, but found a concrete value`.
5. **Pre-create `cortex_6` with all fields explicitly mapped** — TESTED. Created the index with `relations` as `text` and all Worker fields (configuration, workerDefinitionId, etc.). When Workers are created via API, Cortex sends `relations` as `{parent: "SOCLab", name: "worker"}` which fails: `failed to parse field [relations] of type [text]... Preview: '{parent=SOCLab, name=worker}'`.
6. **Downgrade to Cortex 3.1.x** — older version uses Play Framework 2.x and may serialize `relations` differently, avoiding the mapping conflict.
7. **Cortex Enterprise license** — unlocks all capabilities including `manageAnalyzer`, but the ES mapping conflict would still exist

## Cortex 4 Worker Model Fields (from JAR decompilation)

The Worker model (`org.thp.cortex.models.WorkerModel`) extends `ChildModelDef[WorkerModel, Worker, OrganizationModel, Organization]` with these attributes:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `workerId` | string | auto | Auto-generated, `_id` format |
| `name` | string | **yes** | Display name |
| `vers` | string | auto | Auto-generated version |
| `workerDefinitionId` | string | **yes** | References analyzer definition ID |
| `description` | string | auto | From definition |
| `author` | string | auto | From definition |
| `url` | string | auto | From definition |
| `license` | string | auto | From definition |
| `dataTypeList` | list | auto | From definition |
| `configuration` | object | **yes** | JSON object `{}`, NOT a string |
| `baseConfig` | string | **yes** | References definition baseConfig |
| `tpe` | string | auto | Auto-generated type discriminator |

Unknown attributes cause `UnknownAttributeError`. Only send: `name`, `workerDefinitionId`, `configuration`, `baseConfig`.

## Cortex 4 Init Flow Details

After a fresh start (empty ES index), Cortex enters **init mode**:

1. `GET /api/status` → `up: null` (not fully initialized)
2. `POST /api/organization` → creates org (no auth required in init mode)
3. `POST /api/user` → creates admin user (no auth required in init mode)
4. After org+user created, init mode locks permanently

The `init` document in ES (`cortex_6`, `_id: "init"`) marks the DB as initialized. Cortex creates this automatically when it first starts with an empty index. To reset:
```bash
curl -X DELETE 'http://localhost:9200/cortex_*'
docker restart thehive-cortex
# Then recreate org + admin via the init API flow above
```

### Important: Init Document and ES Index Lifecycle

- **DO NOT** manually create the `cortex_6` index before Cortex starts. Cortex creates it dynamically on first boot, including the `init` document and proper dynamic mappings.
- **DO NOT** pre-create mappings with explicit schema. Cortex's Elastic4Play framework manages the mapping dynamically and stores fields like `relations` and `configuration` in specific formats that don't match simple text/object types.
- If you delete the index and restart Cortex, it recreates it from scratch. But when you then create org/user docs via the init API, the `relations` field gets locked as `text` type, blocking Worker creation later.
- The `init` document content: `{"relations": "init", "createdBy": "init", "createdAt": 0, "updatedAt": 0, "updatedBy": "init"}`

## ~40 Free Analyzers (No API Key Required)

```python
# Identify free analyzers
definitions = json.loads(urlopen(Request('http://localhost:9001/api/analyzerdefinition')).read().decode())
free = [d for d in definitions if not any(i.get('required', False) for i in d.get('configurationItems', []))]
for f in free:
    print(f'{f["id"]}: {f["name"]} ({len(f.get("dataTypeList", []))} types)')
```

Examples: ThreatMiner_1_0, MaxMind_GeoIP_4_0, QrDecode_1_0, DomainMailSPFDMARC_1_2, Shodan_Info_2_0, etc.

## Current State (as of session end)

- Cortex 4 VM 310: up, `cortex_6` index deleted (needs full reinit)
- Org SOCLab + admin user need to be recreated via init API
- The ES mapping conflict is the **current blocker** for enabling analyzers programmatically
- **Most promising untested approach**: Create the index manually, inject a Worker document FIRST (with `relations` as object `{parent: null, name: "worker"}`), then create org/user docs. This locks `relations` as `object` type which can also store strings.
- **Alternative**: Use the Cortex web UI (`http://100.95.128.32:9001`) to initialize — the web UI may handle the `relations` serialization differently from the API

### Cortex 4 Full Reset + Reinit Procedure

```bash
# 1. Delete cortex_6 index
curl -s -X DELETE 'http://localhost:9200/cortex_6'

# 2. Restart Cortex
cd /opt && docker compose -f docker-compose-thehive.yml restart cortex

# 3. Wait ~30s for Cortex to be ready
# Test: curl -s 'http://localhost:9001/api/status' | python3 -c 'import sys,json; print(json.load(sys.stdin))'

# 4. Create org (init mode, no auth needed)
python3 << 'PYEOF'
import urllib.request, http.cookiejar, json
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.open('http://localhost:9001/')
xsrf = [c.value for c in jar if 'XSRF' in c.name][0]
org_data = json.dumps({'name': 'SOCLab', 'description': 'SOC Lab Organization'}).encode()
req = urllib.request.Request('http://localhost:9001/api/organization', data=org_data, method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('X-CORTEX-XSRF-TOKEN', xsrf)
print(json.loads(opener.open(req).read().decode()).get('id'))
PYEOF

# 5. Create admin user (init mode)
# 6. Login via CSRF flow
# 7. Enable analyzers (BLOCKED by ES mapping conflict — see above)
```

### API Endpoint Reference (correct paths from JS reverse engineering)

```
POST   /api/organization/analyzer/{definitionId}  → Enable analyzer (orgAdmin session auth)
GET    /api/organization/analyzer                  → List enabled analyzers (orgAdmin)
GET    /api/analyzerdefinition                     → List all 274 definitions (any auth)
GET    /api/analyzerdefinition/list                → Same as above (list variant)
GET    /api/analyzerconfig/{id}                    → Get analyzer config
PATCH  /api/analyzerconfig/{id}                    → Update analyzer config
DELETE /api/analyzer/{id}                          → Disable/delete analyzer
GET    /api/status                                 → Status (up, capabilities, versions)
POST   /api/organization                           → Create org (init mode only)
POST   /api/user                                   → Create user (init mode only)
POST   /api/login                                  → CSRF login (JSON body)
GET    /api/user                                   → List users (session auth)
```

### Enable Analyzer Payload Format (correct)

```json
{
  "name": "ThreatMiner",
  "workerDefinitionId": "ThreatMiner_1_0",
  "configuration": {},
  "baseConfig": "ThreatMiner"
}
```

**DO NOT include**: `workerId`, `vers`, `tpe`, `description`, `author`, `url`, `license`, `dataTypeList` — these cause `UnknownAttributeError`. Only send `name`, `workerDefinitionId`, `configuration` (JSON object, NOT string), `baseConfig`.