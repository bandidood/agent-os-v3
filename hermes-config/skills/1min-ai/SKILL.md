---
name: 1min-ai
description: "1min.AI unified API — image generation, chat with web search, audio TTS, image editing, asset management, and credit tracking."
version: 2.1.0
author: Hermes Agent
metadata:
  hermes:
    tags: [api, image-generation, chat, ai, 1min, tts, search]
    homepage: https://docs.1min.ai/docs/api/intro
---

# 1min.AI API Skill

Unified access to the 1min.AI platform — 30+ image models, chat with web search (like Perplexity), TTS, image editing, and more.

## Environment

- **ONEMIN_API_KEY** — required. Set in Coolify env vars or `/opt/data/.env`
- **Base URL**: `https://api.1min.ai`
- **Auth header**: `API-KEY: $ONEMIN_API_KEY`
- **Content-Type**: `application/json`

## Quick Reference

```bash
# Source the API key
source <(grep ONEMIN_API_KEY /opt/data/.env | grep -v '^#')

# Generate an image (fast)
python3 /opt/data/skills/1min-ai/scripts/1minai.py image "a cute cat" --model flux-schnell

# Chat with web search (like Perplexity)
python3 /opt/data/skills/1min-ai/scripts/1minai.py chat "What was the weather in Paris yesterday?" --web

# Text to speech
python3 /opt/data/skills/1min-ai/scripts/1minai.py tts "Hello world" --voice shimmer -o /tmp/hello.mp3

# Remove background from image
python3 /opt/data/skills/1min-ai/scripts/1minai.py remove-bg <image_url>

# Check remaining credits
python3 /opt/data/skills/1min-ai/scripts/1minai.py credit-check

# List all available models
python3 /opt/data/skills/1min-ai/scripts/1minai.py list-models
```

## Python Wrapper Script

Location: `/opt/data/skills/1min-ai/scripts/1minai.py`

A full Python client with:

- **CLI mode** — run directly from terminal with any feature
- **Import mode** — `from hermes_tools import terminal; terminal("python3 /opt/data/skills/1min-ai/scripts/1minai.py image ...")`
- **Model aliases** — use short names like `flux-schnell`, `gpt-image-1`, `gemini-2.5-flash-image`
- **Automatic download** — images/TTS files cached in `/opt/data/skills/1min-ai/cache/`
- **Error handling** — graceful failures with JSON parsing
- **Smart model selection** — see aliases section below

### CLI Usage

```bash
python3 1minai.py <command> [args] [--options]
```

| Command | Description | Example |
|---------|-------------|---------|
| `image <prompt>` | Generate an image | `image "cat" --model flux-schnell --aspect 16:9` |
| `chat <message>` | Chat with AI | `chat "Hello" --model gpt-4o-mini` |
| `chat <message> --web` | Chat with web search | `chat "Latest AI news" --web` |
| `tts <text>` | Text to speech | `tts "Hello" --voice shimmer -o voice.mp3` |
| `vary <url>` | Image variations | `vary https://... --n 4` |
| `upscale <url>` | Upscale image | `upscale https://... --scale 4` |
| `remove-bg <url>` | Remove background | `remove-bg https://...` |
| `replace-bg <url>` | Replace background | `replace-bg https://... --prompt "beach"` |
| `remove-object <url>` | Remove object | `remove-object https://... --prompt "car"` |
| `face-swap <src> <tgt>` | Swap faces | `face-swap src.jpg tgt.jpg` |
| `img2prompt <url>` | Image → text prompt | `img2prompt https://...` |
| `asset-upload <file>` | Upload to Asset API | `asset-upload photo.jpg` |
| `credit-check` | Check remaining credits | `credit-check` |
| `list-models` | List all model aliases | `list-models` |

### Image Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--model NAME` | Model alias (see below) | `flux-schnell` |
| `--aspect RATIO` | Aspect ratio | `1:1` |
| `--size WxH` | Custom dimensions | `1024x1024` |
| `--steps N` | Inference steps (1-50) | `25` |

### Chat Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--model NAME` | Chat model | `gpt-4o-mini` |
| `--web` | Enable web search | `false` |
| `--no-web` | Disable web search | `true` |

### TTS Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--voice NAME` | Voice model | `alloy` |
| `-o PATH` | Output file path | auto in cache/ |

### Available Voices (OpenAI TTS)

