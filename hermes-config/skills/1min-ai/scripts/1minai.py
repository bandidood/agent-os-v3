#!/usr/bin/env python3
"""1min.AI API Wrapper — unified client for all features.

Usage:
  python3 1minai.py image "a cat" --model flux-schnell
  python3 1minai.py chat "weather in Paris" --web
  python3 1minai.py chat-stream "tell me a story" --model gpt-4o
  python3 1minai.py tts "Hello world" --voice shimmer -o hello.mp3
  python3 1minai.py asset-upload ~/photo.jpg
  python3 1minai.py img2img --image_url <url> --prompt "new style"
  python3 1minai.py upscale <url>
  python3 1minai.py remove-bg <url>
  python3 1minai.py credit-check

Environment: ONEMIN_API_KEY (required)
"""

import json, os, sys, time, hashlib, subprocess, re
from pathlib import Path
from urllib.parse import urlparse

# ── Config ────────────────────────────────────────────────────────────
BASE_URL = "https://api.1min.ai"
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def get_api_key():
    key = os.environ.get("ONEMIN_API_KEY", "")
    if not key:
        # Try .env
        env_path = Path("/opt/data/.env")
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("ONEMIN_API_KEY="):
                    key = line.split("=", 1)[1].strip()
                    break
    if not key:
        sys.stderr.write("ERROR: ONEMIN_API_KEY not found. Set in env or /opt/data/.env\n")
        sys.exit(1)
    return key

API_KEY = get_api_key()
HEADERS = {
    "Content-Type": "application/json",
    "API-KEY": API_KEY,
}

# ── Model Catalog ─────────────────────────────────────────────────────
IMAGE_MODELS = {
    # Best quality / premium
    "flux-pro": "black-forest-labs/flux-pro",
    "flux-1.1-pro-ultra": "flux-1.1-pro-ultra",
    "flux-2-pro": "flux-2-pro",
    "flux-2-max": "flux-2-max",
    "gpt-image-1": "gpt-image-1",
    "gemini-3-pro-image": "gemini-3-pro-image-preview",
    "grok-2-image": "grok-2-image",

    # Fast / cheap
    "flux-schnell": "black-forest-labs/flux-schnell",
    "flux-dev": "flux-dev",
    "flux-2-klein-4b": "flux-2-klein-4b",
    "flux-2-klein-9b": "flux-2-klein-9b",
    "gemini-2.5-flash-image": "gemini-2.5-flash-image",
    "gemini-3.1-flash-image": "gemini-3.1-flash-image-preview",

    # Mid-range
    "flux-2-dev": "flux-2-dev",
    "flux-2-flex": "flux-2-flex",
    "magic-art-7": "magic-art-7.0",
    "dall-e-3": "dall-e-3",
    "qwen-image": "qwen-image",
    "ideogram": "ideogram",
    "recraft": "recraft",
    "sd-xl": "stable-diffusion-xl-1.0",
    "stable-image-core": "stable-image-core",
    "stable-image-ultra": "stable-image-ultra",

    # Leonardo
    "leonardo-phoenix": "leonardo-phoenix",
    "leonardo-lightning": "leonardo-lightning-xl",
    "leonardo-anime": "leonardo-anime-xl",
    "leonardo-kino": "leonardo-kino-xl",
    "leonardo-diffusion": "leonardo-diffusion-xl",
    "leonardo-vision": "leonardo-vision-xl",
    "leonardo-albedo": "leonardo-albedo-base-xl",
}

def resolve_image_model(model_alias):
    """Resolve short alias to full model ID, or use raw value."""
    return IMAGE_MODELS.get(model_alias, model_alias)

# ── HTTP Client ───────────────────────────────────────────────────────
def api_call(endpoint, payload, timeout=120):
    """Generic POST to 1min.AI API."""
    url = f"{BASE_URL}{endpoint}"
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", url,
         "-H", f"Content-Type: application/json",
         "-H", f"API-KEY: {API_KEY}",
         "-d", json.dumps(payload)],
        capture_output=True, text=True, timeout=timeout
    )
    if result.returncode != 0:
        return {"error": f"curl failed: {result.stderr[:500]}"}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        return {"error": f"JSON parse error: {e}", "raw": result.stdout[:500]}

def extract_image_url(data):
    """Extract image URL from API response."""
    record = data.get("aiRecord", data)
    url = record.get("temporaryUrl", "")
    if url:
        return url
    # Try alternate paths
    for key in ["imageUrl", "url", "image", "result"]:
        val = record.get(key)
        if val and isinstance(val, str) and val.startswith("http"):
            return val
    return ""

