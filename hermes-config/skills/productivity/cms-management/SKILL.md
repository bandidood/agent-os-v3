---
name: cms-management
version: 1.0.0
description: "Manage content management systems (Ghost CMS, WordPress) via REST API — posts, pages, media, SEO, and site administration."
tags: [cms, ghost, wordpress, rest-api, seo, content, blog]
---

# CMS Management via REST API

Manage Ghost CMS and WordPress sites remotely via their REST APIs. Covers authentication, content CRUD, media uploads, SEO optimization, and cross-platform workflows.

## Platform Selection

| Need | Ghost CMS | WordPress |
|------|-----------|-----------|
| Blog-focused publishing | ✅ | ✅ |
| Static pages / complex sites | Limited | ✅ |
| Built-in newsletter/members | ✅ | Via plugins |
| SEO plugins | Basic (meta fields) | Rich (Rank Math, Yoast) |
| Media library management | Basic `/admin/images/` | Full `/media` REST API |
| Plugin ecosystem | Themes only | Massive |
| Auth | JWT (Admin) + key (Content) | Application Passwords (Basic Auth) |
| Content format | Lexical JSON (v5) | HTML / Gutenberg blocks |

---

## Ghost CMS

Handle Ghost CMS blogs via Admin API (JWT auth) and Content API (key auth).

### Authentication

Ghost has **two API tiers**:

**Content API (read-only, public)** — query parameter `?key=<content_api_key>`:
```bash
curl -sk "$GHOST_API_URL/ghost/api/content/posts/?limit=5&key=$GHOST_CONTENT_API_KEY" \
  -H "Host: $GHOST_HOST_HEADER"
```

**Admin API (read-write, private)** — JWT tokens from `<id>:<secret>` key:
```python
import jwt, time

def ghost_admin_token(admin_key):
    key_id, key_secret = admin_key.split(':')
    iat = int(time.time())
    payload = {'iss': key_id, 'iat': iat, 'exp': iat + 300, 'aud': '/admin/'}
    return jwt.encode(payload, bytes.fromhex(key_secret), algorithm='HS256')

def ghost_admin_headers(admin_key):
    return {'Authorization': f'Ghost {ghost_admin_token(admin_key)}'}
```

**See `references/ghost-auth.md` for full auth reference including shell-only JWT generation, key rotation after domain change, and access patterns.**

### Access from Docker Network (Coolify)

When Ghost runs on Coolify and accessed from another container on the same host, external URLs timeout (hairpin NAT). Use **HTTPS** via `coolify-proxy` with `Host:` header:

```bash
# Content API — HTTPS required (HTTP returns 302 redirect)
curl -sk "https://coolify-proxy/ghost/api/content/posts/?key=$GHOST_CONTENT_API_KEY" \
  -H "Host: $GHOST_DOMAIN"

# Admin API — same pattern with JWT
curl -sk "https://coolify-proxy/ghost/api/admin/posts/?limit=1" \
  -H "Authorization: Ghost $JWT_TOKEN" \
  -H "Host: $GHOST_DOMAIN"
```

**Critical:** Use `https://coolify-proxy` (not `http://`). HTTP returns 302 redirects losing the `Host:` header. Add `-k` / `verify=False` for SSL cert validation skip.

### Key API Endpoints

| Resource | Admin Endpoint | Content Endpoint | Notes |
|----------|---------------|------------------|-------|
| Posts | `/admin/posts/` | `/content/posts/` | `?limit=all&formats=html,mobiledoc,lexical` |
| Pages | `/admin/pages/` | `/content/pages/` | Static content |
| Tags | `/admin/tags/` | `/content/tags/` | `?limit=all` |
| Authors | `/admin/users/` | `/content/authors/` | Staff/users |
| Members | `/admin/members/` | — | Newsletter subscriptions |
| Settings | `/admin/settings/` | — | Site config |
| Themes | `/admin/themes/` | — | Upload/activate |
| Images | `/admin/images/` | — | Multipart upload |

### Writing Content in Ghost v5 (Lexical Format)

Ghost v5 uses **Lexical** as its editor format. Setting `html` or `mobiledoc` on create/update is **silently ignored** — posts appear with empty content. You MUST use the `lexical` field.

**See `templates/ghost-lexical-html-card.py`** for a Python helper that wraps HTML in Lexical HTML card nodes.

Quick usage:
```python
from ghost_lexical_html_card import build_lexical_html_card

lexical = build_lexical_html_card("<p>Hello <strong>world</strong></p>")
post_data = {"posts": [{"title": "My Post", "lexical": lexical, "status": "published"}]}
```

