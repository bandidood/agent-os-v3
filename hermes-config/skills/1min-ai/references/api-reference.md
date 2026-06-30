# 1min.AI API Reference

## Authentication

- Header: `API-KEY: <your-api-key>`
- Content-Type: `application/json`
- Base URL: `https://api.1min.ai`

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat-with-ai` | POST | Chat (non-streaming) |
| `/api/chat-with-ai?isStreaming=true` | POST | Chat (streaming) |
| `/api/features` | POST | All non-chat features (non-streaming) |
| `/api/features?isStreaming=true` | POST | All non-chat features (streaming) |
| `/api/conversations` | POST | Create conversation for history |

## Chat API

### Create Conversation
```json
{
  "type": "UNIFY_CHAT_WITH_AI",
  "title": "My Conversation",
  "model": "gpt-4o-mini"
}
```

### Send Message
```json
{
  "type": "UNIFY_CHAT_WITH_AI",
  "model": "gpt-4o-mini",
  "promptObject": {
    "prompt": "Hello!",
    "conversationId": "uuid-from-create",
    "settings": {
      "webSearchSettings": {
        "webSearch": true,
        "numOfSite": 3,
        "maxWord": 1000
      },
      "historySettings": {
        "isMixed": false,
        "historyMessageLimit": 10
      }
    },
    "attachments": {
      "images": [],
      "files": []
    }
  },
  "brandVoiceId": "",
  "metadata": {}
}
```

## Image Generator Models

| Model ID | Provider | Notes |
|----------|----------|-------|
| `magic-art-5.2` | 1min.AI | Magic Art 5.2 |
| `magic-art-6.1` | 1min.AI | Magic Art 6.1 |
| `magic-art-7.0` | 1min.AI | Magic Art 7.0 |
| `gpt-image-1` | OpenAI | GPT Image 1 |
| `gpt-image-1-mini` | OpenAI | GPT Image 1 Mini |
| `dall-e-3` | OpenAI | DALL-E 3 |
| `dall-e-2` | OpenAI | DALL-E 2 |
| `dzine` | Dzine | Dzine AI |
| `ideogram` | Ideogram | Ideogram 3.0 |
| `leonardo-phoenix` | Leonardo | Phoenix |
| `leonardo-lightning-xl` | Leonardo | Lightning XL |
| `leonardo-anime-xl` | Leonardo | Anime XL |
| `leonardo-diffusion-xl` | Leonardo | Diffusion XL |
| `leonardo-kino-xl` | Leonardo | Kino XL |
| `leonardo-vision-xl` | Leonardo | Vision XL |
| `leonardo-albedo-base-xl` | Leonardo | AlbedoBase XL |
| `stable-diffusion-xl-1.0` | Stability | SD XL 1.0 |
| `stable-image-core` | Stability | Stable Core |
| `stable-image-ultra` | Stability | Stable Ultra |
| `black-forest-labs/flux-pro` | BFL | Flux Pro |
| `black-forest-labs/flux-dev` | BFL | Flux Dev |
| `black-forest-labs/flux-schnell` | BFL | Flux Schnell |
| `flux-pro-1.1` | BFL | Flux Pro 1.1 |
| `flux-1.1-pro-ultra` | BFL | Flux 1.1 Pro Ultra |
| `flux-2-pro` | BFL | Flux 2 Pro |
| `flux-2-dev` | BFL | Flux 2 Dev |
| `flux-2-flex` | BFL | Flux 2 Flex |
| `flux-2-max` | BFL | Flux 2 Max |
| `flux-2-klein-4b` | BFL | Flux 2 Klein 4B |
| `flux-2-klein-9b` | BFL | Flux 2 Klein 9B |
| `gemini-2.5-flash` | Google | Gemini 2.5 Flash |
| `gemini-3-pro-image-preview` | Google | Gemini 3 Pro |
| `gemini-3.1-flash-image-preview` | Google | Gemini 3.1 Flash |
| `grok-2-image` | xAI | Grok-2 Image |
| `qwen-image` | Alibaba | Qwen Image |
| `recraft` | Recraft | Recraft V3 |

## Image Generator promptObject Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Text description |
| `image_prompt` | string | No | - | Path from Asset API for img2img |
| `aspect_ratio` | string | No | 1:1 | 1:1, 16:9, 9:16, 3:2, 2:3, 4:5, 5:4, custom |
| `width` | number | No | 1024 | 256-1440, multiple of 32 |
| `height` | number | No | 1024 | 256-1440, multiple of 32 |
| `steps` | number | No | 25 | 1-50, inference steps |
| `guidance` | number | No | 3.5 | 0-50, prompt adherence |
| `interval` | number | No | - | Processing interval |
| `prompt_upsampling` | bool | No | false | Enhance prompt |
| `seed` | number | No | random | 0-4294967295 |
| `output_format` | string | No | webp | webp, jpg, png |
| `output_quality` | number | No | 80 | 0-100 |
| `safety_tolerance` | number | No | 2 | 1-5 (1=strict, 5=permissive) |

## Image Variator promptObject Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `imageUrl` | string | Yes | - | URL or Asset API key |
| `mode` | string | No | fast | fast or quality |
| `n` | number | No | 4 | Number of variations |
| `aspect_width` | number | No | 1 | Ratio width |
| `aspect_height` | number | No | 1 | Ratio height |
| `maintainModeration` | bool | No | true | Apply content moderation |

## Other Image Feature Types

| Type | Description |
|------|-------------|
| `IMAGE_UPSCALER` | Upscale image resolution |
| `BACKGROUND_REMOVER` | Remove background |
| `BACKGROUND_REPLACER` | Replace background |
| `TEXT_REMOVER` | Remove text from image |
| `OBJECT_REMOVER` | Remove objects from image |
| `IMAGE_TO_PROMPT` | Convert image to text prompt |
| `SEARCH_AND_REPLACE` | Search and replace in image |
| `IMAGE_MASK_EDITOR` | Mask-based editing |
| `FACE_SWAPPER` | Swap faces in image |
| `IMAGE_EXTENDER` | Extend image boundaries |
| `TEXT_EDITOR` | Edit/add text in image |
| `SKETCH_TO_IMAGE` | Convert sketch to image |
| `3D_IMAGE_GENERATOR` | Generate 3D images |

## Response Format

```json
{
  "aiRecord": {
    "uuid": "...",
    "userId": "...",
    "teamId": "...",
    "teamUser": { ... },
    // Generated assets, URLs, metadata
  }
}
```

## Rate Limits & Credits

- See https://docs.1min.ai/docs/api/specifications/rate-limits
- See https://docs.1min.ai/docs/api/specifications/credits-limits