def download_file(url, output_path=None):
    """Download a file and return local path."""
    if not output_path:
        ext = ".webp"
        if ".jpg" in url or ".jpeg" in url:
            ext = ".jpg"
        elif ".png" in url:
            ext = ".png"
        elif ".mp3" in url:
            ext = ".mp3"
        elif ".mp4" in url:
            ext = ".mp4"
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        output_path = str(CACHE_DIR / f"{url_hash}{ext}")

    result = subprocess.run(
        ["curl", "-sL", "-o", output_path, url],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        return None
    return output_path

# ── Feature: Image Generation ─────────────────────────────────────────
def generate_image(prompt, model="flux-schnell", aspect_ratio="1:1",
                   width=1024, height=1024, steps=25, guidance=None,
                   output_format="png", output_quality=90, seed=None):
    """Generate an image, download it, return (local_path, url, credit_used)."""
    model_id = resolve_image_model(model)
    prompt_obj = {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "width": width,
        "height": height,
        "output_format": output_format,
        "output_quality": output_quality,
        "steps": steps,
        "prompt_upsampling": True,
    }
    if guidance is not None:
        prompt_obj["guidance"] = guidance
    if seed is not None:
        prompt_obj["seed"] = seed

    payload = {
        "type": "IMAGE_GENERATOR",
        "model": model_id,
        "promptObject": prompt_obj,
    }

    data = api_call("/api/features", payload, timeout=120)
    url = extract_image_url(data)
    credit = data.get("aiRecord", {}).get("metadata", {}).get("credit", 0)

    if not url:
        return None, None, credit, data

    local_path = download_file(url)
    return local_path, url, credit, None

# ── Feature: Chat with Web Search ─────────────────────────────────────
def chat(prompt, model="gpt-4o-mini", web_search=False, n_sites=5,
         conversation_id=None, memories=False):
    """Chat with AI, optionally with web search. Returns response text + sources."""
    prompt_obj = {
        "prompt": prompt,
        "settings": {
            "webSearchSettings": {
                "webSearch": web_search,
                "numOfSite": n_sites,
                "maxWord": 2000,
            } if web_search else {},
            "historySettings": {
                "isMixed": False,
                "historyMessageLimit": 10,
            },
            "withMemories": memories,
        },
        "attachments": {"images": [], "files": []},
    }
    if conversation_id:
        prompt_obj["conversationId"] = conversation_id

    payload = {
        "type": "UNIFY_CHAT_WITH_AI",
        "model": model,
        "promptObject": prompt_obj,
    }

    data = api_call("/api/chat-with-ai", payload, timeout=180)
    record = data.get("aiRecord", data)
    detail = record.get("aiRecordDetail", {})
    result_obj = detail.get("resultObject", [])

    # Find response text
    response_text = ""
    if isinstance(result_obj, list) and result_obj:
        if isinstance(result_obj[0], str):
            response_text = result_obj[0]
        elif isinstance(result_obj[0], dict):
            response_text = result_obj[0].get("text", json.dumps(result_obj[0]))

    # Extract sources
    sources = detail.get("searchContentList", [])

    credit = record.get("metadata", {}).get("credit", 0)
    conv_id = record.get("conversationId", "")

    return response_text, sources, credit, conv_id

# ── Feature: Image Editing ────────────────────────────────────────────
def image_edit(type_name, image_url_or_path, model="magic-art",
               prompt=None, **kwargs):
    """Generic image editing (variator, upscaler, remove-bg, etc.)."""
    prompt_obj = {"imageUrl": image_url_or_path, **kwargs}
    if prompt:
        prompt_obj["prompt"] = prompt

    payload = {
        "type": type_name,
        "model": model,
        "promptObject": prompt_obj,
    }

    data = api_call("/api/features", payload, timeout=120)
    url = extract_image_url(data)
    credit = data.get("aiRecord", {}).get("metadata", {}).get("credit", 0)

    if url:
        local_path = download_file(url)
        return local_path, url, credit, None
    return None, None, credit, data

def variator(image_url, n=4, mode="fast"):
    return image_edit("IMAGE_VARIATOR", image_url, n=n, mode=mode)

def upscale(image_url, scale=2):
    return image_edit("IMAGE_UPSCALER", image_url, scale=scale)

def remove_bg(image_url):
    return image_edit("BACKGROUND_REMOVER", image_url)

def replace_bg(image_url, prompt):
    return image_edit("BACKGROUND_REPLACER", image_url, prompt=prompt)

def remove_object(image_url, prompt):
    return image_edit("OBJECT_REMOVER", image_url, prompt=prompt)

def remove_text(image_url):
    return image_edit("TEXT_REMOVER", image_url)

def face_swap(source_url, target_url):
    return image_edit("FACE_SWAPPER", source_url, targetImageUrl=target_url)

def image_to_prompt(image_url):
    return image_edit("IMAGE_TO_PROMPT", image_url)

# ── Feature: Text-to-Speech ───────────────────────────────────────────
def tts(text, model="openai", voice="alloy", output_path=None):
    """Generate speech from text. Returns local_path to audio file."""
    payload = {
        "type": "TEXT_TO_SPEECH",
        "model": model,
        "promptObject": {
            "prompt": text,
            "voice": voice,
        },
    }

    data = api_call("/api/features", payload, timeout=120)
    url = extract_image_url(data)
    credit = data.get("aiRecord", {}).get("metadata", {}).get("credit", 0)

    if not url:
        return None, credit, data

    if not output_path:
        text_hash = hashlib.md5(text.encode()).hexdigest()[:8]
        output_path = str(CACHE_DIR / f"tts_{text_hash}.mp3")

    local_path = download_file(url, output_path)
    return local_path, credit, None

# ── Feature: Asset Upload ─────────────────────────────────────────────
def upload_asset(file_path):
    """Upload a file to 1min.AI Asset API. Returns asset key."""
    if not os.path.exists(file_path):
        return None, "File not found"

    result = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{BASE_URL}/api/assets",
         "-H", f"API-KEY: {API_KEY}",
         "-F", f"file=@{file_path}"],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        return None, f"Upload failed: {result.stderr[:200]}"
    try:
        data = json.loads(result.stdout)
        key = data.get("key", data.get("assetKey", ""))
        return key, None
    except json.JSONDecodeError:
        return None, f"Unexpected response: {result.stdout[:200]}"