### Ghost SEO

Ghost has built-in SEO support via post metadata:
```python
post_data = {"posts": [{
    "title": "Mon article",
    "meta_title": "Custom meta title (≤60 chars)",
    "meta_description": "Custom meta description (150-160 chars)",
    "og_image": "https://example.com/og-image.jpg",
    "twitter_image": "https://example.com/twitter-card.jpg",
    "codeinjection_head": "<!-- custom head tags -->",
    "codeinjection_foot": "<!-- custom footer scripts -->",
}]}
```

### Ghost Pitfalls

- **Ghost is a Coolify SERVICE, not application.** Use `mcp_coolify_get_service` / `mcp_coolify_list_services`, NOT application endpoints.
- **Admin API JWT expires in 5 minutes.** Regenerate before batch operations.
- **Lexical is the only writable content format in v5.** `html` and `mobiledoc` fields are silently ignored on POST/PUT.
- **`updated_at` required for updates.** GET the post first, include its `updated_at` in PUT.
- **Domain change regenerates API keys.** Always retrieve new keys from Ghost Admin → Settings → Integrations after URL change.
- **Coolify FQDN port trap.** Auto-generated `SERVICE_URL_GHOST_2368` includes `:2368` — override to clean URL without port.
- **SMTP defaults are broken.** Coolify template sets `MAIL_OPTIONS_SERVICE=Mailgun` + empty host. Ghost falls back to `127.0.0.1:465` → `ECONNREFUSED`. Always set `MAIL_OPTIONS_SERVICE=SMTP` + real SMTP host.
- **Admin API secret is hex-encoded.** Use `bytes.fromhex(secret)` for JWT signing, NOT `secret.encode()`.
- **HTTP via coolify-proxy returns 302.** Always use HTTPS with `-k`.
- **Feature image URLs must be validated.** Unsplash URLs frequently 404. HEAD-check before use.
- **Ghost has no `/media` upload like WordPress.** Use `/admin/images/` (multipart form) or external URLs for `feature_image`.
- **Password reset via MySQL.** When SMTP is broken and `ghostctl` unavailable, use `docker exec` with bcryptjs to generate hash, then update MySQL directly. See coolify skill for details.

---

## WordPress

Manage WordPress sites remotely via the WP REST API with Application Passwords authentication.

### Authentication

WordPress uses HTTP Basic Auth with Application Passwords:
```bash
AUTH="-u 'email@example.com:xxxx xxxx xxxx xxxx xxxx xxxx'"
curl -s $AUTH 'https://example.com/wp-json/wp/v2/users/me'
```

- Create Application Password in WP Admin → Users → Profile → Application Passwords
- The password is a 24-char space-separated token — spaces are part of the format
- Always verify auth works before operations (check `/wp-json/wp/v2/users/me` returns 200)

### When IP-banned by Security Plugins

WP Captcha PRO and similar plugins block auth routes when IP is banned. **Application Passwords on `/wp-json/wp/v2/` still work** because security plugins typically only intercept login pages, not authenticated API reads/writes.

If user can't create Application Password from blocked wp-admin:
1. Use hosting panel (hPanel for Hostinger) to disable security plugin temporarily
2. Or create Application Password from a different IP
3. Or use the recovery form on blocked wp-login.php

**Never attempt brute-force login attempts** — they trigger IP bans.

### Key API Endpoints

Base: `https://example.com/wp-json/wp/v2`

| Resource | Endpoint | Notes |
|----------|----------|-------|
| Posts | `/posts` | Use `?status=draft,publish` for all |
| Pages | `/pages` | Static content |
| Media | `/media` | Upload via POST with multipart |
| Categories | `/categories` | Taxonomy for posts |
| Tags | `/tags` | Freeform taxonomy |
| Users | `/users` | List/manage users |
| Plugins | `/plugins` | Activate, deactivate, update |
| Themes | `/themes` | List, switch themes |
| Settings | `/settings` | Site title, description, etc. |

### Media Upload

```bash
# Upload image
curl -s -X POST $AUTH "$BASE/media" \
  -H 'Content-Disposition: attachment; filename="photo.jpg"' \
  -H 'Content-Type: image/png' \
  --data-binary @/path/to/photo.png
# Returns JSON with id and source_url

# Search existing media (use _fields to avoid parse errors)
curl -s $AUTH "$BASE/media?per_page=10&search=spa&_fields=id,title,source_url"
```

