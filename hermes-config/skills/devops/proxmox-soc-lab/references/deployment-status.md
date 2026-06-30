# SOC Lab Deployment Status

Last updated: 2026-05-19 (OPNsense SNAT configured, PVE DNAT fix applied, all VLANs have internet, bastion Teleport v17.5.1 installed)

## VM/LXC Status

| VMID | Name | Type | Status | VLAN | IP | Progress | Notes |
|------|------|------|--------|------|----|----------|-------|
| 300 | OPNsense | VM | ✅ Running | trunk | 10.0.0.2/24 (WAN), 10.10.10.1/24 (MGMT) | 95% | **3 NICs ALL e1000**: em0=vmbr0(WAN), em1=vmbr3,tag=10(MGMT), em2=vmbr3(trunk). VLANs on em2. All /24 confirmed. DHCP on all VLANs (.100-.200). Firewall: AllowAll (temporary). **WAN gateway = 10.0.0.1 (PVE host)**. |
| 301 | SOC-Wazuh-AIO | VM | ✅ Running | 20 | 10.10.20.10/24 | 90% | QEMU agent ✅. Gateway bypassed to 10.10.20.2 (PVE) — OPNsense TCP outbound broken due to Tailscale NAT interference on PVE. Tailscale disabled (DNS override). Internet working via PVE NAT. `/etc/resolv.conf` hardcoded to 8.8.8.8/8.8.4.4 (`chattr +i`). `/etc/network/interfaces` gateway changed to 10.10.20.2. **Wazuh UI externally accessible at `https://95.217.87.114:8443`** via DNAT+SNAT (requires `bridge-nf-call-iptables=0`). |
| 302 | SOC-Client-IT | VM | ✅ Running | 30 | 10.10.30.111/24 | 30% | net0=vmbr3 tag=30. OS unconfigured. **No QEMU agent** — needs manual install via VNC. Wazuh agent to install. |
| 303 | SOC-AD-01 | VM | ⏹️ Stopped | 20 | — | 0% | Windows Server 2022. net0=virtio,bridge=vmbr3,tag=20. ISOs still attached. **No QEMU agent** — needs VirtIO guest agent via VNC. |
| 304 | SOC-Kali-Offensive | VM | ✅ Running | 30 | 10.10.30.10/24 (manual) | 80% | No cloud-init (ISO). root:kali, SSH ed25519 key, Wazuh 4.14.5 (`kali`). IP set manually via agent exec. Needs persistent net config. |
| 305 | SOC-OT-Core | VM | ✅ Running | 50 | 10.10.50.10/24 | 60% | net0=vmbr3 tag=50. QEMU agent ✅ active. cicustom removed. OpenPLC + ScadaBR deployed. |
| 306 | SOC-OT-ENG | VM | ❌ Absent | 50 | — | 0% | Not created |
| 307 | SOC-Suricata | VM | ✅ Running | 60 | 10.10.60.10/24 | 75% | net0=vmbr3 tag=60. Wazuh 4.14.5 (`soc-suricata-new`). Needs Suricata IDS config + 2nd NIC for SPAN. |
| 308 | bastion | LXC | ✅ Running | 10 | 10.10.10.108/24 (DHCP) | 85% | **Migrated to vmbr3-only**: eth0=vmbr3 tag=10, ip=dhcp → got 10.10.10.108/24. eth1 (vmbr1) removed. Single NIC on MGMT VLAN only. **Teleport v17.5.1 CE installed. Internet✅ via OPNsense SNAT.** |
| 309 | MISP | VM | ❌ Absent | 20 | — | 0% | Deferred |
| 310 | SOC-TheHive | VM | ✅ Running | 20 | 10.10.20.10/24 | 40% | net0=vmbr3 tag=20. TheHive 5 + Cortex 4. Cortex ES mapping bug. |
| 311 | SOC-DMZ | VM | ✅ Running | 40 | 10.10.40.10/24 | 90% | **VLAN 40 CONFIRMED WORKING**. Tailscale 100.105.237.123. Wazuh 4.14.5 (`soc-dmz`). Docker+JuiceShop(:3000)+DVWA(:80). |
| 701 | coolify | VM | ✅ Running | — | — | — | Production (20G RAM) |
| 9000 | debian12-cloud-template | VM | ⏹️ Stopped | — | — | — | Template for cloning (missing scsihw!) |

