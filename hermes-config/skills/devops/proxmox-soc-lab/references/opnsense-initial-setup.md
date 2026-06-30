# OPNsense Initial Setup (VMID 300)

## VM Config

- **net0** → vmbr0 (WAN, gets DHCP from Proxmox external network)
- **net1** → vmbr3 (LAN trunk, VLANs 10-70, no tag — OPNsense does 802.1Q internally)
- **BIOS**: **depends on install format**. UFS → seabios (no efidisk). ZFS → **OVMF + efidisk0** required (ZFS creates EFI/GPT partitions, SeaBIOS cannot boot them). For ZFS: `bios=ovmf`, `efidisk0=local:1,efitype=4m,pre-enrolled-keys=0`.
- **machine**: q35
- **boot**: dcn (disk first, then CD, then network)

## ⚠️ SeaBIOS + ZFS = Non-Bootable (Critical Pitfall)

If OPNsense was installed with **ZFS** format, it creates a GPT disk with an EFI partition (260MB). **SeaBIOS cannot boot from EFI/GPT partitions.** The VM will show "Booting from ROM... Non bootable" with ~36MB RAM usage (nothing loaded).

**Fix options:**
1. **Switch to OVMF** (recommended for ZFS): stop VM, set `bios=ovmf`, add `efidisk0=local:1,efitype=4m,pre-enrolled-keys=0`, boot.
2. **Reinstall with UFS** and keep SeaBIOS: UFS creates an MBR boot sector readable by SeaBIOS.

OPNsense 26.1 with OVMF + ZFS boots successfully. Earlier versions (25.x) may hang at EFI boot manager.

## ⚠️ OVMF Boot Hang (Historical — 25.x)

With older OPNsense (25.x) + OVMF + q35, OPNsense could hang at the EFI boot manager ("UEFI QEMU HARDDISK" entry does nothing on Enter).

**Symptoms**: VM runs (1.5GB+ RAM used), 0KB network traffic, QEMU agent never responds. Boot sequence stops at EFI menu.

**Fix — switch to SeaBIOS**:
1. Stop VM: `POST /nodes/$NODE/qemu/300/status/stop`
2. Switch BIOS: `POST /nodes/$NODE/qemu/300/config` with `bios=seabios` and `delete=efidisk0`
3. Remove ISO: `ide2=none,media=cdrom`
4. Boot from disk: `boot=dcn`
5. Start VM — boots directly to OPNsense, no EFI menu

**For UFS installs**: Use `bios=seabios` and `machine=q35`. SeaBIOS cannot boot ZFS/EFI partitions.
**For ZFS installs**: Use `bios=ovmf` + `efidisk0=local:1,efitype=4m,pre-enrolled-keys=0`. OVMF is required to boot from EFI/GPT partitions.

## Installation Steps (via Proxmox VNC Console or sendkey+OCR)

1. **Boot from ISO** → FreeBSD loader menu appears (NOT GRUB):
   - Menu shows: (1) Boot multi user, (2) Boot single user, (3) Escape to loader prompt, (4) Reboot, (5) Cons video, (6) Kernel, (7) Boot options
   - There is **NO "Install OPNsense" GRUB entry** — press **Enter** or **1** to boot into live OPNsense
2. **Login with installer credentials**: user **`installer`**, password **`opnsense`**. This launches the installer automatically. (The `root`/`opnsense` login drops you into the config menu — no install option there.)
3. **"Select device to import from" prompt** (if no disk config found): Leave blank and press Enter to skip.
4. Select disk **`da0`** (20G SCSI/virtio) when prompted by installer
5. **Choose filesystem format (CRITICAL)**:
   - **UFS** ✅ if using **SeaBIOS** — creates MBR boot sector, compatible with SeaBIOS boot. Recommended for labs.
   - **ZFS** ⚠️ only if using **OVMF (UEFI)** — creates EFI partition that SeaBIOS CANNOT boot. If you choose ZFS with SeaBIOS, the VM will show "Booting from ROM... Non bootable" and fail to start (36MB RAM, no OS loaded).
   - If you accidentally installed ZFS with SeaBIOS, you must either: (a) switch to OVMF + add efidisk0, or (b) reinstall with UFS format.
6. **VERIFY install**: Before removing ISO, go to shell and run `gpart show da0`. Expected output:
   - UFS: `freebsd-boot` + `freebsd-ufsl` + `freebsd-swap` partitions
   - ZFS: `efi` (260M) + `freebsd-zfs` + `freebsd-swap` partitions
   - If empty or only tiny partition → install failed silently, **reinstall before rebooting**
