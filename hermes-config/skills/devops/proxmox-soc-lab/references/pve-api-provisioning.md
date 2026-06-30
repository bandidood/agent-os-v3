# PVE API Provisioning Commands

## Environment Variables (in /opt/data/.env)

```
PVE_API_TOKEN=hermes@pam!mcp-hermes=<token>
PVE_HOST=https://100.70.37.62:8006
PVE_NODE=Debian-trixie-latest-amd64-base
```

## Common Shell Setup

```bash
PVE_TOKEN="hermes@pam!mcp-hermes=<token>"
PVE_HOST="https://100.70.37.62:8006"
H="Authorization: PVEAPIToken=$PVE_TOKEN"
NODE="Debian-trixie-latest-amd64-base"
```

## Upload ISO

```bash
# Method 1: Direct URL download (when Proxmox DNS works)
curl -sk -H "$H" -X POST "$PVE_HOST/api2/json/nodes/$NODE/storage/local/download-url" \
  -d "content=iso" \
  -d "url=https://pkg.opnsense.org/releases/26.1/OPNsense-26.1.2-dvd-amd64.iso" \
  -d "filename=OPNsense-26.1.2-amd64.iso"

# Method 2: Upload from local (when Proxmox DNS is broken)
# Download locally first, then upload
curl -sk -H "$H" -X POST "$PVE_HOST/api2/json/nodes/$NODE/storage/local/upload" \
  -F "content=iso" \
  -F "filename=@/tmp/OPNsense-26.1.2-amd64.iso"

# NOTE: .bz2 extension is REJECTED for content=iso. Decompress first.
# NOTE: OPNsense URL changed: pkg.opnsense.org (not mirror.opnsense.org)
```

## Upload LXC Template

```bash
# Proxmox DNS often fails. Download locally then upload.
# Check available versions: http://download.proxmox.com/images/system/
# Current Debian 12: debian-12-standard_12.12-1_amd64.tar.zst

# Download locally
curl -L "http://download.proxmox.com/images/system/debian-12-standard_12.12-1_amd64.tar.zst" \
  -o /tmp/debian-12-standard_12.12-1_amd64.tar.zst

# Upload to Proxmox
curl -sk -H "$H" -X POST "$PVE_HOST/api2/json/nodes/$NODE/storage/local/upload" \
  -F "content=vztmpl" \
  -F "filename=@/tmp/debian-12-standard_12.12-1_amd64.tar.zst"
```

## Create QEMU VM (OPNsense Example — VMID 300)

**Use seabios from the start** — OVMF causes boot hangs with OPNsense (see Pitfalls).

```bash
# One-step creation with seabios (no efidisk needed)
curl -sk -H "$H" -X POST "$PVE_HOST/api2/json/nodes/$NODE/qemu" \
  --data-urlencode "vmid=300" \
  --data-urlencode "name=OPNsense" \
  --data-urlencode "machine=q35" \
  --data-urlencode "bios=seabios" \
  --data-urlencode "cores=2" \
  --data-urlencode "memory=2048" \
  --data-urlencode "net0=virtio,bridge=vmbr0" \
  --data-urlencode "net1=virtio,bridge=vmbr3" \
  --data-urlencode "scsihw=virtio-scsi-pci" \
  --data-urlencode "ostype=l26" \
  --data-urlencode "scsi0=local:20,format=qcow2" \
  --data-urlencode "ide2=local:iso/OPNsense-26.1.2-amd64.iso,media=cdrom" \
  --data-urlencode "boot=cdn" \
  --data-urlencode "onboot=1"
```

**IMPORTANT**: Always use `--data-urlencode` for VM/LXC creation params! Using `-d` causes "duplicate key" errors on comma-separated values like `net0=virtio,bridge=vmbr0`.

**Verify install**: After OPNsense installation completes, before removing ISO, boot into live mode and run `gpart show da0` — it must show partitions. If empty (`da0` shows nothing), the install failed silently — reinstall before rebooting.