## Wazuh Agent Status

| VMID | Name | Agent Name | Version | Manager IP | Status |
|------|------|-----------|---------|------------|--------|
| 301 | SOC-Wazuh-AIO | N/A (manager) | 4.x | N/A | Running |
| 304 | SOC-Kali | kali | 4.14.5 | 192.168.200.110 | ✅ Connected |
| 307 | SOC-Suricata | soc-suricata-new | 4.14.5 | 192.168.200.110 | ✅ Connected |
| 311 | SOC-DMZ | soc-dmz | 4.14.5 | 192.168.200.110 | ✅ Connected |

**⚠️ All agents still point to 192.168.200.110 (old vmbr1 IP). Must update MANAGER_IP to 10.10.20.10 after Wazuh is accessible on VLAN 20.**

## OPNsense Interface Status (Post e1000 Migration)

| Interface | Device | Name | Enabled | IP | DHCP Range |
|-----------|--------|------|---------|----|------------|
| wan | em0 | WAN | ✅ | 10.0.0.2/24 (gw=10.0.0.1) | — |
| lan | em1 | MGMT | ✅ | 10.10.10.1/24 | .100-.200 |
| opt1 | em2_vlan20 | SOC | ✅ | 10.10.20.1/24 | .100-.200 |
| opt2 | em2_vlan30 | IT | ✅ | 10.10.30.1/24 | .100-.200 |
| opt3 | em2_vlan40 | DMZ | ✅ | 10.10.40.1/24 | .100-.200 |
| opt4 | em2_vlan50 | OT | ✅ | 10.10.50.1/24 | .100-.200 |
| opt5 | em2_vlan60 | SURICATA | ✅ | 10.10.60.1/24 | .100-.200 |
| opt6 | em2_vlan70 | QUARANTINE | ✅ | 10.10.70.1/24 | .100-.200 |
| (trunk) | em2 | NET2 | ✅ (no IP) | — | — |

**Key**: em2 trunk interface must stay ENABLED with no IP — disabling it breaks all VLAN sub-interfaces.

## Network Architecture (Two-Level NAT)

```
Internet (WAN)
    │
    ├── PVE host (100.70.37.62 / 95.217.87.114)
    │   ├── vmbr0: 95.217.87.114/26 (public IP)
    │   ├── vmbr0: 10.0.0.1/24 (private NAT gateway for OPNsense WAN)
    │   │  └── iptables MASQUERADE 10.0.0.0/24 → eno1 (PERSISTED ✅)
    │   │  └── iptables MASQUERADE 10.10.0.0/16 → eno1 (PERSISTED ✅)
    │   │  └── ⚠️ PREROUTING DNAT rules: MUST use `-d 95.217.87.114` NOT `-d 0.0.0.0/0`
    │   │     (broad match hijacks outbound TCP — see DNAT pitfall in SKILL.md)
    │   ├── Tailscale: 10.0.100.2 / 100.70.37.62
    │   ├── vmbr3: VLAN-aware bridge (vids 10-70)
    │   ├── vmbr3.10: 10.10.10.2/24 (MGMT)
    │   ├── vmbr3.20: 10.10.20.2/24 (VLAN 20 gateway bypass)
    │   └── ip rules: prio 5200 (10.0.0.0/24→main), 5201 (10.10.0.0/16→main)
    │      bridge-nf-call-iptables = 0 ⚠️ MUST be 0 for DNAT/port-forwarding to work
    │
    ├── OPNsense WAN (em0): 10.0.0.2/24, gateway 10.0.0.1
    │   └── Outbound NAT: 10.10.0.0/16 → 10.0.0.2 (masquerade)
    │
    OPNsense (VM 300) ─── vmbr3 (VLAN-aware, vids 10-70)
    │                ├── net1/em1: vmbr3,tag=10 (MGMT)
    │                └── net2/em2: vmbr3 (trunk, all VLANs)
    │
    ├── VLAN 10  MGMT       10.10.10.0/24   DHCP: 100-200   ✅
    ├── VLAN 20  SOC        10.10.20.0/24   DHCP: 100-200   ✅
    ├── VLAN 30  IT         10.10.30.0/24   DHCP: 100-200   ✅
    ├── VLAN 40  DMZ        10.10.40.0/24   DHCP: 100-200   ✅
    ├── VLAN 50  OT         10.10.50.0/24   DHCP: 100-200   ✅
    ├── VLAN 60  SENSOR     10.10.60.0/24   DHCP: 100-200   ✅
    └── VLAN 70  QUARANTINE 10.10.70.0/24   DHCP: 100-200   ✅

vmbr1: REMOVED (all VMs migrated to vmbr3)
```

