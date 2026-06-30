---
name: proxmox-soc-lab
description: Deploy and manage a SOC Lab IT+OT on Proxmox with OPNsense, Wazuh, TheHive, and simulated OT zone. Covers bridge configuration, VLAN-aware networking, VM/LXC provisioning, and firewall rules.
tags: [proxmox, soc, opnsense, wazuh, thehive, ot, iec62443, vlan, security-lab]
triggers:
  - Deploy or configure SOC lab on Proxmox
  - Set up OPNsense as inter-VLAN firewall
  - Configure vmbr3 VLAN-aware bridge for SOC lab
  - Provision Wazuh, TheHive, Cortex, OpenPLC VMs
  - Build IT/OT segmentation on Proxmox
  - Access Proxmox VE API for any SOC lab task
  - Install or configure Teleport CE on bastion LXC
  - Set up SSL/Let's Encrypt certificates for SOC services
  - Troubleshoot DNAT/firewall issues on PVE vmbr0
  - Debug PVE API token limitations (cannot exec on host)
  - Verify DNS records from sandbox (no dig/nslookup — use DoH)
  - Fix LXC network IP loss after reboot
---

# Proxmox SOC Lab IT + OT

**⚠️ Critical DNAT Fix:** See `references/pve-dnat-and-teleport.md` — PVE DNAT rules on vmbr0 MUST use `-d 95.217.87.114` (not `0.0.0.0/0`) or OPNsense outbound TCP breaks for all VLANs. Teleport SSL uses manual DNS-01 challenge (Hostinger API token returns 403 — hPanel ≠ Developer API token). **Hostinger DNS pitfall:** TXT record name must be `_acme-challenge.telep` not the full FQDN (Hostinger auto-appends domain).

**⚠️ PVE API Token Limits & DNS from Sandbox:** See `references/pve-api-limitations-and-dns.md` — API token cannot exec on host node (403). No `dig`/`nslookup` in sandbox — use Cloudflare DoH. LXC `ip=dhcp` silently loses IP on VLAN bridges with no DHCP → always use static IPs. Teleport "no available server" = check LXC IP first.

## Architecture Overview

- **Single Proxmox hypervisor** → SPOF assumé, compensé by PRA (vzdump backups + config exports)
- **vmbr3** = dedicated VLAN-aware bridge for SOC Lab (isolated from student labs on vmbr0/vmbr1). ⚠️ vmbr2 is used by techshop staging (10.1.0.1/24, VMs 201-210) — do NOT reuse.
- **OPNsense** = central firewall + router inter-VLAN on vmbr3
- **Wazuh** = single-node SIEM (all-in-one)
- **IEC 62443** zone/conduit model for OT segmentation

## Network Segments (all on vmbr3)

| Segment     | VLAN | Subnet          | Purpose                          |
|-------------|-----:|-----------------|----------------------------------|
| MGMT        | 10   | 10.10.10.0/24   | Proxmox admin, bastion, backups |
| SOC         | 20   | 10.10.20.0/24   | Wazuh, TheHive, Cortex, MISP   |
| IT          | 30   | 10.10.30.0/24   | AD, workstations, servers       |
| DMZ         | 40   | 10.10.40.0/24   | Vulnerable web apps, reverse proxy|
| OT          | 50   | 10.10.50.0/24   | OpenPLC, ScadaBR, OT-ENG        |
| SENSOR/SPAN | 60   | 10.10.60.0/24   | Suricata, Zeek                  |
| QUARANTINE  | 70   | 10.10.70.0/24   | Isolated hosts for IR/forensic  |

## VM/LXC Inventory (VMID 300+ range)

