#!/bin/sh
# Agent OS — start immediately, install+start agents async in background
set -e

export NPM_CONFIG_PREFIX="/root/.npm-global"
export PATH="/root/.npm-global/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# The whole container runs as root (no unprivileged user set up), and
# Claude Code's CLI refuses --dangerously-skip-permissions under root/sudo
# unless it believes it's in a sandbox. OpenClaw's claude-cli backend (and
# our own /api/run, /api/claude routes) rely on that flag, so without this
# every Claude-backed chat call fails with:
#   FailoverError: --dangerously-skip-permissions cannot be used with
#   root/sudo privileges for security reasons
export IS_SANDBOX="${IS_SANDBOX:-1}"

# Gateway ports (configurable via env)
export OPENCLAW_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-8989}"
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0}"
export OLLAMA_PORT="${OLLAMA_PORT:-11434}"

# Virtual display for Chromium (nlm login, Puppeteer, etc.)
export DISPLAY="${DISPLAY:-:99}"
if [ -z "$DISABLE_XVFB" ]; then
  Xvfb :99 -screen 0 1280x720x24 -ac 2>/dev/null &
  echo "=== Xvfb virtual display on :99 ==="
fi

echo "=== Agent OS ==="

mkdir -p /root/.agentic-os/vault /root/.openclaw /root/.claude /root/.local/share/hermes /root/.hermes

