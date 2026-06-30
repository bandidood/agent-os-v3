#!/bin/sh
# Hermes config bootstrap — always copy config.yaml + build .env from Coolify env vars
mkdir -p /root/.hermes

# Config.yaml: ALWAYS copy from image (ensures clean YAML, no corruption)
# User customizations should go in config overrides, not editing this file
if [ -f /app/hermes-config/config.yaml ]; then
  echo "[hermes-bootstrap] Writing config.yaml from image..."
  cp /app/hermes-config/config.yaml /root/.hermes/config.yaml
  echo "[hermes-bootstrap] ✅ config.yaml written ($(wc -l < /root/.hermes/config.yaml) lines)"
else
  echo "[hermes-bootstrap] ⚠️  No config.yaml in image!"
fi

# .env: build from Coolify env vars (secrets NOT in git)
# Always rewrite to pick up any new env vars from Coolify
echo "[hermes-bootstrap] Writing .env from environment variables..."
{
  echo "HERMES_PASSWORD=${HERMES_PASSWORD:-}"
  echo "OPENAI_API_KEY=${OPENAI_API_KEY:-}"
  echo "ONEMIN_API_KEY=${ONEMIN_API_KEY:-}"
  echo "PVE_API_TOKEN=${PVE_API_TOKEN:-}"
  echo "PVE_HOST=${PVE_HOST:-}"
  echo "PVE_NODE=${PVE_NODE:-}"
  echo "COOLIFY_BASE_URL=${COOLIFY_BASE_URL:-}"
  echo "COOLIFY_ACCESS_TOKEN=${COOLIFY_ACCESS_TOKEN:-}"
  echo "OPNSENSE_API_KEY=${OPNSENSE_API_KEY:-}"
  echo "OPNSENSE_API_SECRET=${OPNSENSE_API_SECRET:-}"
  echo "OPNSENSE_URL=${OPNSENSE_URL:-}"
  echo "GHOST_CONTENT_API_KEY=${GHOST_CONTENT_API_KEY:-}"
  echo "GHOST_ADMIN_API_KEY=${GHOST_ADMIN_API_KEY:-}"
  echo "GHOST_API_URL=${GHOST_API_URL:-}"
  echo "GHOST_HOST_HEADER=${GHOST_HOST_HEADER:-}"
  echo "API_SERVER_KEY=${API_SERVER_KEY:-}"
  echo "API_SERVER_ENABLED=${API_SERVER_ENABLED:-}"
  echo "API_SERVER_HOST=${API_SERVER_HOST:-}"
  echo "OPENAI_BASE_URL=${OPENAI_BASE_URL:-}"
  echo "COOKIE_SECURE=${COOKIE_SECURE:-}"
  echo "TRUST_PROXY=${TRUST_PROXY:-}"
  echo "GATEWAY_ALLOW_ALL_USERS=${GATEWAY_ALLOW_ALL_USERS:-}"
} > /root/.hermes/.env
chmod 600 /root/.hermes/.env
echo "[hermes-bootstrap] ✅ .env written"