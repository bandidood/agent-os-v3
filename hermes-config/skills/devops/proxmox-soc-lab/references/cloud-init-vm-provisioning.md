# Cloud-Init VM Provisioning on Proxmox

## Quick Reference: Clone-based Provisioning

### 1. Destroy existing VM (if recreating)

```bash
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X DELETE "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID"
```

### 2. Clone from template 9000

```bash
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X POST "$PVE_HOST/api2/json/nodes/$NODE/qemu/9000/clone" \
  --data-urlencode "newid=$VMID" \
  --data-urlencode "name=$NAME" \
  --data-urlencode "full=1" \
  --data-urlencode "target=$NODE"
```

### 3. Resize disk (e.g., 60G)

```bash
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/resize" \
  --data-urlencode "disk=scsi0" \
  --data-urlencode "size=60G"
```

### 4. Update config (CPU, RAM, network, cloud-init)

```bash
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/config" \
  --data-urlencode "cores=4" \
  --data-urlencode "memory=4096" \
  --data-urlencode "net0=virtio,bridge=vmbr3,tag=50" \
  --data-urlencode "onboot=1" \
  --data-urlencode "ostype=l26" \
  --data-urlencode "scsihw=virtio-scsi-pci" \
  --data-urlencode "boot=order=scsi0" \
  --data-urlencode "agent=1" \
  --data-urlencode "ciuser=root" \
  --data-urlencode "cipassword=YOUR_PASSWORD_HERE" \
  --data-urlencode "ipconfig0=ip=10.10.50.105/24,gw=10.10.50.1" \
  --data-urlencode "nameserver=10.10.10.1 8.8.8.8" \
  --data-urlencode "searchdomain=soc.lab"
```

**⚠️ CRITICAL: Template 9000 does NOT set `scsihw`** — always add `scsihw=virtio-scsi-pci` when cloning. Without it, the cloud-init disk may not be detected by the guest, causing silent cloud-init failure (no network, no SSH keys, VM unreachable).

**⚠️ `sshkeys` parameter works with URL-encoding** — use `--data-urlencode "sshkeys=ssh-ed25519%20AAAA...%2Fuse%40host%0A"` (note the trailing `%0A`). Verify with `GET /config` after setting.

**⚠️ PVE cloud-init disk sets `PasswordAuthentication no`** — SSH in with key first, then enable PwAuth.

### 5. Start VM and post-boot configuration

```bash
# Start
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X POST "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/status/start"
```

## NoCloud ISO Method (RECOMMENDED for SSH access)

The PVE cloud-init disk (ide2) forces `PasswordAuthentication no` in sshd_config and cannot be overridden by PVE cloud-init params alone. The **only reliable method** is to create a NoCloud ISO that provides all cloud-init data (users, SSH, network) and remove the PVE cloudinit disk entirely.

### Why NoCloud ISO is needed

- PVE `cipassword` sets the password hash but does NOT enable `PasswordAuthentication yes`
- PVE cloud-init disk always writes `PasswordAuthentication no` to `/etc/ssh/sshd_config.d/50-cloud-init.conf`
- When both PVE cloudinit (ide2) and NoCloud (ide1) are present, cloud-init uses **ConfigDrive** (PVE) and **ignores NoCloud**
- QEMU guest agent `set-user-password` requires the agent to already be installed and running — chicken-and-egg

### NoCloud ISO creation script (run on a machine with `genisoimage`)

```bash
# On VM 305 (or any machine with genisoimage/mkisofs)
VM_HOSTNAME="soc-suricata"
VM_IP="192.168.200.115"
VM_GW="192.168.200.1"
SSH_PUBKEY="ssh-ed25519 AAAA... user@host"  # Your SSH public key

DIR="/tmp/ci-${VM_HOSTNAME}"
mkdir -p "$DIR"

# meta-data (instance-id MUST change between re-provisions for cloud-init to re-run)
cat > "$DIR/meta-data" << EOF
instance-id: ${VM_HOSTNAME}-v3
local-hostname: ${VM_HOSTNAME}
EOF

# user-data (cloud-config format — MUST start with #cloud-config)
cat > "$DIR/user-data" << EOF
#cloud-config
ssh_pwauth: true
disable_root: false
chpasswd:
  expire: false
  list:
    - root:SOClab2026!
ssh_authorized_keys:
  - ${SSH_PUBKEY}
write_files:
  - path: /etc/ssh/sshd_config.d/99-enable-password.conf
    content: |
      PasswordAuthentication yes
      PermitRootLogin yes
    owner: root:root
    permissions: '0644'
runcmd:
  - sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
  - sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
  - sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
  - systemctl restart sshd
  - apt-get update -qq
  - apt-get install -y -qq qemu-guest-agent
  - systemctl enable qemu-guest-agent
  - systemctl start qemu-guest-agent
EOF

# network-config (v1 format — most compatible with NoCloud)
cat > "$DIR/network-config" << EOF
version: 1
config:
  - type: physical
    name: ens18
    subnets:
      - type: static
        address: ${VM_IP}/24
        gateway: ${VM_GW}
        dns_nameservers:
          - 8.8.8.8
          - 8.8.4.4
EOF

# Create ISO (volid MUST be exactly "cidata", files at root level)
genisoimage -output "/tmp/ci-${VM_HOSTNAME}.iso" \
  -volid cidata -joliet -rock \
  "$DIR/meta-data" "$DIR/user-data" "$DIR/network-config"
```