# ---- Resolve OpenClaw gateway token (once, at top level) ----
# Must happen before `exec node server.js` below, and before the async
# installer forks, so BOTH the supervised gateway process AND any
# `openclaw health`/CLI subprocess spawned later by the Next.js server
# (e.g. src/app/api/vitals) inherit the exact same token.
#
# Source of truth: if the OpenClaw setup wizard already wrote
# /root/.openclaw/openclaw.json with a gateway.auth.token, that's the
# canonical token the CLI reads by default — reuse it instead of
# minting our own (a mismatched token was the actual cause of the
# "unauthorized / token_mismatch" loop seen in gateway.log). Otherwise
# fall back to a persisted generated token.
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  if [ -f /root/.openclaw/openclaw.json ] && command -v node >/dev/null 2>&1; then
    OPENCLAW_GATEWAY_TOKEN=$(node -e '
      try {
        const c = require("/root/.openclaw/openclaw.json");
        const t = c && c.gateway && c.gateway.auth && c.gateway.auth.token;
        if (t) process.stdout.write(t);
      } catch (e) {}
    ' 2>/dev/null)
  fi
  if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
    printf '%s' "$OPENCLAW_GATEWAY_TOKEN" > /root/.openclaw/gateway.token
  elif [ -f /root/.openclaw/gateway.token ]; then
    OPENCLAW_GATEWAY_TOKEN=$(cat /root/.openclaw/gateway.token)
  else
    OPENCLAW_GATEWAY_TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    printf '%s' "$OPENCLAW_GATEWAY_TOKEN" > /root/.openclaw/gateway.token
  fi
fi
export OPENCLAW_GATEWAY_TOKEN

# ---- Bootstrap Hermes config + skills ----
if [ -f /app/hermes-bootstrap.sh ]; then
  sh /app/hermes-bootstrap.sh
fi

# Skills: copy from image on first boot (preserved via volume on redeploy)
if [ -d /app/hermes-config/skills ] && [ ! -f /root/.hermes/skills/.skills-copied ]; then
  echo "[hermes-bootstrap] 📚 Copying skills from image..."
  mkdir -p /root/.hermes/skills
  cp -r /app/hermes-config/skills/* /root/.hermes/skills/ 2>/dev/null || true
  cp -r /app/hermes-config/skills/.* /root/.hermes/skills/ 2>/dev/null || true
  touch /root/.hermes/skills/.skills-copied
  SKILL_COUNT=$(find /root/.hermes/skills -name "SKILL.md" 2>/dev/null | wc -l)
  echo "[hermes-bootstrap] ✅ $SKILL_COUNT skills copied"
fi

# --- Async agent installer + gateway starter ---
install_and_start_agents() {
  echo "[agent-installer] Starting background install + gateway startup..."

  # ---- Install agents if missing ----

  # 1) Claude Code
  if ! command -v claude >/dev/null 2>&1; then
    echo "[agent-installer] 📦 Installing Claude Code..."
    npm install -g @anthropic-ai/claude-code 2>&1 | tail -3
  else
    echo "[agent-installer] ✅ Claude Code: $(claude --version 2>/dev/null || echo 'ok')"
  fi

  # 2) Hermes — pip pre-installed in Dockerfile, --break-system-packages for PEP 668
  if ! command -v hermes >/dev/null 2>&1; then
    echo "[agent-installer] 📦 Installing Hermes..."
    npm install -g hermes-agent 2>&1 | tail -5
    if ! command -v hermes >/dev/null 2>&1; then
      echo "[agent-installer] ⚠️  npm install failed, trying pip directly..."
      pip3 install --break-system-packages hermes-agent 2>&1 | tail -5 || {
        pip3 install hermes-agent 2>&1 | tail -5 || echo "[agent-installer] ⚠️  Hermes install failed"
      }
    fi
    if command -v hermes >/dev/null 2>&1; then
      echo "[agent-installer] ✅ Hermes installed"
    else
      echo "[agent-installer] ⚠️  Hermes not available"
    fi
  else
    echo "[agent-installer] ✅ Hermes already present"
  fi

  # 3) OpenClaw
  if ! command -v openclaw >/dev/null 2>&1; then
    echo "[agent-installer] 📦 Installing OpenClaw..."
    npm install -g openclaw@latest 2>&1 | tail -3
  else
    echo "[agent-installer] ✅ OpenClaw already present"
  fi

  # 4) Antigravity (agy)
  if ! command -v agy >/dev/null 2>&1; then
    echo "[agent-installer] 📦 Installing Antigravity CLI..."
    curl -fsSL https://antigravity.google/cli/install.sh | bash 2>&1 | tail -5 || echo "[agent-installer] ⚠️  Antigravity install skipped"
  else
    echo "[agent-installer] ✅ Antigravity already present"
  fi

  # 6) Codex
  if ! command -v codex >/dev/null 2>&1; then
    echo "[agent-installer] 📦 Installing Codex CLI..."
    npm install -g @openai/codex 2>&1 | tail -3 || echo "[agent-installer] ⚠️  Codex install skipped"
  else
    echo "[agent-installer] ✅ Codex already present"
  fi

  # 7) Ollama — local LLM server
  if ! command -v ollama >/dev/null 2>&1; then
    echo "[agent-installer] 📦 Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh 2>&1 | tail -5
    if command -v ollama >/dev/null 2>&1; then
      echo "[agent-installer] ✅ Ollama installed"
    else
      echo "[agent-installer] ⚠️  Ollama install failed"
    fi
  else
    echo "[agent-installer] ✅ Ollama already present"
  fi

  # ---- Configure API keys (non-interactive auth) ----

  if [ -n "$ANTHROPIC_API_KEY" ] && command -v claude >/dev/null 2>&1; then
    echo "[agent-installer] 🔑 Configuring Claude Code with ANTHROPIC_API_KEY"
    mkdir -p /root/.claude
    printf '{"apiKey":"%s"}\n' "$ANTHROPIC_API_KEY" > /root/.claude/api-key.json 2>/dev/null || true
  fi

  # ---- Start gateways in background ----

  # Ollama — local LLM server (must start before model pulls)
  if command -v ollama >/dev/null 2>&1; then
    echo "[gateway] 🚀 Starting Ollama server on port $OLLAMA_PORT..."
    OLLAMA_HOST="$OLLAMA_HOST:$OLLAMA_PORT" nohup ollama serve >/root/.ollama/server.log 2>&1 &
    OLLAMA_PID=$!
    sleep 3
    if kill -0 $OLLAMA_PID 2>/dev/null; then
      echo "[gateway] ✅ Ollama server running (PID $OLLAMA_PID, port $OLLAMA_PORT)"
      if [ -n "$OLLAMA_PULL_MODELS" ]; then
        for model in $(echo "$OLLAMA_PULL_MODELS" | tr ',' ' '); do
          echo "[gateway] 📥 Pulling Ollama model: $model..."
          ollama pull "$model" 2>&1 | tail -3
        done
      fi
    else
      echo "[gateway] ⚠️  Ollama server failed — check /root/.ollama/server.log"
      cat /root/.ollama/server.log 2>/dev/null | tail -10
    fi
  else
    echo "[gateway] ⚠️  Ollama not installed, skipping"
  fi

  # OpenClaw gateway — supervised directly by this script (no systemd:
  # containers have no systemd/dbus session, so `openclaw` must never be
  # asked to install/enable itself as a systemd --user service; we just
  # run the gateway binary and keep it alive ourselves).
  if command -v openclaw >/dev/null 2>&1; then
    echo "[gateway] 🚀 Starting OpenClaw gateway (supervised, no systemd)..."
    if [ ! -f /root/.openclaw/config.json ]; then
      echo "[gateway] Writing minimal OpenClaw config..."
      mkdir -p /root/.openclaw
      printf '{"gateway":{"mode":"local","port":%s}}\n' "$OPENCLAW_GATEWAY_PORT" > /root/.openclaw/config.json
    fi

    # OPENCLAW_GATEWAY_TOKEN was already resolved + exported at the top
    # of this script (reused from openclaw.json if the setup wizard ran,
    # so the CLI's `openclaw health` and this gateway process always
    # agree on the same token).
    openclaw_gateway_watchdog() {
      export OPENCLAW_DISABLE_SYSTEMD=1
      while true; do
        echo "[gateway] (re)starting openclaw gateway on port $OPENCLAW_GATEWAY_PORT" >> /root/.openclaw/gateway.log
        openclaw gateway run --port "$OPENCLAW_GATEWAY_PORT" --allow-unconfigured --auth token --token "$OPENCLAW_GATEWAY_TOKEN" >>/root/.openclaw/gateway.log 2>&1
        echo "[gateway] openclaw gateway exited (code $?), restarting in 5s..." >> /root/.openclaw/gateway.log
        sleep 5
      done
    }
    openclaw_gateway_watchdog &
    GW_PID=$!
    echo $GW_PID > /root/.openclaw/gateway.watchdog.pid
    sleep 5
    if kill -0 $GW_PID 2>/dev/null; then
      echo "[gateway] ✅ OpenClaw gateway watchdog running (PID $GW_PID, port $OPENCLAW_GATEWAY_PORT)"
    else
      echo "[gateway] ⚠️  OpenClaw gateway watchdog failed to start — check /root/.openclaw/gateway.log"
      cat /root/.openclaw/gateway.log 2>/dev/null | tail -10
    fi
  else
    echo "[gateway] ⚠️  OpenClaw not installed, skipping gateway"
  fi

  # Hermes — no persistent gateway needed (oneshot CLI mode)
  if command -v hermes >/dev/null 2>&1; then
    echo "[hermes] ✅ Hermes CLI available (oneshot mode per request)"
  fi

  # ---- Final summary ----
  echo ""
  echo "[agent-installer] === Installed agents ==="
  for cmd in claude hermes openclaw agy codex ollama; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "  ✅ $cmd: $(command -v "$cmd")"
    else
      echo "  ❌ $cmd: not found"
    fi
  done
  echo ""
  echo "[agent-installer] === Running gateways ==="
  for proc in "ollama" "openclaw"; do
    pid=$(pgrep -f "$proc" 2>/dev/null | head -1)
    if [ -n "$pid" ]; then
      echo "  ✅ $proc (PID $pid)"
    else
      echo "  ❌ $proc: not running"
    fi
  done
  echo ""
  echo "[agent-installer] === Ollama models ==="
  if command -v ollama >/dev/null 2>&1; then
    ollama list 2>/dev/null | while IFS= read -r line; do echo "  $line"; done || echo "  (none)"
  else
    echo "  (ollama not installed)"
  fi
  echo ""
  echo "[agent-installer] === Hermes config ==="
  if [ -f /root/.hermes/config.yaml ]; then
    echo "  ✅ config.yaml present"
  else
    echo "  ❌ config.yaml missing — set HERMES_CONFIG_B64 or mount volume"
  fi
  SKILL_COUNT=$(find /root/.hermes/skills -name "SKILL.md" 2>/dev/null | wc -l)
  echo "  📚 $SKILL_COUNT skills loaded"
  echo "[agent-installer] === Done ==="
}

# Start install + gateways in background (non-blocking)
install_and_start_agents &

# --- Start Next.js immediately ---
echo "=== Starting Agent OS ==="
exec node server.js