| Workload           | Type | VMID | vCPU | RAM  | Disk   | VLAN | Priority  |
|--------------------|------|-----:|-----:|-----:|-------:|------|-----------|
| OPNsense           | VM   | 300  | 2    | 3G(balloon 2G) | 20G    | trunk | Critical  | net0=e1000,bridge=vmbr0 (WAN/em0), net1=e1000,bridge=vmbr3,tag=10 (MGMT/em1), net2=e1000,bridge=vmbr3 (VLAN trunk/em2, no tag). 3 NICs, all e1000. No QEMU agent. VLANs on em2: em2_vlan20-70. |
| Wazuh all-in-one   | VM   | 301  | 4    | 12G  | 200G   | 20   | Critical  | net0=vmbr3 tag=20 (SOC), ipconfig0=10.10.20.10/24, gw changed to 10.10.20.2 (PVE bypass). QEMU agent ✅ installed. Tailscale disabled (was overriding DNS). Gateway in /etc/network/interfaces changed to 10.10.20.2 for internet bypass. /etc/resolv.conf hardcoded to 8.8.8.8/8.8.4.4 with chattr +i. |
| SOC-Client-IT      | VM   | 302  | 2    | 2G   | 30G    | 30   | High      | net0=vmbr3 tag=30, ipconfig0=10.10.30.111/24. Migrated from vmbr1. QEMU agent NOT installed — needs VNC console. |
| Windows Server AD  | VM   | 303  | 4    | 6G   | 80G    | 20   | High      | net0=virtio,bridge=vmbr3,tag=20. Migrated from vmbr1. Windows Server 2022 ISO. No QEMU agent (needs VirtIO guest tools via VNC). ISOs still attached (ide1, ide2). |
| SOC-Kali-Offensive | VM   | 304  | 2    | 4G   | 40G    | 30   | High      | net0=vmbr3 tag=30, IP 10.10.30.10/24 (manual — no cloud-init). root:kali, SSH key ed25519 injected, Wazuh 4.14.5 (`kali`). |
| OT Core            | VM   | 305  | 4    | 4G   | 60G    | 50   | High      | net0=vmbr3 tag=50, ipconfig0=10.10.50.10/24. OpenPLC v4 + ScadaBR 1.2. QEMU agent ✅ active. ⚠️ cicustom removed (snippet deleted). |
| OT-ENG Station     | VM   | 306  | 2    | 2G   | 40G    | 50   | Medium    | Not created. |
| Suricata Sensor    | VM   | 307  | 2    | 2G   | 20G    | 60   | Medium    | net0=vmbr3 tag=60, ipconfig0=10.10.60.10/24. Wazuh agent 4.14.5 (`soc-suricata-new`). Needs 2nd NIC for SPAN/trunk. |
- **Bastion            | LXC  | 308  | 2    | 2G   | 20G    | 10   | High    | eth0=vmbr3 tag=10 (ip=dhcp, got 10.10.10.108/24). Single NIC only — eth1 (vmbr1) removed. Teleport v17.5.1 CE installed. Internet✅ via OPNsense SNAT + PVE MASQUERADE (DNAT fix applied). Access via PVE `pct exec 308` or SSH (if enabled). |
| TheHive 5 + Cortex 4| VM  | 310  | 4    | 6G   | 80G    | 20   | High      | net0=vmbr3 tag=20, ipconfig0=10.10.20.10/24. Cortex ES mapping blocker. |
| SOC-DMZ (Vuln Apps)| VM   | 311  | 4    | 4G   | 40G    | 40   | Medium    | vmbr3 tag=40, IP 10.10.40.10/24, gw=10.10.40.1. **VLAN 40 CONFIRMED WORKING** after OPNsense trunk e1000 migration. Tailscale 100.105.237.123. Wazuh 4.14.5 (`soc-dmz`). Docker+JuiceShop(:3000)+DVWA(:80). scsihw=virtio-scsi-pci. |

**Total RAM ≈ 46G (without MISP). Leave 8-10G margin for Proxmox + cache.**