### Attaching the NoCloud ISO and removing PVE cloudinit disk

```bash
# Stop VM, attach NoCloud ISO as ide1, REMOVE ide2 (PVE cloudinit disk)
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/config" \
  --data-urlencode "ide1=local:iso/ci-${VM_HOSTNAME}.iso,media=cdrom" \
  --data-urlencode "delete=ide2" \
  --data-urlencode "ciuser=root" \
  --data-urlencode "ipconfig0=ip=${VM_IP}/24,gw=${VM_GW}"

# Start VM — cloud-init will use NoCloud datasource (only one present)
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X POST "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/status/start"
```

### NoCloud ISO checklist

- [ ] Volume label = `cidata` (exact match, case-sensitive)
- [ ] Files at root level (NOT under `openstack/latest/`)
- [ ] Filenames: `meta-data`, `user-data`, `network-config` (hyphens, not underscores)
- [ ] `user-data` starts with `#cloud-config`
- [ ] `instance-id` in meta-data is unique per provision (change if re-provisioning)
- [ ] `network-config` uses v1 format (v2 `ethernets:` format may not work with NoCloud)
- [ ] `ide2` (PVE cloudinit disk) is DELETED — only ide1 (NoCloud ISO) remains
- [ ] `ipconfig0` param kept (PVE still needs it for networking metadata, but it only applies through ide2)

### SSH from Hermes without sshpass

```python
import os, stat
askpass = "/tmp/sshpass-askpass.sh"
with open(askpass, "w") as f:
    f.write("#!/bin/sh\necho 'PASSWORD'\n")
os.chmod(askpass, stat.S_IRWXU)

env = os.environ.copy()
env["SSH_ASKPASS"] = askpass
env["SSH_ASKPASS_REQUIRE"] = "force"
env["DISPLAY"] = ":0"

import subprocess
result = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null", "root@HOST", "cmd"],
    env=env, capture_output=True, text=True, timeout=15)
```

## CPU Type for Suricata/libhyperscan

Default `kvm64` CPU type lacks SSSE3 instructions. This causes:
- `libhyperscan5` install fails: "Aborting installation because of missing SSSE3 extension"
- `suricata --build-info` segfaults: `libhs.so.5: cannot open shared object file`

**Fix**: Set `cpu=cputype=host` on VM config BEFORE installing suricata:
```bash
# Stop VM first
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X POST "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/status/stop"

# Set CPU type to host (passes host CPU features including SSSE3)
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/config" \
  --data-urlencode "cpu=cputype=host"

# Start VM
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X POST "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/status/start"
```

## Bypass Network Config (temporary vmbr1)

When OPNsense VLANs aren't ready, use vmbr1 as bypass:
- Bridge: `vmbr1` (no VLAN tag — flat L2 network)
- IP: `192.168.200.x/24` (any available in the 200 range)
- Gateway: `192.168.200.1` (PVE host vmbr1 IP)
- This provides internet access for package installation

To switch to production VLAN later:
```bash
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/config" \
  --data-urlencode "net0=virtio,bridge=vmbr3,tag=50"
  # Also update ipconfig0 to match VLAN subnet
```

## Creating NoCloud ISO without genisoimage (from Hermes container)

When `genisoimage`/`mkisofs`/`xorriso` are not available (e.g., inside a container), use `pycdlib-genisoimage` (pre-installed in Hermes venv at `/opt/hermes/.venv/bin/pycdlib-genisoimage`):

