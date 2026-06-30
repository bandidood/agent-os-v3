#!/usr/bin/env python3
"""1min.AI Telegram command handler.

Called by Hermes agent when user triggers a 1min.AI feature.
Outputs are designed for Telegram delivery (images via MEDIA:, voice via file path).

Usage:
  python3 oneminai_cmd.py image <prompt> [--model MODEL] [--aspect RATIO]
  python3 oneminai_cmd.py search <query>
  python3 oneminai_cmd.py tts <text> [--voice VOICE]
  python3 oneminai_cmd.py upscale <url>
  python3 oneminai_cmd.py remove-bg <url>
  python3 oneminai_cmd.py replace-bg <url> --prompt <desc>
  python3 oneminai_cmd.py remove-object <url> --prompt <desc>
  python3 oneminai_cmd.py face-swap <src_url> <tgt_url>
  python3 oneminai_cmd.py img2prompt <url>
  python3 oneminai_cmd.py credits
  python3 oneminai_cmd.py models
"""

import sys, os, json

# Add scripts dir to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))

# Import the wrapper
from importlib import import_module
oneminai = import_module('1minai')

def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return

    cmd = sys.argv[1]
    args = sys.argv[2:]

    # Parse flags
    flags = {}
    positional = []
    i = 0
    while i < len(args):
        if args[i].startswith("--"):
            key = args[i][2:].replace("-", "_")
            if i + 1 < len(args) and not args[i+1].startswith("--"):
                flags[key] = args[i+1]
                i += 2
            else:
                flags[key] = True
                i += 1
        else:
            positional.append(args[i])
            i += 1

    try:
        if cmd == "image":
            prompt = " ".join(positional) if positional else flags.get("prompt", "")
            if not prompt:
                print("❌ Prompt required. Usage: image <prompt> [--model flux-schnell] [--aspect 16:9]")
                return
            model = flags.get("model", "flux-schnell")
            aspect = flags.get("aspect", "1:1")
            local, url, credit, err = oneminai.generate_image(
                prompt, model=model, aspect_ratio=aspect
            )
            if err:
                print(f"❌ Error: {json.dumps(err, indent=2)[:500]}")
            else:
                print(f"✅ Image generated! Credit: {credit}")
                print(f"📁 MEDIA:{local}")
                print(f"🌐 {url[:100]}...")

        elif cmd == "search":
            query = " ".join(positional) if positional else flags.get("query", "")
            if not query:
                print("❌ Query required. Usage: search <query>")
                return
            model = flags.get("model", "gpt-4o-mini")
            text, sources, credit, conv_id = oneminai.chat(query, model=model, web_search=True)
            print(f"📝 {text}")
            if sources:
                print(f"\n📚 Sources:")
                for s in sources:
                    print(f"  • {s}")
            print(f"\n💳 Credit: {credit}")

        elif cmd == "tts":
            text = " ".join(positional) if positional else flags.get("text", "")
            if not text:
                print("❌ Text required. Usage: tts <text> [--voice alloy]")
                return
            voice = flags.get("voice", "alloy")
            local, credit, err = oneminai.tts(text, voice=voice)
            if err:
                print(f"❌ Error: {json.dumps(err, indent=2)[:300]}")
            else:
                print(f"✅ Audio generated! Credit: {credit}")
                print(f"🔊 MEDIA:{local}")

        elif cmd in ("upscale",):
            url = positional[0] if positional else ""
            if not url:
                print("❌ URL required")
                return
            scale = int(flags.get("scale", 2))
            local, img_url, credit, err = oneminai.upscale(url, scale)
            if err:
                print(f"❌ Upscale error: {json.dumps(err)[:300]}")
            else:
                print(f"✅ Upscaled! Credit: {credit}")
                print(f"📁 MEDIA:{local}")

        elif cmd in ("remove-bg", "rmbg"):
            url = positional[0] if positional else ""
            if not url:
                print("❌ URL required")
                return
            local, img_url, credit, err = oneminai.remove_bg(url)
            if err:
                print(f"❌ Error: {json.dumps(err)[:300]}")
            else:
                print(f"✅ Background removed! Credit: {credit}")
                print(f"📁 MEDIA:{local}")

        elif cmd in ("replace-bg", "repbg"):
            url = positional[0] if positional else ""
            prompt = flags.get("prompt", "")
            if not url or not prompt:
                print("❌ URL and --prompt required")
                return
            local, img_url, credit, err = oneminai.replace_bg(url, prompt)
            if err:
                print(f"❌ Error: {json.dumps(err)[:300]}")
            else:
                print(f"✅ Background replaced! Credit: {credit}")
                print(f"📁 MEDIA:{local}")

        elif cmd in ("remove-object", "rmobj"):
            url = positional[0] if positional else ""
            prompt = flags.get("prompt", "")
            if not url or not prompt:
                print("❌ URL and --prompt required")
                return
            local, img_url, credit, err = oneminai.remove_object(url, prompt)
            if err:
                print(f"❌ Error: {json.dumps(err)[:300]}")
            else:
                print(f"✅ Object removed! Credit: {credit}")
                print(f"📁 MEDIA:{local}")

        elif cmd == "face-swap":
            if len(positional) < 2:
                print("❌ Two URLs required: face-swap <source_url> <target_url>")
                return
            local, img_url, credit, err = oneminai.face_swap(positional[0], positional[1])
            if err:
                print(f"❌ Error: {json.dumps(err)[:300]}")
            else:
                print(f"✅ Face swapped! Credit: {credit}")
                print(f"📁 MEDIA:{local}")

        elif cmd in ("img2prompt", "image-to-prompt"):
            url = positional[0] if positional else ""
            if not url:
                print("❌ URL required")
                return
            local, img_url, credit, err = oneminai.image_to_prompt(url)
            if err:
                print(f"❌ Error: {json.dumps(err)[:300]}")
            else:
                print(f"✅ Prompt generated! Credit: {credit}")
                print(f"📁 MEDIA:{local}")

        elif cmd in ("credits", "balance"):
            info = oneminai.credit_check()
            print("💳 Credit Status:")
            for k, v in info.items():
                label = k.replace("_", " ").title()
                print(f"  • {label}: {v}")

        elif cmd == "models":
            print("🎨 Available Image Models:")
            for alias, mid in sorted(oneminai.IMAGE_MODELS.items()):
                print(f"  {alias:30s} → {mid}")

        elif cmd == "vary":
            url = positional[0] if positional else ""
            if not url:
                print("❌ URL required")
                return
            n = int(flags.get("n", 4))
            local, img_url, credit, err = oneminai.variator(url, n=n)
            if err:
                print(f"❌ Error: {json.dumps(err)[:300]}")
            else:
                print(f"✅ Variations generated! Credit: {credit}")
                print(f"📁 MEDIA:{local}")

        else:
            print(f"❌ Unknown command: {cmd}")
            print("Available: image, search, tts, vary, upscale, remove-bg, replace-bg, remove-object, face-swap, img2prompt, credits, models")

    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    main()