- **vmbr1 REMOVED (May 2026)**: All VMs have been migrated from vmbr1 to vmbr3 with proper VLAN tagging. Wazuh (301) net1 (vmbr1 bypass) removed. vmbr1 bridge has been deleted from PVE via API (`DELETE /network/vmbr1` + apply). No VM references vmbr1 anymore. Do NOT recreate vmbr1.

## Deployment Steps

### 1. Create vmbr3 VLAN-aware bridge

⚠️ **Do NOT use vmbr2** — it is already assigned to techshop staging (10.1.0.1/24, VMs 201-210). Reusing it caused a 3-day outage.

```bash
cat >> /etc/network/interfaces << 'EOF'

# SOC Lab Bridge - VLAN-aware
auto vmbr3
iface vmbr3 inet manual
    bridge-ports none
    bridge-stp off
    bridge-fd 0
    bridge-vlan-aware yes
    bridge-vids 10-70
EOF

ifup vmbr3
ip link show vmbr3
bridge vlan show vmbr3
```

**No IP on vmbr3** — OPNsense does all routing between VLANs.
**MGMT access** via vmbr3.10: `10.10.10.2/24` (VLAN interface on vmbr3).

### 2. OPNsense VM (VMID 300)

**Create in ONE step** (seabios = no separate efidisk needed):

```bash
curl -sk -H "$H" -X POST "$PVE_HOST/api2/json/nodes/$NODE/qemu" \
  --data-urlencode "vmid=300" \
  --data-urlencode "name=OPNsense" \
  --data-urlencode "machine=q35" \
  --data-urlencode "bios=seabios" \
  --data-urlencode "cores=2" \
  --data-urlencode "memory=2048" \
  --data-urlencode "net0=virtio,bridge=vmbr0" \
  --data-urlencode "net1=virtio,bridge=vmbr3,tag=10" \
  --data-urlencode "net2=virtio,bridge=vmbr3" \
  --data-urlencode "scsihw=virtio-scsi-pci" \
  --data-urlencode "ostype=l26" \
  --data-urlencode "scsi0=local:20,format=qcow2" \
  --data-urlencode "ide2=local:iso/OPNsense-26.1.2-amd64.iso,media=cdrom" \
  --data-urlencode "boot=cdn" \
  --data-urlencode "onboot=1"
```

- net0 → vmbr0 = WAN (DHCP), net1 → vmbr3,tag=10 = MGMT VLAN (untagged inside OPNsense as vtnet0_vlan10), **net2 → vmbr3 (no tag = trunk)** for VLAN routing. OPNsense needs 3 NICs: WAN, MGMT, and trunk for inter-VLAN routing. Without net2 (trunk), VLANs 20-70 won't work.
- **BIOS: depends on install format**. UFS install → **seabios** (no efidisk needed). ZFS install → **OVMF + efidisk0** required (ZFS creates EFI/GPT partitions unreadable by SeaBIOS). For ZFS: `bios=ovmf`, `efidisk0=local:1,efitype=4m,pre-enrolled-keys=0`.
- **OPNsense installer login**: When booting from ISO, login as `installer` / `opnsense` (NOT `root`/`opnsense` which drops to live mode). The `installer` user launches the disk installer automatically. `opnsense-install` command does NOT exist in OPNsense 26.1.
- **GRUB menu** (~3 sec timeout): May appear with some ISO builds. If present: Option 1 = live mode (default), Option 3 = **Install OPNsense**. With SeaBIOS, you see the **FreeBSD loader menu** instead (Boot multi user, Single user, etc.) — just press Enter/1 for live mode, then login as `installer`/`opnsense` to install.
- **Verify install succeeded**: Before removing ISO, boot OPNsense live, shell (`9`), run `gpart show da0` — must show partitions. If empty, the install failed silently — reinstall before rebooting.
- In OPNsense installer: say **Yes to VLANs**, parent = `vtnet1`, tags 10-70
- Assign: vtnet0=WAN, vtnet1_vlan10=LAN (10.10.10.1/24)
- Default deny inter-VLAN, open only what's needed