```bash
# Create cloud-init files first (see above sections)
mkdir -p /tmp/cidata
cat > /tmp/cidata/meta-data << 'EOF'
instance-id: soc-dmz-v1
local-hostname: soc-dmz
EOF

cat > /tmp/cidata/user-data << 'EOF'
#cloud-config
ssh_pwauth: true
disable_root: false
chpasswd:
  expire: false
  list:
    - root:SOClab2026!
ssh_authorized_keys:
  - ssh-ed25519 AAAA... user@host
write_files:
  - path: /etc/ssh/sshd_config.d/99-enable-password.conf
    content: |
      PasswordAuthentication yes
      PermitRootLogin yes
    owner: root:root
    permissions: '0644'
runcmd:
  - sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
  - sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
  - systemctl restart sshd
  - apt-get update -qq && apt-get install -y -qq qemu-guest-agent
  - systemctl enable --now qemu-guest-agent
EOF

cat > /tmp/cidata/network-config << 'EOF'
version: 1
config:
  - type: physical
    name: ens18
    subnets:
      - type: static
        address: 192.168.200.117/24
        gateway: 192.168.200.1
        dns_nameservers:
          - 8.8.8.8
          - 8.8.4.4
EOF

# Create ISO using pycdlib-genisoimage (available in Hermes venv)
/opt/hermes/.venv/bin/pycdlib-genisoimage \
  -o /tmp/ci-dmz.iso -V cidata -J -r \
  /tmp/cidata/meta-data /tmp/cidata/user-data /tmp/cidata/network-config
```

**⚠️ Getting the ISO onto PVE is the hard part.** Three methods, in order of reliability:

### Method 1: SSH to PVE host (RECOMMENDED)

If you have SSH access to the PVE host, create the ISO directly:

```bash
# On Hermes: copy the cloud-init files to PVE host via SSH
scp /tmp/cidata/* root@100.70.37.62:/tmp/cidata/
ssh root@100.70.37.62 'mkdir -p /tmp/cidata && genisoimage -output /var/lib/vz/template/iso/ci-dmz.iso -V cidata -J -r /tmp/cidata/meta-data /tmp/cidata/user-data /tmp/cidata/network-config'
```

### Method 2: PVE upload API (requires password auth, NOT API tokens)

`POST /storage/local/upload -F content=iso -F filename=@file.iso` returns HTTP 400 with API tokens because the upload endpoint requires a CSRFPreventionToken cookie. Works with username/password auth only.

### Method 3: PVE download-url (requires external URL)

`POST /nodes/{node}/storage/local/download-url` can fetch ISOs from public URLs. **Does NOT work with Docker container IPs** — PVE host cannot reach 10.0.x.x bridge addresses ("No route to host"). Requires a publicly accessible URL.

**Pitfalls:**
- `interchange_level=1` requires 8.3 filenames → use `-J -r` flags with pycdlib-genisoimage
- Rock Ridge requires `rock_ridge='1.12'` AND `rr_name=` on every `add_file` call → skip Rock Ridge, use Joliet only
- ISO9660 filenames must be <= 8.3 for level 1 (`META-DAT.;1` not `META-DATA.;1`)
- Volume label MUST be exactly `cidata` (case-sensitive) for NoCloud datasource detection
- Files must be at root level (NOT under `openstack/latest/`)
- When both PVE cloudinit (ide2) and NoCloud (ide1) are present, ConfigDrive wins → **delete ide2**

## Cloud-Init Gateway Must Be Reachable

Setting `ipconfig0=ip=10.10.40.10/24,gw=10.10.40.1` on a VLAN where OPNsense isn't configured yet means the VM gets an IP but **no route** (gateway unreachable). Cloud-init may fail silently or leave the VM with broken networking.

**Rule**: Always use vmbr1 bypass (`192.168.200.x` subnet with `gw=192.168.200.1`) for initial provisioning and Docker setup. Switch to VLAN-tagged interface only after OPNsense has the VLAN configured and routing works.

## Boot Order: Preserve Template Format

Template 9000 uses `boot=order=scsi0` (modern PVE format). Setting `boot=dcn` (legacy format) on a cloned VM can cause **boot failure — VM shows ~32MB RAM usage and never loads the OS**. Always preserve the template's boot order format when cloning.

## Restoring PVE Cloud-Init Disk After Overwriting ide2

If you overwrite `ide2` (e.g., attaching a custom ISO), the PVE cloudinit disk volume is destroyed. To restore it:

