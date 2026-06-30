# Custom Ollama Provider for Hermes

## Setup (as configured for this instance)

```yaml
model:
  default: glm-5.1:cloud
  provider: custom
  base_url: http://ollama-api-<container>:11434/v1
  api_key: ollama
```

The Ollama API container is on the Docker network (`ollama-api-<container>:11434`). The `/v1` endpoint provides OpenAI-compatible API. `api_key: ollama` is a dummy key required by the config schema.

Config file: `/opt/data/config.yaml` (Coolify mount, not default `~/.hermes/`)

## Models Available (via this Ollama instance)

Currently registered in `providers.custom.models`:

- `glm-5.1:cloud` — Z.AI/ZhipuAI GLM-5.1
- `ministral-3:14b-cloud` — Mistral Ministral 14B
- `gemini-3-flash-preview:cloud` — Gemini 3 Flash
- `nemotron-3-super:cloud` — NVIDIA Nemotron
- `gemma4:31b-cloud` — Google Gemma 4
- `minimax-m2.7:cloud` — MiniMax M2.7
- `qwen3-coder-next:cloud` — Qwen 3 Coder
- `qwen3.5:cloud` — Qwen 3.5
- `deepseek-v4-pro:cloud` — DeepSeek V4 Pro
- `deepseek-v4-flash:cloud` — DeepSeek V4 Flash
- `kimi-k2.6:cloud` — Kimi K2.6
- `gpt-oss:120b-cloud` — Open-source 120B
- `llama3.2:latest` — Local Llama 3.2

## Changing Model

```bash
hermes config set model.default <model_name>
hermes config set model.provider custom
hermes config set model.base_url <new_url>
# Or interactively:
hermes model
```

## Pitfalls

- **Ollama container must be on the same Docker network** as Hermes. If unreachable, check Coolify service health.
- **`api_key: ollama` is required** even though Ollama doesn't auth — it's a config schema constraint.
- **1min.AI is NOT an OpenAI-compatible provider.** Do NOT set `OPENAI_API_KEY` / `OPENAI_BASE_URL` to 1min.AI values. 1min.AI uses a proprietary API format (header `API-KEY`, endpoint `/api/features`, body format `{type, model, promptObject}`). For 1min.AI features (image gen, web-search chat, TTS), use the `1min-ai` skill's Python wrapper at `/opt/data/skills/1min-ai/scripts/1minai.py`.
- **`OPENAI_API_KEY` / `OPENAI_BASE_URL` in .env** point to the local Ollama instance, not a real OpenAI API. These env vars are consumed by Hermes's auxiliary/fallback systems, not by the custom provider setup.
- **MCP server env vars are NOT interpolated from .env.** The `mcp_servers.*.env` section in config.yaml passes literal strings to the subprocess — `${COOLIFY_BASE_URL}` stays as `${COOLIFY_BASE_URL}`. Use actual values in config.yaml and store copies in .env for reference.
- **MCP env var names differ per package.** Always check the package source (`dist/index.js`) for `process.env.*` references. E.g., `@masonator/coolify-mcp` uses `COOLIFY_BASE_URL` (not `COOLIFY_API_URL`). Wrong names cause silent fallback to defaults like `http://localhost:3000`.
- **Hairpin NAT blocks self-referencing from containers.** When Hermes is a container on the same host as a service (Coolify, etc.), the external domain times out. Use Docker DNS hostnames (e.g., `http://coolify:8080`) instead.
- **Coolify internal port is 8080, not 3000.** The Coolify container listens on port 8080 (HTTP) and 9000 on Docker network. Port 3000 is the default the MCP package assumes but is NOT where Coolify actually binds inside Docker. Network map: Hermes=10.0.1.x, Coolify=10.0.1.8:8080, Traefik=10.0.1.9:80/443.
- **After editing config.yaml for MCP servers, `/reload-mcp` restarts the npx subprocess.** If the MCP still connects to `localhost:3000`, kill the old npx process manually (`pkill -f coolify-mcp`) then `/reload-mcp`.
- **`hermes mcp add` CLI drops `-y` flag.** The argparse parser eats `-y` as a hermes global flag. Workaround: edit config.yaml directly with `mcp_servers:` key, or quote args carefully.