### 3. Bastion LXC (VMID 308, VLAN 10)

- Debian 12, unprivileged container, 2 vCPU, 2G RAM, 20G disk
- net0 → vmbr3, tag=10 (MGMT VLAN), ip=dhcp (got 10.10.10.108/24)
- **Single NIC only** — net1 (vmbr1) was removed. Bastion passes exclusively through vmbr3 tag=10.
- Features: nesting=1
- **Teleport v17.5.1 Community Edition** installed (via air-gapped .deb transfer — see pitfalls)
- **No internet access**: OPNsense VLAN 10 blocks outbound TCP. DNS resolves with hardcoded 8.8.8.8/1.1.1.1 but curl times out. Use PVE host or PVE gateway bypass for package installs.
- Tailscale/WireGuard, fail2ban, MFA SSH, Ansible, Git (to be configured)
- Sole admin entry point to Proxmox + all VMs
- **Note**: LXC templates change version numbers. Check `http://download.proxmox.com/images/system/` for current (was `debian-12-standard_12.12-1_amd64.tar.zst`).

### 4. Wazuh (VMID 301, VLAN 20)

- Official all-in-one installer
- Configure ILM: Hot 7d → Warm 14d → Delete 30d
- Connect agents: bastion, Windows, Ubuntu IT, OPNsense, Suricata

## ⚠️ PRE-CHANGE SAFETY PROCEDURE (MANDATORY)

Before ANY network/bridge/VLAN change on Proxmox, ALWAYS:

1. **Inventory** current network config: `cat /etc/network/interfaces`, `ip link show`, `bridge vlan show`
2. **Backup** configs: `cp /etc/network/interfaces /etc/network/interfaces.bak.$(date +%Y%m%d)`, `pvesh get /nodes/$(hostname)/network --output-format json > /root/network-backup-$(date +%Y%m%d).json`
3. **Verify connectivity** after change: `ping` gateway, Proxmox UI, SSH access
4. **Rollback plan**: know the exact command to revert (`ifreload`, `systemctl restart networking`)

**Incident log**: A vmbr config change during SOC lab setup caused a 3-day full outage. This procedure is non-negotiable.

## PVE API Provisioning (Cheat Sheet)

See `references/pve-api-provisioning.md` for full command reference. Key patterns:

- **Always use `--data-urlencode`** for VM/LXC creation — `-d` form encoding breaks comma-separated net/disk params (duplicate key error).
- **Create VM first, then add disks** — OVMF VMs need separate `efidisk0` and `scsi0` after initial creation.
- **Upload files via API** when Proxmox DNS is broken: `curl -F "content=iso" -F "filename=@/local/file.iso"` to `/storage/local/upload`. LXC templates similarly: `-F "content=vztmpl"`.
- **LXC template naming**: version in URL changes frequently. Check `http://download.proxmox.com/images/system/` for current version (was `12.12-1` not `12.7-1`).

## OPNsense Console Setup Flow (post-install, first disk boot)

1. **Boot menu**: FreeBSD loader menu appears (not GRUB). Press Enter for "Boot multi user"
2. **Import config prompt**: "Select device to import from" — **leave blank, press Enter** to skip (clean install)
3. **OPNsense console menu** appears → must reconfigure interfaces every time after fresh install

**Interface assignment (Option 1):**
1. **Accept VLANs** → Yes, parent = `vtnet1`, create tags 10,20,30,40,50,60,70
2. **LAGGs** → Skip (not needed)
3. **Assign**: WAN = `vtnet0`, LAN = `vtnet1_vlan10`
4. **Verify**: OPNsense may invert vtnet0/vtnet1 — always check. WAN must be vtnet0 (vmbr0), LAN must be vtnet1_vlan10 (vmbr3)