## Create LXC Container (Bastion Example — VMID 308)

```bash
curl -sk -H "$H" -X POST "$PVE_HOST/api2/json/nodes/$NODE/lxc" \
  --data-urlencode "vmid=308" \
  --data-urlencode "hostname=bastion" \
  --data-urlencode "password=Bastion2026!" \
  --data-urlencode "ostemplate=local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst" \
  --data-urlencode "cores=2" \
  --data-urlencode "memory=2048" \
  --data-urlencode "swap=512" \
  --data-urlencode "rootfs=local:20" \
  --data-urlencode "net0=name=eth0,bridge=vmbr3,tag=10,ip=dhcp" \
  --data-urlencode "unprivileged=1" \
  --data-urlencode "onboot=1" \
  --data-urlencode "features=nesting=1"
```

**Note**: `ssh=1` is NOT a valid LXC creation param. Install SSH inside after boot.

## VNC Console Automation (sendkey + OCR)

When QEMU guest agent is unavailable (e.g., OPNsense install, no OS yet), use the sendkey API to send keystrokes to the VM console.

```bash
# Send keystrokes to VM console — use PUT (not POST, which returns "not implemented")
H="Authorization: PVEAPIToken=$PVE_TOKEN"

# Single key presses
curl -sk -H "$H" -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/300/sendkey" -d "key=ret"     # Enter
curl -sk -H "$H" -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/300/sendkey" -d "key=1"         # Number 1
curl -sk -H "$H" -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/300/sendkey" -d "key=tab"       # Tab
curl -sk -H "$H" -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/300/sendkey" -d "key=esc"        # Escape
curl -sk -H "$H" -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/300/sendkey" -d "key=y"          # y
curl -sk -H "$H" -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/300/sendkey" -d "key=shift-1"     # ! (shift+1)

# Combine with sleep for interactive sequences
sleep 1  # wait for screen response between keystrokes
```

### RapidOCR for Screenshot Analysis

When you can't see the VNC console directly, use RapidOCR to analyze screenshots the user sends:

```bash
# Setup (one-time)
uv venv /tmp/ocr-env --clear && source /tmp/ocr-env/bin/activate
uv pip install rapidocr-onnxruntime Pillow
```

```python
# Usage
import sys
sys.path.insert(0, "/tmp/ocr-env/lib/python3.13/site-packages/")
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()
result, elapse = ocr("/path/to/screenshot.jpg")
if result:
    for line in result:
        confidence = line[2]
        text = line[1]
        print(f"  [{confidence:.0f}%] {text}")
```

⚠️ The Hermes model (glm-5.1) does NOT support vision/image input. Use RapidOCR as a workaround to read VNC console screenshots.

## Check Task Status

```bash
# UPID format from API responses
UPID="UPID:Debian-trixie-latest-amd64-base:XXXXXXXX:YYYYYYYY:ZZZZZZZZ:tasktype:taskid:user@realm:"
curl -sk -H "$H" "$PVE_HOST/api2/json/nodes/$NODE/tasks/$UPID/status"
```

## Network Config Backup (Safety Procedure)

```bash
# API-based backup (no SSH needed)
curl -sk -H "$H" "$PVE_HOST/api2/json/nodes/$NODE/network" \
  -o /opt/data/soc-lab/network-backup-$(date +%Y%m%d).json
```

## Common API Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| `duplicate key in comma-separated list` | Using `-d` form encoding | Use `--data-urlencode` |
| `property not defined: trunk` | QEMU NICs don't have `trunk` param | Just attach to vmbr3, OPNsense tags internally |
| `property not defined: ssh` | LXC API doesn't have `ssh` param | Remove it, install SSH inside |
| `wrong file extension` for .bz2 | PVE rejects .bz2 for `content=iso` | Decompress locally, upload .iso |
| DNS failure on Proxmox | `download-url` can't resolve mirrors | Download locally, upload via `/upload` |
| Token 401 | Token was from crashed server | Token is fine — was server-side issue |