# Ghost CMS Authentication Reference

## Admin API JWT Generation

Ghost Admin API uses JWT tokens signed with HS256. The Admin API key has the format `<id>:<hex_secret>`.

### Step-by-step token generation

1. Split the Admin API key at the colon: `id = before_colon`, `secret = after_colon`
2. Decode the secret from hex: `bytes.fromhex(secret)`
3. JWT claims:
   - `iss` (issuer) = the `id` portion
   - `iat` (issued at) = current unix timestamp
   - `exp` (expiration) = `iat + 300` (5 minutes)
   - `aud` (audience) = `/admin/` (use `/v3/admin/` for backward compatibility)
4. Sign with HS256 using the decoded secret bytes
5. Use as `Authorization: Ghost <token>` header

### Python implementation

```python
import jwt, time

def ghost_admin_token(admin_api_key: str) -> str:
    key_id, key_secret = admin_api_key.split(':')
    iat = int(time.time())
    payload = {
        'iss': key_id,
        'iat': iat,
        'exp': iat + 300,
        'aud': '/admin/'
    }
    token = jwt.encode(payload, bytes.fromhex(key_secret), algorithm='HS256')
    return token

def ghost_admin_headers(admin_api_key: str) -> dict:
    return {'Authorization': f'Ghost {ghost_admin_token(admin_api_key)}'}
```

### Shell implementation (openssl only)

```bash
#!/bin/bash
# Generate Ghost Admin API JWT from id:secret key
ADMIN_KEY="${GHOST_ADMIN_API_KEY:?Set GHOST_ADMIN_API_KEY}"

# Split key
KEY_ID="${ADMIN_KEY%%:*}"
KEY_SECRET="${ADMIN_KEY##*:}"

# Build JWT header and payload
HEADER=$(echo -n '{"alg":"HS256","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
NOW=$(date +%s)
PAYLOAD=$(echo -n "{\"iss\":\"$KEY_ID\",\"iat\":$NOW,\"exp\":$((NOW+300)),\"aud\":\"/admin/\"}" | base64 -w0 | tr '+/' '-_' | tr -d '=')

# Sign
SIGNATURE=$(echo -n "$HEADER.$PAYLOAD" | openssl dgst -sha256 -hmac "$(echo -n "$KEY_SECRET" | xxd -r -p)" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')

TOKEN="$HEADER.$PAYLOAD.$SIGNATURE"
echo "Authorization: Ghost $TOKEN"
```

## Admin API Key Rotation After Domain Change

**Critical pitfall:** When you change the Ghost `url` setting (e.g., switching from a `sslip.io` URL to a custom domain like `la-cyber-en-clair.ccdigital.fr`), Ghost regenerates the Admin API integration key. The old key will produce `INVALID_JWT` / "invalid signature" errors.

**Recovery steps:**
1. Go to Ghost Admin → Settings → Integrations → [Your integration]
2. Copy the new Admin API key (format: `<id>:<hex_secret>`)
3. Also copy the new Content API key (it may change too)
4. Update env vars: `GHOST_ADMIN_API_KEY` and `GHOST_CONTENT_API_KEY`
5. Regenerate JWT tokens from the new key — old tokens are permanently invalid

## Content API Key Authentication

The Content API uses a simple key parameter. No JWT needed.

```bash
# From Docker network (coolify-proxy)
curl -sk "https://coolify-proxy/ghost/api/content/posts/?key=$GHOST_CONTENT_API_KEY" \
  -H "Host: $GHOST_HOST_HEADER"

# From external network
curl -s "https://$GHOST_DOMAIN/ghost/api/content/posts/?key=$GHOST_CONTENT_API_KEY"
```

The Content API key is found in Ghost Admin → Settings → Integrations → [Your integration] → Content API key.

## Access Patterns

| From | To | Method |
|------|----|--------|
| Coolify container | Ghost container | `https://coolify-proxy` + `Host:` header + `-k` (skip cert) |
| External client | Ghost (with domain) | `https://yourdomain.com` |
| External client | Ghost (no domain) | `http://ghost-<uuid>.<ip>.sslip.io:2368` |
| Ghost container | Ghost container | Direct container name on Docker network |

**Important:** Use HTTPS (`https://coolify-proxy`) internally — HTTP returns 302 redirects that lose the `Host:` header. Add `-k` / `verify=False` to skip cert validation since the proxy cert matches the public domain, not `coolify-proxy`.

## Environment Variables

Store these in `.env` for the Hermes agent:

```
GHOST_CONTENT_API_KEY=<content_api_key>
GHOST_ADMIN_API_KEY=<id>:<hex_secret>
GHOST_API_URL=https://coolify-proxy
GHOST_HOST_HEADER=<your-domain>  # e.g. la-cyber-en-clair.ccdigital.fr
```

## Coolify Service UUID Format

Ghost on Coolify is deployed as a **service** with sub-resources.
- Service UUID changes on recreation — always look up with `mcp_coolify_list_services`.
- Use `mcp_coolify_get_service` with the service UUID. Do NOT use application tools.

Use `mcp_coolify_get_service` with the service UUID. Do NOT use application tools.