**✅ OPNsense WAN outbound TCP FIXED**: Root cause was TWO issues: (1) Missing OPNsense SNAT rules for VLAN→WAN translation (now added: 7 SNAT rules, target=wan_ip, one per VLAN), and (2) PVE PREROUTING DNAT rules matching `0.0.0.0/0` instead of `-d 95.217.87.114`, which hijacked ALL outbound TCP from OPNsense (now fixed to specify destination IP). After fixing DNAT rules + flushing conntrack with `conntrack -F`, all VLANs have internet access via OPNsense normally. ICMP and TCP both work.

**✅ PVE host iptables NAT rules are PERSISTED** in `/etc/iptables/rules.v4` (iptables-persistent). DNAT rules corrected: `-d 95.217.87.114` instead of `-d 0.0.0.0/0`.

**✅ Wazuh UI accessible externally**: `https://95.217.87.114:8443` — DNAT (95.217.87.114:8443 → 10.10.20.10:443) + SNAT (source → 10.10.20.2) on PVE. Requires `bridge-nf-call-iptables=0`. DNAT+SNAT rules not yet persisted in `/etc/network/interfaces` — need post-up lines added.

**⚠️ `bridge-nf-call-iptables` not yet persisted**: Current value is 0 (set via `sysctl -w`) but NOT persisted across reboots. Need: `echo "net.bridge.bridge-nf-call-iptables=0" > /etc/sysctl.d/99-bridge-nf.conf`

## Remaining Work

### Network
1. ✅ Migrate all VMs vmbr1 → vmbr3 — DONE
2. ✅ Persist iptables NAT rules on PVE host — DONE
3. ✅ Remove vmbr1 — DONE
4. ✅ Migrate LXC 308 (bastion) → vmbr3 tag=10 only — DONE
5. ✅ Fix OPNsense WAN outbound TCP — DONE (SNAT rules added + PVE DNAT fix applied)
6. ✅ Configure OPNsense SNAT for all VLANs — DONE (7 rules, target=wan_ip)
7. Update Wazuh agent MANAGER_IP from 192.168.200.110 → 10.10.20.10
8. Configure OPNsense firewall rules (default deny + allow list)
9. Configure persistent IP on VMs without cloud-init (304 Kali, 307 Suricata)
10. ⚠️ Persist `bridge-nf-call-iptables=0` in `/etc/sysctl.d/99-soc-lab.conf` — DONE (confirmed in memory)
11. ⚠️ Persist DNAT+SNAT rules for Wazuh UI in `/etc/network/interfaces` post-up lines
12. Configure Teleport service on bastion (choose Proxy/Auth server vs Agent mode)

### Services
11. ✅ Install qemu-guest-agent on VM 301 (DONE via SSH bypass)
12. Install qemu-guest-agent on VM 302 (via VNC console)
13. Install qemu-guest-agent on VM 303 (Windows — VirtIO guest tools via VNC)
14. Deploy VM 303 (Windows AD)
15. Configure Suricata IDS on VM 307
16. Fix Cortex 4 ES mapping bug on VM 310