**IP configuration (Option 2):**
- WAN → **Static IP** (Hetzner does NOT provide DHCP on vmbr0). Use an available IP from the PVE host's /26 block. Check PVE host vmbr0 IP (e.g., 95.217.87.114/26) and gateway (e.g., 95.217.87.65). Pick an unused IP (e.g., 95.217.87.113/26) for OPNsense WAN. **Gateway must be set explicitly** — System → Gateways → Add → interface=WAN, address=95.217.87.65. Then assign this gateway to the WAN interface.
- LAN → 10.10.10.1/24, no upstream gateway (it IS the gateway)

**DHCP (Option 6):**
- Enable on LAN, range 10.10.10.100-10.10.10.200

**After console setup, use web UI (https://10.10.10.1) via SSH tunnel:**
```bash
ssh -L 10443:10.10.10.1:443 root@100.70.37.62
# Then browse https://localhost:10443
```

**Web UI — remaining VLANs + Kea DHCP:**
1. Interfaces → Assignments → VLANs on vtnet1 (tags 20-70)
2. Interfaces → Assignments → add each VLAN interface
3. Rename interfaces: OPT1→SOC, OPT2→IT, OPT3→DMZ, OPT4→OT, OPT5→SENSOR, OPT6→QUARANTINE
4. Configure IPv4 static on each (10.10.X.1/24)
5. **Kea DHCPv4** (not ISC DHCP — ISC is deprecated): Services → Kea DHCPv4 → Settings (enable) → Subnets (add each VLAN with pool)
6. **Firewall → Rules**: default deny inter-VLAN, open progressively

## Pitfalls

⚠️ **Full pitfalls reference**: `references/pitfalls-and-operational-notes.md` — ~200 pitfalls organized by topic (OPNsense, PVE API, cloud-init, DNAT/NAT, TheHive/Cortex, OpenPLC, ScadaBR, networking, SSH access patterns, and more).

### Critical Pitfalls (Quick Reference)

- **vmbr2 already in use**: SOC Lab bridge is **vmbr3**, never vmbr2 (used by techshop staging).
- **OPNsense trunk NIC MUST be `e1000`**: FreeBSD virtio driver silently drops VLAN-tagged frames on trunk — causes ARP INCOMPLETE on all VLANs. Only the trunk NIC needs e1000; access-port VMs can stay virtio.
- **Hetzner MAC filtering**: Do NOT assign public IP to OPNsense WAN. Use private /24 link on vmbr0 + PVE host NAT. See `references/hetzner-nat-wan.md`.
- **PVE DNAT rules MUST specify destination IP**: `-d 95.217.87.114` (NOT `0.0.0.0/0`) or OPNsense outbound TCP breaks. See `references/pve-dnat-and-teleport.md`.
- **`bridge-nf-call-iptables` MUST be 0**: Required for DNAT/port-forwarding to work on VLAN bridges.
- **Tailscale on PVE breaks NAT for forwarding**: ts-postrouting chain overwrites SNAT rules. Use PVE host VLAN IPs as bypass gateways.
- **OPNsense installer login**: Login as `installer`/`opnsense` (NOT `root`/`opnsense`).
- **Cortex 4 Bearer auth is BROKEN**: Use `type = "basic"` for TheHive→Cortex connections.
- **OPNsense DNS/NAT not configured by default**: Must enable outbound NAT (Automatic/Hybrid mode) + Unbound DNS forwarding for internet access.
- **PVE API token auth format**: `Authorization: PVEAPIToken $TOKEN` (not bare `PVEAPIToken: $TOKEN`).
- **Debian cloud-init disables PasswordAuthentication**: Use `sshkeys` API param or QEMU agent `set-user-password` for access.
- **Cloud-init does NOT re-apply IP config after bridge/VLAN change**: Delete and recreate `ide2` + stop/start, or use QEMU agent exec for manual fix.

### Other Notable Pitfalls

- **OPNsense ZFS install requires OVMF**
  - **UFS install + SeaBIOS** ✅ — Works. UFS creates an MBR boot sector that SeaBIOS can boot.
  - **ZFS install + SeaBIOS** ❌ — ZFS install creates a GPT/EFI partition (260MB). SeaBIOS cannot boot from EFI partitions. Result: "Booting from ROM... Non bootable" with 0 useful disk activity and ~36-37MB RAM usage (no OS loaded). **Fix**: either reinstall with UFS format, or switch to OVMF (`bios=ovmf`) + add `efidisk0`. For a lab, UFS is simpler and more reliable.
  - **OVMF + ZFS works in 26.1**: OVMF boot hang was a 25.x bug. In 26.1, OVMF+q35+ZFS boots correctly.

*See `references/pitfalls-and-operational-notes.md` for all remaining detailed pitfalls.*

## Firewall Rules (OPNsense)

Default: deny all inter-VLAN. Open progressively:
- MGMT(10) → Proxmox: SSH/HTTPS from bastion only
- IT(30) → SOC(20): Wazuh agent, syslog, WinRM
- DMZ(40) → SOC(20): Web logs, Suricata
- OT(50) → SOC(20): OT logs, NTP/DNS if needed
- QUARANTINE(70) → SOC(20): Allowed (analysis, forensic)
- Any → QUARANTINE: Denied (isolation)
- OT(50) → Internet: Denied or very restricted

## Build Timeline (6 weeks)

| Week | Focus         | Deliverables                                    |
|------|---------------|-------------------------------------------------|
| 1    | Network       | vmbr3, OPNsense, bastion, initial PRA           |
| 2    | SOC core      | Wazuh, TheHive/Cortex, first log flows          |
| 3    | IT targets    | Windows AD, Ubuntu IT, Suricata, IT use cases  |
| 4    | DMZ           | Exposed services, web logs, webshell playbook   |
| 5    | OT            | OpenPLC+ScadaBR, OT-ENG, IT/OT flows, OT UCs   |
| 6    | Purple team   | KPIs, Atomic Red Team, maturity scoring         |

## References

- `references/deployment-status.md` — Current VM status, sprint backlog, network map, and access info (updated per session)
- `references/guide-v2.1.md` — Full deployment guide v2.1
- `references/pve-api-auth.md` — PVE API auth methods, server details, bridge layout
- `references/pve-api-provisioning.md` — PVE API provisioning commands (VM/LXC creation, ISO/template upload, task monitoring, pitfalls)
- `references/opnsense-initial-setup.md` — OPNsense install steps, OVMF boot hang fix, VNC console config, VLAN setup
- `references/hetzner-nat-wan.md` — Hetzner NAT WAN setup for OPNsense (MAC filtering bypass, iptables, DNS/NAT config)
- `references/opnsense-firewall-api.md` — OPNsense firewall & interface API configuration (rule creation, apply, troubleshooting)
- `references/teleport-bastion.md` — Teleport CE bastion on LXC 308: config, ports, DNAT, ACME, pitfalls
- `references/ot-core-deployment.md` — VM 305 (SOC-OT-Core) deployment: OpenPLC v4, ScadaBR 1.2, Tomcat 9, MariaDB, cloud-init pitfalls
- `references/scadabr-dwr-automation.md` — ScadaBR DWR2 automation: session flow, object format, full API reference, Python examples
- `references/cloud-init-vm-provisioning.md` — Cloud-init VM provisioning: clone-based setup, post-boot SSH key injection, bypass networking, PVE API pitfalls for cloud-init
- `references/thehive-cortex-deployment.md` — TheHive 5 + Cortex 4 Docker Compose deployment: CSRF auth flow, migration from bare-metal v4/v3
- `references/cortex-analyzer-activation.md` — Cortex 4 analyzer activation: orgAdmin CSRF flow, ES mapping bug, Worker model fields, init flow
- `templates/docker-compose-thehive.yml` — Docker Compose template for TheHive 5 + Cortex 4 + Cassandra + ES