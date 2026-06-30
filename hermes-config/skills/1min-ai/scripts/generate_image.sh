#!/usr/bin/env bash
# 1min.AI Image Generator — generates an image, downloads it, prints local path
# Usage: bash generate_image.sh "prompt text" [model] [width] [height] [format]
# Example: bash generate_image.sh "a cute cat" "black-forest-labs/flux-schnell" 1024 1024 png
set -euo pipefail

PROMPT="${1:?Usage: generate_image.sh PROMPT [MODEL] [WIDTH] [HEIGHT] [FORMAT]}"
MODEL="${2:-black-forest-labs/flux-schnell}"
WIDTH="${3:-1024}"
HEIGHT="${4:-1024}"
FORMAT="${5:-png}"
OUTDIR="${6:-/tmp}"

# Source API key
API_KEY=$(grep ONEMIN_API_KEY /opt/data/.env | grep -v '^#' | cut -d= -f2 | tr -d '[:space:]')
if [ -z "$API_KEY" ]; then
  echo "ERROR: ONEMIN_API_KEY not found in /opt/data/.env" >&2
  exit 1
fi

# Generate image
RESPONSE=$(curl -s -X POST 'https://api.1min.ai/api/features' \
  -H 'Content-Type: application/json' \
  -H "API-KEY: $API_KEY" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'type': 'IMAGE_GENERATOR',
    'model': '$MODEL',
    'promptObject': {
        'prompt': '''$PROMPT''',
        'width': $WIDTH,
        'height': $HEIGHT,
        'output_format': '$FORMAT',
        'output_quality': 90
    }
}))
")")

# Extract URL
URL=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['aiRecord']['temporaryUrl'])")

if [ -z "$URL" ]; then
  echo "ERROR: No temporaryUrl in response" >&2
  echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2))" >&2
  exit 1
fi

# Download
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTFILE="${OUTDIR}/1min_${TIMESTAMP}.${FORMAT}"
curl -sL "$URL" -o "$OUTFILE"

SIZE=$(stat -f%z "$OUTFILE" 2>/dev/null || stat -c%s "$OUTFILE" 2>/dev/null)
echo "OK: $OUTFILE ($(( SIZE / 1024 )) KB)"
echo "URL: $URL"