7. After verified install: **Shutdown** → Remove ISO → Set `boot=dcn` → Boot from disk
8. SeaBIOS boots UFS directly — no EFI menu to navigate

### Automating console via sendkey API

If you can't manually interact with VNC, use the sendkey API to send keystrokes:

```bash
# Send '1' then Enter to select "Assign interfaces"
curl -sk -H "$H" -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/300/sendkey" -d "key=1"
sleep 1
curl -sk -H "$H" -X PUT "$PVE_HOST/api2/json/nodes/$NODE/qemu/300/sendkey" -d "key=ret"
```

Combine with RapidOCR on user-provided screenshots to read console output and determine next keystrokes.

## ⚠️ Interface Inversion (Common Pitfall)

After first boot, OPNsense may auto-assign interfaces backwards:
- **vtnet0** (vmbr0, should be WAN) → configured as LAN
- **vtnet1** (vmbr3, should be LAN trunk) → configured as WAN

This happens because OPNsense defaults the first detected interface to LAN. Always verify after first boot and reassign if needed (Option 1 in console).

**Proxmox side is correct**: verify with `curl -sk -H "Authorization: PVEAPIToken=$PVE_API_TOKEN" "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/config"` — you should see `net0: virtio=...,bridge=vmbr0` and `net1: virtio=...,bridge=vmbr3`.

## ⚠️ ISO Left Mounted After Install

After OPNsense is installed, the ISO may still be attached (`ide2`) with `boot=cdn`. **Always detach the ISO** once install is verified — otherwise the VM may re-boot into the installer instead of the installed system:

```bash
curl -sk -H "Authorization: PVEAPIToken=$PVE_API_TOKEN" \
  -X POST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/config" \
  --data-urlencode "ide2=none,media=cdrom" \
  --data-urlencode "boot=dcn"
```

## Post-Install Network Config (VNC Console)

1. **Boot menu**: FreeBSD loader shows "Boot multi user" etc. Press Enter for live mode
2. **Import config prompt**: "Select device to import from" → **leave blank, press Enter** to skip
3. **Login**: `installer` / `opnsense` (NOT root/opnsense — that drops to live console)
4. **Install to disk**: Select `da0`, format ZFS or UFS
5. **Verify partitions**: Shell → `gpart show da0` must show partitions (efi, zfs/ufs, swap)
6. **Shutdown, remove ISO, boot from disk** (see Pitfalls for BIOS/filesystem matching)
7. After first boot from disk, login: `root` / `opnsense`
8. **Configure VLANs**: OPNsense asks "Configure VLANs now?" → **Yes**
   - Parent interface: `vtnet1` (LAN, vmbr3)
   - Create VLAN tags: 10, 20, 30, 40, 50, 60, 70
   - **LAGGs**: Skip this menu — not needed for single-NIC-per-segment lab setups
9. **Assign interfaces** (⚠️ OPNsense may invert — always verify):
   - WAN → `vtnet0` (vmbr0)
   - LAN → `vtnet1_vlan10` (MGMT VLAN 10)
10. **Set interface IPs** (Option 2):
    - WAN: **Static IP** — Hetzner does NOT provide DHCP. Use `10.0.0.2/30` with gateway `10.0.0.1` (NAT via PVE host, see `references/hetzner-nat-wan.md`)
    - LAN: `10.10.10.1/24` (MGMT VLAN 10 gateway, **no upstream gateway** — it IS the gateway)
11. **Enable DHCP on LAN** (Option 6):
    - Range: `10.10.10.100` - `10.10.10.200`
12. **Web GUI**: Leave **HTTPS** enabled (default) — do NOT switch to HTTP
13. **Access web UI**: `ssh -L 10443:10.10.10.1:443 root@100.70.37.62` then browse `https://localhost:10443`
14. **Add remaining VLANs** in web UI: Interfaces → Assignments → VLANs on vtnet1 (tags 20-70)

## VLAN Configuration (Web UI after initial setup)

After accessing the web UI:
1. **Interfaces → Assignments → VLANs**
   - Parent: vtnet1, VLAN tags: 20,30,40,50,60,70
2. **Interfaces → Assignments**
   - Assign each new VLAN interface