# ── Feature: Credit Check ─────────────────────────────────────────────
def credit_check():
    """Check remaining credits from the last API response pattern."""
    data = api_call("/api/features", {
        "type": "IMAGE_GENERATOR",
        "model": resolve_image_model("flux-schnell"),
        "promptObject": {"prompt": "test", "width": 256, "height": 256}
    }, timeout=60)

    record = data.get("aiRecord", {})
    team = record.get("teamUser", {})
    meta = record.get("metadata", {})

    return {
        "credit_limit": team.get("creditLimit", "N/A"),
        "used_credit": team.get("usedCredit", "N/A"),
        "remaining": max(0, (team.get("creditLimit", 0) or 0) - (team.get("usedCredit", 0) or 0)),
        "last_call_credit": meta.get("credit", 0),
        "team_name": team.get("userName", "N/A"),
    }

# ── CLI ───────────────────────────────────────────────────────────────
def print_help():
    print(__doc__)
    print("Commands:")
    print("  image <prompt>           Generate an image (--model, --aspect, --size)")
    print("  chat <message>           Chat with AI (--web for search, --model)")
    print("  tts <text>               Text to speech (--voice, -o)")
    print("  vary <url>               Create variations of an image")
    print("  upscale <url>            Upscale an image")
    print("  remove-bg <url>          Remove background")
    print("  replace-bg <url>         Replace background (--prompt)")
    print("  remove-object <url>      Remove object from image (--prompt)")
    print("  face-swap <src> <tgt>    Swap faces between images")
    print("  img2prompt <url>         Convert image to text prompt")
    print("  asset-upload <file>      Upload a file to Asset API")
    print("  credit-check             Check remaining credits")
    print("  list-models              List available models")