`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

---

## Smart Model Selection

The wrapper maps short aliases to full model IDs.

### Premium / Best Quality

| Alias | Model ID |
|-------|----------|
| `flux-pro` | `black-forest-labs/flux-pro` |
| `flux-1.1-pro-ultra` | `flux-1.1-pro-ultra` |
| `flux-2-pro` | `flux-2-pro` |
| `flux-2-max` | `flux-2-max` |
| `gpt-image-1` | `gpt-image-1` |
| `gemini-3-pro-image` | `gemini-3-pro-image-preview` |
| `grok-2-image` | `grok-2-image` |

### Fast / Cheap

| Alias | Model ID |
|-------|----------|
| `flux-schnell` | `black-forest-labs/flux-schnell` ⭐ |
| `flux-dev` | `flux-dev` |
| `flux-2-klein-4b` | `flux-2-klein-4b` |
| `flux-2-flash` | `gemini-2.5-flash-image` |
| `flux-3.1-flash` | `gemini-3.1-flash-image-preview` |

### Mid-Range

| Alias | Model ID |
|-------|----------|
| `dall-e-3` | `dall-e-3` |
| `sd-xl` | `stable-diffusion-xl-1.0` |
| `ideogram` | `ideogram` |
| `qwen-image` | `qwen-image` |
| `recraft` | `recraft` |
| `magic-art-7` | `magic-art-7.0` |

### Leonardo

| Alias | Model ID |
|-------|----------|
| `leonardo-phoenix` | `leonardo-phoenix` |
| `leonardo-lightning` | `leonardo-lightning-xl` |
| `leonardo-anime` | `leonardo-anime-xl` |
| `leonardo-kino` | `leonardo-kino-xl` |

---

## Hermes Integration Patterns

### Analyze user-sent images (vision)

When the user sends an image and you need to analyze it, use the 1min-ai chat endpoint with the image URL instead of the built-in `vision_analyze` tool (which may fail with the current model). The chat endpoint supports image URLs in the message.

```python
from hermes_tools import terminal
# For images cached by Hermes at /opt/data/image_cache/ or /opt/data/cache/documents/
# Use the chat endpoint with an image URL or describe the image inline
result = terminal("python3 /opt/data/skills/1min-ai/scripts/1minai.py chat 'Describe what you see in this image: <URL>' --model gpt-4o")
```

**When to use this**: Whenever `vision_analyze` returns an error or the model lacks native vision capability. The 1min-ai chat endpoint with `gpt-4o` or `gpt-4o-mini` provides reliable image analysis.

### Generate image and send to Telegram

```
1. Load skill: skill_view("1min-ai")
2. Call: terminal("python3 /opt/data/skills/1min-ai/scripts/1minai.py image 'prompt'")
3. Extract local path from output
4. Send: MEDIA:/path/to/image.webp
```

### Chat with web search (Perplexity-style)

```python
from hermes_tools import terminal
result = terminal("python3 /opt/data/skills/1min-ai/scripts/1minai.py chat 'your question' --web")
# Result contains: response text, sources, credit used
```

### Text to speech to voice message

```python
# Generate audio
terminal("python3 /opt/data/skills/1min-ai/scripts/1minai.py tts 'Hello' -o /tmp/voice.ogg")
# Send as voice message
# MEDIA:/tmp/voice.ogg
```

### Full automated pipeline

```python
from hermes_tools import terminal

# 1. Generate image
r = terminal("python3 /opt/data/skills/1min-ai/scripts/1minai.py image 'sunset' --model flux-schnell --aspect 16:9")
# Parse local path from output

# 2. Apply effect
r = terminal("python3 /opt/data/skills/1min-ai/scripts/1minai.py remove-bg <extracted_url>")

# 3. Send result
# MEDIA:/path/to/final.png
```

### Generate image and upload to WordPress

```python
from hermes_tools import terminal

# 1. Generate with flux-schnell (most reliable model)
r = terminal("python3 /opt/data/skills/1min-ai/scripts/1minai.py image 'your prompt' --model flux-schnell --aspect 16:9")
# Parse local path from output (line starting with "📁 Local:")

# 2. Upload to WordPress media library
AUTH = "-u 'user@example.com:xxxx xxxx xxxx xxxx xxxx xxxx'"
BASE = "https://example.com/wp-json/wp/v2"
r = terminal(f"""curl -s -X POST {AUTH} '{BASE}/media' \
  -H 'Content-Disposition: attachment; filename="image-name.png"' \
  -H 'Content-Type: image/png' \
  --data-binary @/path/to/generated/image.png 2>/dev/null""")
# Parse media_id from response

# 3. Set as featured image on a post
r = terminal(f"""curl -s -X POST {AUTH} '{BASE}/posts/POST_ID' \
  -H 'Content-Type: application/json' \
  -d '{{"featured_media":MEDIA_ID}}' 2>/dev/null""")
