---
name: 1min-ai
description: "1min.AI API integration: image generation, chat, audio, video, writing, code, and asset management via the 1min.AI platform API."
version: 0.1.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [1min-ai, image-generation, ai-api, flux, dalle, tts, video-generation]
    homepage: https://docs.1min.ai/docs/api/intro
---

# 1min.AI API

1min.AI is a multi-modal AI platform offering a proprietary REST API for image generation, chat, audio, video, writing, and code generation.

## ⚠️ Key Pitfall: NOT OpenAI-Compatible

1min.AI uses its own API format — it is **NOT** a drop-in replacement for the OpenAI API. Do NOT configure it as an OpenAI provider in Hermes config. It requires dedicated calling via `curl` or terminal commands.

Auth header: `API-KEY: <key>` (not `Authorization: Bearer`).

## Authentication

All requests require header `API-KEY: <api-key>`. The key should be stored in the Hermes `.env` file as `ONEMIN_API_KEY`.

## Base URL

```
https://api.1min.ai
```

## Feature Endpoints

### Chat with AI
- **POST** `/api/chat-with-ai` (non-streaming)
- **POST** `/api/chat-with-ai?isStreaming=true` (streaming)
- Type: `UNIFY_CHAT_WITH_AI`
- Supports: conversation history, web search, image/file attachments, brand voice, memory

### AI Feature API (all non-chat features)
- **POST** `/api/features` (non-streaming)
- **POST** `/api/features?isStreaming=true` (streaming)
- All non-chat features use this single endpoint with different `type` values

### Conversations
- **POST** `/api/conversations` — create a conversation for multi-turn chat
- Type: `UNIFY_CHAT_WITH_AI`, requires `title` and `model`

### Asset API
- **POST** `/api/features` with asset-related types for file upload/management

## Request Format

All Feature API calls:

```bash
curl -X POST https://api.1min.ai/api/features \
  -H "API-KEY: $ONEMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "<FEATURE_TYPE>",
    "model": "<MODEL_ID>",
    "promptObject": {
      "prompt": "description here",
      ...feature-specific params
    }
  }'
```

Chat API calls:

```bash
curl -X POST "https://api.1min.ai/api/chat-with-ai" \
  -H "API-KEY: $ONEMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "UNIFY_CHAT_WITH_AI",
    "model": "<MODEL_ID>",
    "promptObject": {
      "prompt": "your message",
      "conversationId": "<uuid-or-omit>",
      "settings": {
        "webSearchSettings": {"webSearch": false},
        "historySettings": {"isMixed": false, "historyMessageLimit": 10}
      }
    }
  }'
```

## Feature Types & Models

### Image Generation (`IMAGE_GENERATOR`)

**Models:** `black-forest-labs/flux-pro`, `black-forest-labs/flux-dev`, `black-forest-labs/flux-schnell`, `flux-pro-1.1`, `flux-1.1-pro-ultra`, `flux-2-pro`, `flux-2-dev`, `flux-2-flex`, `flux-2-max`, `flux-2-klein-4b`, `flux-2-klein-9b`, `magic-art-5.2`, `magic-art-6.1`, `magic-art-7.0`, `gpt-image-1`, `gpt-image-1-mini`, `dall-e-3`, `dall-e-2`, `ideogram`, `stable-diffusion-xl-1.0`, `stable-image-core`, `stable-image-ultra`, `leonardo-phoenix`, `leonardo-lightning-xl`, `leonardo-anime-xl`, `leonardo-diffusion-xl`, `leonardo-kino-xl`, `leonardo-vision-xl`, `leonardo-albedo-base-xl`, `recraft`, `gemini-2.5-flash`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`, `grok-2-image`, `qwen-image`

**promptObject params:** `prompt` (required), `width` (256-1440, mult 32, default 1024), `height` (same), `aspect_ratio` (1:1, 16:9, 9:16, 3:2, 2:3, 4:5, 5:4, custom), `steps` (1-50, default 25), `guidance` (0-50, default 3.5), `output_format` (webp/jpg/png), `output_quality` (0-100, default 80), `seed` (0-4294967295), `prompt_upsampling` (bool), `safety_tolerance` (1-5), `image_prompt` (path for img2img from Asset API)

### Image Variation (`IMAGE_VARIATOR`)
- promptObject: `imageUrl`, `mode` (fast/quality), `n` (variants), `aspect_width`, `aspect_height`, `maintainModeration`

### Other Image Feature Types
`IMAGE_UPSCALER`, `BACKGROUND_REMOVER`, `BACKGROUND_REPLACER`, `TEXT_REMOVER`, `OBJECT_REMOVER`, `IMAGE_TO_PROMPT`, `SEARCH_AND_REPLACE`, `IMAGE_MASK_EDITOR`, `FACE_SWAPPER`, `IMAGE_EXTENDER`, `TEXT_EDITOR`, `SKETCH_TO_IMAGE`, `3D_IMAGE_GENERATOR`

### Audio
- Text-to-Speech models via dedicated endpoints

### Video
- Text-to-video generation features

### Writing
- Content generation features

### Code
- Code generation features

## Generating an Image (Step-by-Step)

1. Verify `ONEMIN_API_KEY` is set: `echo $ONEMIN_API_KEY`
2. Call the API:

```bash
curl -s -X POST https://api.1min.ai/api/features \
  -H "API-KEY: $ONEMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "IMAGE_GENERATOR",
    "model": "black-forest-labs/flux-pro",
    "promptObject": {
      "prompt": "A sunset over mountains, photorealistic",
      "width": 1024,
      "height": 1024,
      "output_format": "png",
      "output_quality": 90
    }
  }' -o /tmp/1min_result.json
```

3. Parse response JSON — extract image URL from `aiRecord` fields
4. Download image from returned URL

## Response Format

Non-streaming returns JSON with `aiRecord` containing UUID, user/team info, and generated asset data (URLs, keys). See `references/api-reference.md` for field details.

## See Also

- `references/api-reference.md` — full API endpoint reference and model lists
- Full docs: https://docs.1min.ai/docs/api/intro