### WordPress SEO with Rank Math

Rank Math exposes a REST API at `/wp-json/rankmath/v1/`:

```bash
# Update SEO metadata
cat > /tmp/rm_meta.json << 'EOF'
{
  "objectID": 12345,
  "objectType": "post",
  "meta": {
    "rank_math_title": "Your SEO title",
    "rank_math_description": "Your meta description (150-160 chars)",
    "rank_math_focus_keyword": "primary keyword, secondary keyword"
  }
}
EOF

curl -s -X POST $AUTH 'https://example.com/wp-json/rankmath/v1/updateMeta' \
  -H 'Content-Type: application/json' \
  -d @/tmp/rm_meta.json
# → {"slug":true,"schemas":[]}
```

**Key points:**
- `meta` field is required (not top-level `title`/`description`)
- `objectID` = post ID, `objectType` = `"post"` or `"page"`
- Available meta keys: `rank_math_title`, `rank_math_description`, `rank_math_focus_keyword`, `rank_math_permalink`, `rank_math_robots`, `rank_math_primary_category`
- Rank Math meta is NOT in standard `/wp-json/wp/v2/posts` `meta` key — use the dedicated API

### WordPress Pitfalls

- **IP bans**: Security plugins ban IPs after failed logins. Use Application Passwords to bypass.
- **Draft vs publish**: Default query returns published posts only — use `?status=draft,publish,pending`.
- **Featured media**: Must be uploaded first via `/media`, then reference the ID.
- **Rate limiting**: Hostinger may rate-limit rapid API calls. Add delays between batch operations.
- **JSON parsing on media**: Use `?_fields=id,title,source_url` to reduce payload size.
- **Shell escaping**: Special characters (apostrophes, Unicode) break inline JSON. Always `json.dump(payload, f, ensure_ascii=False)` to temp file and use `curl -d @/tmp/payload.json`.
- **Rank Math meta not in WP REST**: Use dedicated `/wp-json/rankmath/v1/updateMeta` endpoint.
- **Brackets in content**: `[text]` may be real HTML links, not placeholders. Check via `?context=edit`.

---

## Cross-Platform Workflows

### AI-Generated Featured Images

Both CMSs benefit from AI-generated featured images via the `1min-ai` skill:

```bash
# Generate image
python3 /opt/data/skills/1min-ai/scripts/1minai.py image "your prompt" --model flux-schnell --aspect 16:9
# Parse local path from output (line starting with "📁 Local:")
```

Then upload per platform:
- **Ghost**: POST to `/admin/images/` (multipart), then set `feature_image` on post
- **WordPress**: POST to `/media`, then set `featured_media` (media ID) on post

### Batch Article Creation Pattern

1. **Research** — Use 1min-ai `chat --web` for local facts (prevents hallucinated details)
2. **Plan** — Define title, slug, excerpt, focus keyword, categories, tags, content outline per article
3. **Create drafts** — Use file-based JSON payloads to avoid shell escaping issues
4. **Set SEO** — Ghost: `meta_title`/`meta_description` in post data. WordPress: Rank Math API.
5. **Generate images** — 1min-ai `flux-schnell --aspect 16:9`, collect all local paths first
6. **Upload & attach** — Batch-upload images, set as featured image on posts
7. **Publish** — Set `status: "published"` / `"publish"` when all checks pass

### SEO Checklist (Both Platforms)

- [ ] Title ≤60 chars, keyword-rich
- [ ] Slug URL-friendly, keyword-rich
- [ ] Meta description 150-160 chars
- [ ] Category assigned (never "Uncategorized")
- [ ] Tags: 5-10 relevant ones
- [ ] Featured image set
- [ ] Heading hierarchy: H2 sections, H3 subsections
- [ ] Internal links: 3-5 to other site content
- [ ] CTA paragraph with link to business homepage/booking
- [ ] No placeholder markers left in content
- [ ] Focus keyword set in SEO plugin

---

## References

- `references/ghost-auth.md` — Ghost Admin API JWT auth reference (generation, key rotation, access patterns, shell-only JWT)
- `references/wordpress-iris-spa.md` — IRIS SPA site profile (categories, tags, batch articles, content themes for local SEO)

## Templates

- `templates/ghost-lexical-html-card.py` — Python helper for Ghost v5 Lexical HTML card nodes (build_lexical_html_card, build_lexical_paragraph, build_lexical_heading, build_lexical_document)