```

---

## Response Format

Non-streaming responses return:

```json
{
  "aiRecord": {
    "uuid": "...",
    "temporaryUrl": "https://s3.us-east-1.amazonaws.com/asset.1min.ai/...",
    "metadata": {"credit": 12361, "inputToken": 26645, "outputToken": 206}
  }
}
```

- **temporaryUrl** — signed S3 URL (expires ~7 days)
- **metadata.credit** — credits used for this call (for the `credit-check` command to track)

### Chat Response (with web search)

```
aiRecord.aiRecordDetail.resultObject -> [response_text]
aiRecord.aiRecordDetail.searchContentList -> [source_urls]
aiRecord.metadata.credit -> cost in credits
aiRecord.conversationId -> for multi-turn conversations
```

---

## Chat Models (available via 1min.AI)

Typical chat models accessible through the chat endpoint:
- `gpt-4o-mini` — fast, cheap (default)
- `gpt-4o` — best quality
- `gpt-4.1` — latest
- `claude-3.5-sonnet` — alternative
- `claude-3.7-sonnet` — latest Claude

---

## Cache

Generated assets are cached at:
```
/opt/data/skills/1min-ai/cache/
```
Files are hashed by URL — repeated requests return cached files. Clear with:
```bash
rm -rf /opt/data/skills/1min-ai/cache/*
```

---

## References

- `references/api-reference.md` — Full API endpoint reference, parameter tables, model lists, and response format details for direct API calls.

## Pitfalls

- **Not OpenAI-compatible**: 1min.AI uses `API-KEY` header (not `Authorization: Bearer`)
- **temporaryUrl expiry**: Signed S3 URLs expire ~7 days. Download promptly if needed long-term.
- **Model IDs vary**: Some models use `owner/name` format (e.g., `black-forest-labs/flux-pro`)
- **Credit consumption**: Each API call consumes credits. Use `credit-check` to monitor.
- **Image URL format**: Use absolute URLs or Asset API keys for image inputs
- **Streaming**: Add `?isStreaming=true` for SSE streaming (more complex to parse)
- **Conversation**: For multi-turn chat, create a conversation first and pass `conversationId`
- **Aspect ratio vs width/height**: Use one or the other, not both
- **UNSUPPORTED_MODEL errors**: Many models listed by `list-models` are NOT available for the `IMAGE_GENERATOR` feature. Confirmed working: `flux-schnell`, `dall-e-3`, `gpt-image-1`. Confirmed BROKEN (UNSUPPORTED_MODEL): `flux-pro`, `flux-1.1-pro-ultra`, `flux-2-pro`, `flux-2-max`. Confirmed BROKEN (MISSING_REQUIRED_FIELDS — needs `size` and `quality` params not passed by wrapper): `dall-e-3`, `gpt-image-1`. **Always start with `flux-schnell` as a reliable fallback** and only try other models if quality demands it.
- **dall-e-3 and gpt-image-1 require extra fields**: These models need `size` and `quality` in the promptObject, which the `1minai.py` wrapper does not currently pass. Either patch the wrapper to include these fields, or avoid these models and use `flux-schnell` instead.
- **Generated image format**: `flux-schnell` outputs PNG. When uploading to WordPress or other CMS, use `Content-Type: image/png`.
- **Batch image generation**: When generating multiple images in a loop (e.g., 6+ for blog posts), add a 2-3 second delay between calls to avoid rate limits. Collect all local paths first, then batch-upload to the destination CMS.
- **Environment variable in subshells**: When running via `terminal()`, use `export ONEMIN_API_KEY=$(grep '^ONEMIN_API_KEY=' /opt/data/.env | cut -d= -f2-) && python3 ...` on a single line. The `source <(grep ...) | grep -v '^#')` form can fail with exit code 2 on some shells — use the `export + cut` pattern instead.
- **Web search for content research**: Use `chat "your question about local events/places" --web` for Perplexity-style web research. This returns real-time facts about businesses, events, and places — far more reliable than LLM knowledge alone for local SEO content. Combine with the wordpress skill's batch article creation workflow for generating factual, locally-accurate blog posts.

## Telegram Commands (oneminai_cmd.py)

A dedicated command handler for Telegram chat delivery. Located at `/opt/data/skills/1min-ai/scripts/oneminai_cmd.py`.

### Commands

| Command | Description | Output |
|---------|-------------|--------|
| `image <prompt>` | Generate image | `MEDIA:` path for Telegram |
| `search <query>` | Chat with web search | Text + sources |
| `tts <text>` | Text to speech | `MEDIA:` path for voice |
| `upscale <url>` | Upscale image | `MEDIA:` path |
| `remove-bg <url>` | Remove background | `MEDIA:` path |
| `replace-bg <url> --prompt` | Replace background | `MEDIA:` path |
| `remove-object <url> --prompt` | Remove object | `MEDIA:` path |
| `face-swap <src> <tgt>` | Swap faces | `MEDIA:` path |
| `img2prompt <url>` | Image to prompt | Text |
| `vary <url>` | Image variations | `MEDIA:` path |
| `credits` | Check credit balance | Text |
| `models` | List image models | Text |

### How to Generate and Deliver Media

When the user asks for an image, search, or TTS, load this skill and use the command handler:

```python
# Image generation → sends photo in Telegram
r = terminal("python3 /opt/data/skills/1min-ai/scripts/oneminai_cmd.py image 'sunset over mountains' --model flux-pro --aspect 16:9")
# Parse MEDIA: path from output and include in response

# Web search → sends text response with sources
r = terminal("python3 /opt/data/skills/1min-ai/scripts/oneminai_cmd.py search 'latest AI news'")

# TTS → sends voice message
r = terminal("python3 /opt/data/skills/1min-ai/scripts/oneminai_cmd.py tts 'Bonjour!' --voice alloy")
```
