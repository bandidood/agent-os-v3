FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

FROM node:22-bookworm AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_PREFIX=/root/.npm-global
ENV PATH="/root/.local/bin:/root/.npm-global/bin:/usr/local/bin:$PATH"

# Pré-créer les répertoires des volumes persistants
RUN mkdir -p /root/.agentic-os \
             /root/.claude \
             /root/.local/share/hermes \
             /root/.local/bin \
             /root/.openclaw \
             /root/.npm-global \
             /root/.npm

# Install uv (fast Python package manager) + notebooklm-mcp-cli
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && /root/.local/bin/uv tool install notebooklm-mcp-cli \
    && rm -rf /tmp/uv-*

# wget+healthcheck, zstd for Ollama installer, pip for Hermes
# Chromium + deps for Playwright/Puppeteer browser automation
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget zstd python3-pip python3-venv \
      chromium chromium-common \
      fonts-liberation fonts-noto-color-emoji \
      libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
      libcairo2 libatspi2.0-0 libcups2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Tell Puppeteer/Playwright to use system Chromium, skip own download
ENV PUPPETEER_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

# Sandbox-off flags for container (no USER ns, no seccomp)
ENV CHROMIUM_FLAGS="--no-sandbox --disable-gpu --disable-dev-shm-usage"

# Global Chromium flags — applies to ALL invocations including nlm, Puppeteer, CDP
RUN mkdir -p /etc/chromium && \
    echo "--no-sandbox" > /etc/chromium/default && \
    echo "--disable-gpu" >> /etc/chromium/default && \
    echo "--disable-dev-shm-usage" >> /etc/chromium/default && \
    echo "--disable-software-rasterizer" >> /etc/chromium/default && \
    ln -sf /etc/chromium/default /etc/chromium/chromium-flags.conf

# Ensure all common binary names point to our wrapper
RUN ln -sf /usr/bin/chromium /usr/bin/chromium-browser 2>/dev/null || true && \
    ln -sf /usr/bin/chromium /usr/bin/google-chrome 2>/dev/null || true && \
    ln -sf /usr/bin/chromium /usr/bin/google-chrome-stable 2>/dev/null || true

# Wrap chromium binary so ALL invocations get --no-sandbox in container
# Detects X11 display — if present, runs with GUI flags; if not, headless
RUN mv /usr/bin/chromium /usr/bin/chromium-real && \
    echo '#!/bin/sh' > /usr/bin/chromium && \
    echo 'EXTRA_FLAGS="--no-sandbox --disable-dev-shm-usage"' >> /usr/bin/chromium && \
    echo 'if [ -n "$$DISPLAY" ] && [ -e "/tmp/.X11-unix/X$${DISPLAY#:}" ]; then' >> /usr/bin/chromium && \
    echo '  EXTRA_FLAGS="$$EXTRA_FLAGS --disable-gpu --disable-software-rasterizer"' >> /usr/bin/chromium && \
    echo 'else' >> /usr/bin/chromium && \
    echo '  EXTRA_FLAGS="$$EXTRA_FLAGS --headless=new --disable-gpu"' >> /usr/bin/chromium && \
    echo 'fi' >> /usr/bin/chromium && \
    echo 'exec /usr/bin/chromium-real $$EXTRA_FLAGS "$$@"' >> /usr/bin/chromium && \
    chmod +x /usr/bin/chromium

# ── noVNC: browser desktop accessible via web ──
# X11 + fluxbox + x11vnc + noVNC on port 6080
# DISPLAY is set per-service in docker-compose.yml or entrypoint.sh
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc fluxbox novnc websockify \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# noVNC config — bookworm has vnc_lite.html, create index.html for websockify
RUN mkdir -p /root/.vnc \
    && printf '#!/bin/sh\nxrdb $HOME/.Xresources\nfluxbox &\n' > /root/.vnc/xstartup \
    && chmod +x /root/.vnc/xstartup \
    && if [ -f /usr/share/novnc/vnc.html ]; then \
         ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html; \
       elif [ -f /usr/share/novnc/vnc_lite.html ]; then \
         ln -sf /usr/share/novnc/vnc_lite.html /usr/share/novnc/index.html; \
       else \
         echo "noVNC frontend not found, creating minimal redirect" \
         && printf '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=vnc.html"></head><body><a href="vnc.html">Click to connect</a></body></html>' > /usr/share/novnc/index.html; \
       fi

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY entrypoint.sh hermes-bootstrap.sh ./
COPY hermes-config/ /app/hermes-config/
RUN chmod +x entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["sh", "./entrypoint.sh"]