def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print_help()
        return

    cmd = sys.argv[1]
    args = sys.argv[2:]

    # Parse common flags
    def parse_flags(args_list):
        kwargs = {}
        i = 0
        while i < len(args_list):
            if args_list[i].startswith("--"):
                key = args_list[i][2:].replace("-", "_")
                if i + 1 < len(args_list) and not args_list[i+1].startswith("--"):
                    kwargs[key] = args_list[i+1]
                    i += 2
                else:
                    kwargs[key] = True
                    i += 1
            else:
                if "positional" not in kwargs:
                    kwargs["positional"] = []
                kwargs["positional"].append(args_list[i])
                i += 1
        return kwargs

    flags = parse_flags(args)

    try:
        if cmd == "image":
            prompt = flags.get("positional", [""])[0] if flags.get("positional") else ""
            if not prompt:
                print("ERROR: prompt required. Usage: image <prompt>")
                return
            model = flags.get("model", "flux-schnell")
            aspect = flags.get("aspect", flags.get("aspect_ratio", "1:1"))
            size = flags.get("size", "1024").split("x")
            w, h = int(size[0]), int(size[1]) if len(size) > 1 else int(size[0])
            steps = int(flags.get("steps", 25))

            print(f"🎨 Generating: \"{prompt[:60]}...\" [model={model}, {w}x{h}]")
            local, url, credit, err = generate_image(prompt, model, aspect, w, h, steps)
            if err:
                print(f"❌ Error: {json.dumps(err, indent=2)[:500]}")
                return
            print(f"✅ Done! Credit used: {credit}")
            print(f"📁 Local: {local}")
            print(f"🌐 URL: {url}")

        elif cmd == "chat":
            prompt = flags.get("positional", [""])[0] if flags.get("positional") else ""
            if not prompt:
                print("ERROR: message required. Usage: chat <message>")
                return
            model = flags.get("model", "gpt-4o-mini")
            web = flags.get("web", False)
            web = bool(web) if isinstance(web, bool) else web.lower() in ("true", "1", "yes")

            print(f"💬 Chat: \"{prompt[:60]}...\" [web_search={web}, model={model}]")
            text, sources, credit, conv_id = chat(prompt, model, web_search=web)
            print(f"\n📝 Response:\n{text}")
            if sources:
                print(f"\n📚 Sources ({len(sources)}):")
                for s in sources:
                    print(f"  • {s}")
            print(f"\n💳 Credit: {credit}")

        elif cmd == "tts":
            text = flags.get("positional", [""])[0] if flags.get("positional") else ""
            if not text:
                print("ERROR: text required. Usage: tts <text>")
                return
            voice = flags.get("voice", "alloy")
            output = flags.get("o", flags.get("output", "")) or None

            print(f"🔊 TTS: \"{text[:60]}...\" [voice={voice}]")
            local, credit, err = tts(text, voice=voice, output_path=output)
            if err:
                print(f"❌ Error: {json.dumps(err, indent=2)[:300]}")
                return
            print(f"✅ Done! Credit: {credit}")
            print(f"📁 File: {local}")
            print(f"🎵 Send with: MEDIA:{local}")

        elif cmd in ("vary", "variator"):
            url = flags.get("positional", [""])[0] if flags.get("positional") else ""
            if not url:
                print("ERROR: image URL required")
                return
            n = int(flags.get("n", 4))
            local, img_url, credit, err = variator(url, n=n)
            print(f"✅ Credit: {credit} | Local: {local} | URL: {img_url[:80]}...")

        elif cmd in ("upscale",):
            url = flags.get("positional", [""])[0] if flags.get("positional") else ""
            if not url:
                print("ERROR: image URL required")
                return
            scale = int(flags.get("scale", 2))
            local, img_url, credit, err = upscale(url, scale)
            print(f"✅ Credit: {credit} | Local: {local}")

        elif cmd in ("remove-bg", "remove_bg", "rmbg"):
            url = flags.get("positional", [""])[0] if flags.get("positional") else ""
            if not url:
                print("ERROR: image URL required")
                return
            local, img_url, credit, err = remove_bg(url)
            print(f"✅ Credit: {credit} | Local: {local}")

        elif cmd in ("replace-bg", "replace_bg", "repbg"):
            url = flags.get("positional", [""])[0] if flags.get("positional") else ""
            prompt = flags.get("prompt", "")
            if not url or not prompt:
                print("ERROR: image URL and --prompt required")
                return
            local, img_url, credit, err = replace_bg(url, prompt)
            print(f"✅ Credit: {credit} | Local: {local}")

        elif cmd in ("remove-object", "remove_object", "rmobj"):
            url = flags.get("positional", [""])[0] if flags.get("positional") else ""
            prompt = flags.get("prompt", "")
            if not url or not prompt:
                print("ERROR: image URL and --prompt required")
                return
            local, img_url, credit, err = remove_object(url, prompt)
            print(f"✅ Credit: {credit} | Local: {local}")

        elif cmd == "face-swap":
            args_list = flags.get("positional", [])
            if len(args_list) < 2:
                print("ERROR: face-swap <src_url> <target_url>")
                return
            local, img_url, credit, err = face_swap(args_list[0], args_list[1])
            print(f"✅ Credit: {credit} | Local: {local}")

        elif cmd in ("img2prompt", "image-to-prompt"):
            url = flags.get("positional", [""])[0] if flags.get("positional") else ""
            if not url:
                print("ERROR: image URL required")
                return
            local, img_url, credit, err = image_to_prompt(url)
            print(f"✅ Credit: {credit} | Local: {local}")

        elif cmd in ("asset-upload", "upload"):
            fpath = flags.get("positional", [""])[0] if flags.get("positional") else ""
            if not fpath:
                print("ERROR: file path required")
                return
            key, err = upload_asset(fpath)
            if err:
                print(f"❌ {err}")
            else:
                print(f"✅ Asset key: {key}")

        elif cmd in ("credit-check", "credits", "balance"):
            info = credit_check()
            print("💳 Credit Status:")
            for k, v in info.items():
                print(f"  • {k.replace('_', ' ').title()}: {v}")

        elif cmd == "list-models":
            print("🎨 Available Image Models (alias → ID):")
            for alias, mid in sorted(IMAGE_MODELS.items()):
                print(f"  {alias:30s} → {mid}")

        else:
            print(f"Unknown command: {cmd}")
            print_help()

    except subprocess.TimeoutExpired:
        print("❌ Timeout: API took too long to respond")
    except KeyboardInterrupt:
        print("\nCancelled.")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