3. **Configure each VLAN interface IP**:
   - VLAN 20 (SOC): 10.10.20.1/24 + DHCP
   - VLAN 30 (IT): 10.10.30.1/24 + DHCP
   - VLAN 40 (DMZ): 10.10.40.1/24 (no DHCP for DMZ)
   - VLAN 50 (OT): 10.10.50.1/24 + DHCP
   - VLAN 60 (SENSOR): 10.10.60.1/24 (no DHCP for sensors)
   - VLAN 70 (QUARANTINE): 10.10.70.1/24 (no DHCP — isolated)
4. **Firewall → Rules**: Default deny all inter-VLAN
5. Open progressively per SOC lab firewall rules

## ⚠️ Post-Install: DNS + NAT Required (Critical)

After OPNsense is installed and interfaces/VLANs are configured, **LAN clients still cannot reach Internet**. OPNsense does NOT enable DNS forwarding or outbound NAT by default. Symptoms: LXC/container gets DHCP IP, can ping gateway (10.10.10.1), but `apt update` fails with "Temporary failure resolving".

**Fix in web UI — do this BEFORE deploying any VMs/LXC:**

1. **Outbound NAT** (most critical — enables LAN→WAN masquerade):
   - Firewall → NAT → Outbound → select **Hybrid** or **Automatic** → Save & Apply Changes

2. **DNS servers** (enables DNS resolution for OPNsense itself):
   - System → Settings → General → add DNS servers: `8.8.8.8`, `1.1.1.1`
   - Check "Allow DNS server list to be overridden by DHCP/PPP on WAN"

3. **Unbound DNS** (enables DNS forwarding to LAN clients):
   - Services → Unbound DNS → General → Enable

4. **Kea DHCP DNS** (tells clients to use OPNsense as DNS):
   - Services → Kea DHCPv4 → Subnets → each subnet → DNS Servers = gateway IP of that VLAN (e.g., 10.10.10.1 for VLAN 10)

5. **Verify from Bastion**:
   ```bash
   echo "nameserver 10.10.10.1" > /etc/resolv.conf
   ping -c 2 8.8.8.8     # Test NAT/internet connectivity first
   host deb.debian.org 10.10.10.1   # Test DNS resolution via OPNsense
   ping -c 2 deb.debian.org   # Test full DNS resolution
   apt update
   ```

⚠️ **DNS SERVFAIL troubleshooting**: If `host deb.debian.org 10.10.10.1` returns SERVFAIL but Unbound listens on 10.10.10.1:53, the issue is Unbound can't reach upstream DNS. Diagnostic steps:
   1. From OPNsense shell: `host deb.debian.org 8.8.8.8` — if this fails, WAN blocks DNS outbound
   2. Check Firewall → Rules → WAN allows UDP/TCP 53 outbound
   3. Check Services → Unbound DNS → General → Listening Interfaces includes LAN
   4. In OPNsense 26.1, there is NO separate "Forwarding" tab — forwarding is implicit when DNS servers are set in System → Settings → General + Unbound is enabled
   5. OPNsense shell DNS tools: use `host <domain> <server>` or `drill <domain> @<server>` — `nslookup` does NOT exist on OPNsense

## OPNsense REST API (available with API key)