```bash
# Stop VM first, then:
curl -sk -H "Authorization: PVEAPIToken $TOKEN" \
  -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/$VMID/config" \
  --data-urlencode "ide2=local:cloudinit"
# PVE auto-creates the volume as local:$VMID/vm-$VMID-cloudinit.qcow2
```

**Do NOT** specify the full volume path manually (`local:311/vm-311-cloudinit.qcow2`) — it won't exist and will error. Use `local:cloudinit` keyword and PVE creates it.

## 32MB RAM = VM Not Booting

If a VM stays at ~32MB RAM usage for more than 60 seconds after start, the OS is **not loading**. This is NOT a "slow boot" — it means the bootloader failed. Common causes:
- Wrong boot order format (`boot=dcn` instead of `boot=order=scsi0`)
- Missing or corrupted cloudinit disk (ide2) when cloud-init expects ConfigDrive
- Booting from non-bootable media (seed ISO set as boot priority before disk)

Always check: `qemu/$VMID/status/current` → `mem` field. ~300MB+ = OS loaded. ~32MB = bootloader only.

## PVE API Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| `sshkeys` "invalid format" | Long RSA keys fail — PVE double-encodes `\n` | Use short ed25519 key with `--data-urlencode "sshkeys=ssh-ed25519%20...%0A"`, or NoCloud ISO |
| `content=iso` rejects `.qcow2` | PVE upload only accepts `.iso` extension | Clone from template instead |
| `content=images` rejected on upload | Upload API only accepts `iso,vztmpl,import` | Clone from template |
| Disk in `unusedX` won't delete via config | Must delete volume separately | `DELETE /storage/local/content/local:$VMID/vm-$VMID-disk-X.raw` then remove unused ref |
| QEMU agent unavailable at first boot | `qemu-guest-agent` not pre-installed in cloud images | Install via NoCloud ISO `runcmd` |
| Template 9000 missing `scsihw` | Cloned VMs lack `scsihw=virtio-scsi-pci` | Always add `scsihw=virtio-scsi-pci` after cloning |
| Cloud-init hostname = "coolify" | Template 9000 derived from Coolify image | Set `local-hostname` in NoCloud meta-data |
| PVE cloudinit overrides NoCloud | ConfigDrive datasource has higher priority | Delete ide2, use only NoCloud ISO |
| PasswordAuthentication stays "no" | PVE cloudinit writes `50-cloud-init.conf` with `PasswordAuthentication no` | NoCloud ISO `write_files` + `runcmd` to override |
| NoCloud ISO ignored | Files under `openstack/latest/` instead of root, or volid not `cidata` | Use root-level files and `genisoimage -volid cidata` |
| VMs lose network after removing ide2 | No PVE cloudinit disk = no ipconfig0 networking | Include `network-config` in NoCloud ISO |
| Suricata/libhyperscan fails to install | `kvm64` CPU lacks SSSE3 | Set `cpu=cputype=host` before installing suricata |
| Cloudinit disk destroyed | Overwriting ide2 with custom ISO removes PVE cloudinit volume | Restore with `ide2=local:cloudinit` keyword |
| VM stuck at 32MB RAM | Boot order or cloudinit disk misconfigured | Preserve template boot format (`order=scsi0`), restore ide2 cloudinit |
| Unreachable gateway in ipconfig0 | OPNsense VLAN not configured yet | Use vmbr1 bypass IP for initial setup |
| PVE `snippets` content upload fails with API tokens | `POST /storage/local/upload -F content=snippets` returns HTTP 400 (needs CSRF cookie from password auth) | SSH to PVE host to write `/var/lib/vz/snippets/` directly, or use NoCloud ISO instead |
| Deleting PVE snippet file breaks `cicustom` VM config | VM references `local:snippets/user-data.yaml` — if file deleted, cloud-init disk is invalid, VM bootloops at ~32MB | NEVER delete snippet without removing `cicustom` from VM config first. If deleted: SSH to PVE host to recreate, or switch to NoCloud ISO |
| vmbr1 has no DHCP server | vmbr1 is `method=static` (192.168.200.1/24) with NAT masquerade — no dnsmasq/dhcpd | Always use static IPs on vmbr1: `ipconfig0=ip=192.168.200.X/24,gw=192.168.200.1` |
| PVE snippet upload API also rejected | `POST /storage/local/upload -F "content=snippets"` returns HTTP 400 with API tokens | Use SSH to PVE host or NoCloud ISO instead |
| PVE `snippets` content type rejected by upload API | Upload only accepts `iso,vztmpl,import` | Use `local:cloudinit` keyword or genisoimage/pycdlib ISO creation |