After creating an API key (System → Access → Users → root → API keys → ➕), these endpoints work with `curl -u "$KEY:$SECRET"`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/core/system/status` | GET | System status |
| `/api/core/system/reboot` | POST | Reboot OPNsense |
| `/api/core/system/halt` | POST | Halt system |
| `/api/core/firmware/status` | GET | Firmware status |
| `/api/core/firmware/check` | POST | Check for updates |
| `/api/core/firmware/install/<pkg>` | POST | Install a package |
| `/api/core/firmware/running` | GET | Check if firmware job running |
| `/api/core/service/search` | GET | List all services |
| `/api/core/service/restart\|start\|stop/<service>` | POST | Manage services |
| `/api/core/menu/search` | GET | Discover UI menu entries |
| `/api/interfaces/overview/interfacesInfo` | GET | All interfaces with IPs, VLANs, status |
| `/api/interfaces/settings/get` | GET | Global interface settings |
| `/api/firewall/alias/searchItem\|getItem\|addItem` | GET/POST | Firewall aliases |
| `/api/firewall/filter/get\|set` | GET/POST | Firewall filter rules |
| `/api/routing/settings/get\|set` | GET/POST | Routing config |

**NOT available via REST API** (requires web UI):
- Interface assignment (VLAN → interface)
- Interface IP configuration
- DHCP pool/subnet setup
- Firewall rule creation (per-interface)
- Kea DHCPv4 configuration

The `os-interfaces` and `os-firewall` API plugins were tested and did NOT add these endpoints even after install + reboot.

## OPNsense VLAN Status (current state)

- `vtnet1_vlan10` (MGMT/LAN) = **10.10.10.1/24** ✅ Active
- `vtnet1_vlan20` = created, **unassigned, no IP** ❌
- `vtnet1_vlan30` = created, **unassigned, no IP** ❌
- `vtnet1_vlan40` = created, **unassigned, no IP** ❌
- `vtnet1_vlan50` = created, **unassigned, no IP** ❌
- `vtnet1_vlan60` = created, **unassigned, no IP** ❌
- `vtnet1_vlan70` = **opt1/QUARANTINE**, assigned but **no IP, disabled** ❌

**All VLANs 20-60 require web UI configuration before VM migration to vmbr3.**

## Accessing OPNsense Web UI

Cannot reach 10.10.10.1 from outside PVE host. Use SSH tunnel from local PC:

```bash
ssh -L 10443:10.10.10.1:443 root@100.70.37.62
# Then browse https://localhost:10443
# Login: root / opnsense
```

Do NOT open port 443 on Hetzner firewall — SSH tunnel is the secure method.



After removing ISO and setting `boot=dcn`, start the VM and check it actually booted OPNsense from disk:

- **RAM usage ~36MB** + near-zero network traffic → disk is empty (install silently failed)
- **RAM usage ~1.3GB** + active network traffic → OPNsense loaded successfully

Check via API:
```bash
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/status/current" | python3 -c "
import json, sys
data = json.load(sys.stdin)['data']
mem_pct = data['mem']/data['maxmem']*100
print(f'Status: {data[\"status\"]}')
print(f'Uptime: {data[\"uptime\"]}s')
print(f'Mem: {data[\"mem\"]/1024/1024:.0f}M/{data[\"maxmem\"]/1024/1024:.0f}M ({mem_pct:.0f}%)')
for nic, stats in data.get('nics', {}).items():
    print(f'  {nic}: in={stats[\"netin\"]/1024:.1f}KB out={stats[\"netout\"]/1024:.1f}KB')
if data['mem'] < 100_000_000:
    print('⚠️  LOW RAM — disk image likely empty, OPNsense did not boot')
else:
    print('✅ Normal RAM — OPNsense appears loaded')
"
```

- **RAM diagnostic for boot state**: After starting VM, check RAM via API. ~36MB = disk is empty (install silently failed). ~1.3GB+ = OPNsense loaded successfully.
- **Reboot API may NOT actually reboot**: The `POST /nodes/$NODE/qemu/300/status/reboot` endpoint may not reboot the VM — uptime doesn't reset. **Always use stop+start** instead:
  ```bash
  curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
    -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/status/stop"
  sleep 10  # Wait for full shutdown
  curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
    -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/status/start"
  ```

## Reinstalling OPNsense (when disk is empty)

```bash
# 1. Stop VM
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/status/stop"
sleep 10

# 2. Reattach ISO + boot from CD
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/config" \
  --data-urlencode "ide2=local:iso/OPNsense-26.1.2-amd64.iso,media=cdrom" \
  --data-urlencode "boot=cdn"

# 3. Start VM — boots into live OPNsense
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/status/start"
```

After live boot → VNC console → option `1` (Install) → select da0 → UFS format → then **verify** with `gpart show da0` (option 9 shell).

## Proxmox: ISO and Boot Management via API

```bash
# Remove ISO after install (switch to disk boot)
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/config" \
  --data-urlencode "ide2=none,media=cdrom" \
  --data-urlencode "boot=dcn"

# Reattach ISO (for reinstall)
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/config" \
  --data-urlencode "ide2=local:iso/OPNsense-26.1.2-amd64.iso,media=cdrom" \
  --data-urlencode "boot=cdn"

# Switch to SeaBIOS + remove efidisk (fix boot hang)
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/config" \
  --data-urlencode "bios=seabios" \
  --data-urlencode "delete=efidisk0"

# ⚠️ Reboot API (status/reboot) may NOT actually reboot — use stop+start instead
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/status/stop"
sleep 10
curl -sk -H "Authorization: PVEAPIToken $PVE_API_TOKEN" \
  -XPOST "$PVE_HOST/api2/json/nodes/$PVE_NODE/qemu/300/status/start"
```