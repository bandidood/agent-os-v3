# Hetzner NAT WAN Configuration for OPNsense

## Problem

Hetzner (and similar hosting providers) filter MAC addresses on their network switch. Only the server's physical NIC MAC is allowed. OPNsense's vtnet0 has a random virtio MAC (BC:24:11:...) which is NOT the host MAC, so all traffic from OPNsense WAN is silently dropped by the provider's switch.

**Symptoms**: OPNsense gets no DHCP response on WAN, cannot ping gateway, cannot reach Internet. `ping 8.8.8.8` from OPNsense returns "No route to host" or "Host is down".

**Do NOT** assign a public IP to OPNsense WAN — it will not work due to MAC filtering.

## Solution: NAT via Proxmox Host

Instead of giving OPNsense a public IP on vmbr0, configure a private /30 link between PVE host and OPNsense WAN, then NAT via PVE host's public interface.

### Architecture

```
Internet ←→ eno1 (Hetzner public MAC)
               ↑
            vmbr0 (bridge)
               ↑
         10.0.0.1/30 (PVE host)
               ↑
         10.0.0.2/30 (OPNsense WAN / em0)
               ↑
          OPNsense NAT (outbound masquerade)
               ↑
         em1=vlan10 (LAN 10.10.10.0/24)
         em2_vlan20-70 (SOC, IT, DMZ, OT, Suricata, Quarantine)
```

**Two-level NAT** (both required for internet access):
1. OPNsense masquerades: 10.10.x.x → 10.0.0.2 (WAN IP)
2. PVE host masquerades: 10.0.0.0/24 → 95.217.87.114 (public IP)

Skipping either level = no internet.

### Step 1: PVE Host Configuration

Run on the Proxmox host (SSH as root):

```bash
# Add private IP to vmbr0 for OPNsense WAN link
ip addr add 10.0.0.1/24 dev vmbr0

# Enable IP forwarding
sysctl -w net.ipv4.ip_forward=1

# NAT/masquerade OPNsense WAN traffic to internet
iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -o eno1 -j MASQUERADE
iptables -t nat -A POSTROUTING -s 10.10.0.0/16 -o eno1 -j MASQUERADE

# Allow forwarding OPNsense traffic
iptables -A FORWARD -s 10.0.0.0/24 -o eno1 -j ACCEPT
iptables -A FORWARD -s 10.10.0.0/16 -o eno1 -j ACCEPT
iptables -A FORWARD -d 10.0.0.0/24 -o vmbr0 -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -d 10.10.0.0/16 -o vmbr0 -m state --state RELATED,ESTABLISHED -j ACCEPT
```

**Persist across reboots** — add to `/etc/network/interfaces`:

```
# OPNsense NAT gateway (MUST persist — rules are lost on reboot!)
post-up ip addr add 10.0.0.1/24 dev vmbr0
post-up iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -o eno1 -j MASQUERADE
post-up iptables -t nat -A POSTROUTING -s 10.10.0.0/16 -o eno1 -j MASQUERADE
post-up iptables -A FORWARD -s 10.0.0.0/24 -o eno1 -j ACCEPT
post-up iptables -A FORWARD -s 10.10.0.0/16 -o eno1 -j ACCEPT
post-up iptables -A FORWARD -d 10.0.0.0/24 -o vmbr0 -m state --state RELATED,ESTABLISHED -j ACCEPT
post-up iptables -A FORWARD -d 10.10.0.0/16 -o vmbr0 -m state --state RELATED,ESTABLISHED -j ACCEPT
```

### Step 2: OPNsense WAN Configuration

In OPNsense web UI or console:

- **Interfaces → WAN (em0)**:
  - IPv4 Configuration Type: **Static**
  - IPv4 Address: `10.0.0.2/24`
  - Do NOT set DHCP on WAN

- **System → Gateways → Configuration**:
  - Add gateway: Name=`WAN_GW`, Interface=WAN, Address=`10.0.0.1`
  - Set as default gateway

- **Interfaces → WAN**: Set IPv4 Upstream Gateway to `WAN_GW`

**⚠️ CRITICAL: WAN gateway MUST be 10.0.0.1 (PVE host), NOT the public upstream gateway (95.217.87.65)**. OPNsense WAN (10.0.0.2/24) shares a private subnet with PVE host (10.0.0.1). Setting gateway to 95.217.87.65 will NOT work — OPNsense cannot ARP for that address on the 10.0.0.0/24 subnet. PVE host does the NAT to reach the public gateway. Setting the wrong gateway causes "Destination Host Unreachable" from 10.10.X.1 when pinging 8.8.8.8.

### Step 3: PVE Host NAT Verification (CRITICAL)

OPNsense outbound NAT alone is **NOT enough**. PVE host must also masquerade the 10.0.0.0/24 subnet. This is the most commonly forgotten step.

**Why**: OPNsense masquerades 10.10.x.x → 10.0.0.2 (WAN IP). But 10.0.0.2 is still a private IP. PVE host (10.0.0.1) must then NAT 10.0.0.0/24 → 95.217.87.114 (public IP). Without PVE NAT, traffic reaches 10.0.0.1 but dies — no route back to 10.10.x.x.

**Diagnosing missing PVE NAT**: `traceroute 8.8.8.8` from any VM shows hop 1 = OPNsense (10.10.X.1), then * * * (packets dropped at PVE host because no NAT rule). `ping 10.0.0.1` from OPNsense shell works, but `ping 8.8.8.8` returns "Destination Host Unreachable" from OPNsense itself.

**Verify PVE host NAT is active** (run on PVE host):
```bash
iptables -t nat -L POSTROUTING -n -v | grep 10.0.0
iptables -L FORWARD -n -v | grep 10.0.0
cat /proc/sys/net/ipv4/ip_forward  # Should be 1
```

**If NAT rules are missing, add them** (see Step 1 commands above).

### Step 4: OPNsense Outbound NAT + DNS & Firewall

- **Firewall → NAT → Outbound**: Select **Automatic** or **Hybrid** mode → Save → Apply
- **System → Settings → General**: Add DNS servers `8.8.8.8`, `1.1.1.1`
- **Services → Unbound DNS → General**: Enable + add LAN interfaces to Listen Interfaces
- **Services → Kea DHCPv4**: Set DNS server = OPNsense VLAN IP (e.g., 10.10.10.1 for MGMT, 10.10.20.1 for SOC) on each subnet
- **Firewall → Rules → LAN**: Ensure allow LAN net → any

### Troubleshooting

**No Internet from OPNsense** (`ping 8.8.8.8` fails):

1. From OPNsense shell: `ping 10.0.0.1` — should work (link to PVE)
2. From PVE host: `tcpdump -i vmbr0 -n icmp -c 5` — check if ICMP packets arrive
3. Check iptables NAT hits: `iptables -t nat -L POSTROUTING -n -v | grep 10.0.0`
4. If 0 hits, check rule ordering — catch-all MASQUERADE rules may intercept before the specific rule
5. Check `iptables -L FORWARD -n` — Docker/Tailscale chains may interfere

**VMs can reach gateway but not internet** (traceroute shows hop 1 = 10.10.X.1, then * * *):

- This means **PVE host NAT is missing or broken**. OPNsense is routing correctly (hop 1 = OPNsense gateway), but PVE host is not masquerading 10.0.0.x traffic.
- Fix: Run Step 1 NAT + FORWARD rules on PVE host
- Verify: `iptables -t nat -L POSTROUTING -n -v` should show MASQUERADE rule for 10.0.0.0/24

**Wrong WAN gateway (common mistake)**:

- If OPNsense WAN gateway is set to the public upstream gateway (95.217.87.65) instead of 10.0.0.1, VMs get "Destination Host Unreachable" from their OPNsense gateway IP when pinging 8.8.8.8
- Fix: System → Routes → Gateways → set WAN gateway to 10.0.0.1, then Interfaces → WAN → set IPv4 Upstream Gateway to this gateway

**DNS SERVFAIL from LAN clients**:

1. From OPNsense shell: `host deb.debian.org 127.0.0.1` — test local Unbound
2. If SERVFAIL: Unbound can't reach upstream DNS → check WAN connectivity first
3. If local works but LAN fails: check Firewall → Rules → LAN allows UDP/TCP 53 to OPNsense
4. In OPNsense 26.1, there is NO separate Unbound "Forwarding" tab — forwarding is implicit when DNS servers are set in System → Settings → General + Unbound is enabled

**Bastion/clients can't resolve DNS**:

```bash
# On client
echo "nameserver 10.10.10.1" > /etc/resolv.conf
host deb.debian.org 10.10.10.1
```

## Port Forwarding / DNAT to VLAN VMs

Expose internal VLAN services on the PVE public IP. Example: Wazuh UI (10.10.20.10:443) on `https://95.217.87.114:8443`.

### Prerequisites

**`bridge-nf-call-iptables` MUST be 0**. When set to 1, bridged VLAN packets traverse iptables a second time with `vmbr3` as the output interface (not `vmbr3.20`), causing:
- MASQUERADE/SNAT rules matching `-o vmbr3.20` to never fire
- conntrack to build incorrect reverse NAT tuples (reply dst=10.10.20.2 instead of client IP)
- SYN-ACK delivered locally to PVE instead of reverse-NATted back to client
- Result: TCP timeout (SYN reaches VM but SYN-ACK never returns to client)

```bash
# Check current value
sysctl net.bridge.bridge-nf-call-iptables
# Set to 0 (required for DNAT to work)
sysctl -w net.bridge.bridge-nf-call-iptables=0
# Persist across reboots
echo "net.bridge.bridge-nf-call-iptables=0" > /etc/sysctl.d/99-bridge-nf.conf
```

### ⚠️ CRITICAL: DNAT Rules MUST Specify Destination IP

When adding DNAT rules on PVE for port forwarding, ALWAYS specify `-d 95.217.87.114` (the public IP). **Never use `0.0.0.0/0` as the destination.**

```bash
# WRONG — matches ALL TCP traffic on vmbr0 with dport 443/80,
# including OPNsense outbound connections to external HTTPS servers.
# This effectively kills internet for ALL VLANs behind OPNsense.
iptables -t nat -A PREROUTING -i vmbr0 -p tcp --dport 443 -j DNAT --to 10.0.100.2:443

# CORRECT — only matches traffic destined for the public IP
iptables -t nat -A PREROUTING -i vmbr0 -d 95.217.87.114 -p tcp --dport 443 -j DNAT --to 10.0.100.2:443
```

**Why this breaks everything**: OPNsense SNATs VLAN traffic to its WAN IP (10.0.0.2). PVE then MASQUERADEs that to 95.217.87.114. Return traffic with `dport=443/80` arriving on vmbr0 is caught by the broad DNAT rule and redirected to the internal server instead of being routed back to OPNsense. The conntrack table shows `reply src=10.0.100.2` instead of the real server IP. All TCP connections from VLANs get stuck in `SYN_SENT [UNREPLIED]`.

**Symptoms**: ICMP (ping) works fine, DNS (UDP) works fine, but ALL TCP connections to external ports 443/80 time out. TCP to other ports (e.g., 3080, 8443) may still work since they don't match the broad rule. `conntrack -L | grep SYN_SENT` shows OPNsense WAN IP (10.0.0.2) stuck in SYN_SENT for port 443/80 destinations.

**Fix**: Replace broad DNAT rules with destination-IP-specific ones (`-d 95.217.87.114`), then `conntrack -F` to flush stale conntrack entries and `iptables-save > /etc/iptables/rules.v4` to persist.

### DNAT + SNAT Rules (3 rules required)

```bash
# 1. DNAT: redirect public IP port 8443 → Wazuh 10.10.20.10:443
iptables -t nat -A PREROUTING -d 95.217.87.114 -p tcp --dport 8443 -j DNAT --to-destination 10.10.20.10:443

# 2. SNAT: make Wazuh see requests from PVE gateway (10.10.20.2) so replies come back through PVE
#    Without this, Wazuh receives SYN with client's real IP and tries to reply via OPNsense,
#    which may block or misroute the return TCP traffic.
iptables -t nat -A POSTROUTING -d 10.10.20.10 -j SNAT --to-source 10.10.20.2

# 3. Allow INPUT on the external port (if not already covered by a blanket rule)
iptables -I INPUT -p tcp --dport 8443 -j ACCEPT

# Flush stale conntrack entries after adding rules
conntrack -F
```

**The SNAT is mandatory.** Without it, Wazuh's SYN-ACK goes to the client IP via OPNsense (10.10.20.1), which either blocks TCP outbound or misroutes the return path. With SNAT, Wazuh sees the source as 10.10.20.2 (PVE) and replies there directly, allowing PVE to reverse-NAT back to the external client.

**Do NOT use MASQUERADE with interface match** (e.g., `-o vmbr3.20`) — bridge port packets don't have the VLAN sub-interface as out-iface. Use SNAT without interface match instead.

### Persist across reboots

Add to `/etc/network/interfaces` under the vmbr0 stanza:

```
post-up iptables -t nat -A PREROUTING -d 95.217.87.114 -p tcp --dport 8443 -j DNAT --to-destination 10.10.20.10:443
post-up iptables -t nat -A POSTROUTING -d 10.10.20.10 -j SNAT --to-source 10.10.20.2
post-up iptables -I INPUT -p tcp --dport 8443 -j ACCEPT
```

### Template for other VLAN services

Replace IP/port/gateway for each service:

| Service | VLAN IP | Service Port | External Port | SNAT Source |
|---------|---------|-------------|---------------|-------------|
| Wazuh UI | 10.10.20.10 | 443 | 8443 | 10.10.20.2 |
| TheHive | 10.10.20.11 | 9000 | 9000 | 10.10.20.2 |
| JuiceShop (DMZ) | 10.10.40.10 | 3000 | 3000 | 10.10.40.2 |
| OpenPLC (OT) | 10.10.50.10 | 8443 | 8500 | 10.10.50.2 |
| Teleport Proxy | 10.10.10.108 | 3080 | 3080 | 10.10.10.2 (via OPNsense SNAT) |
| Teleport SSH | 10.10.10.108 | 3023 | 3023 | 10.10.10.2 (via OPNsense SNAT) |
| Teleport Tunnel | 10.10.10.108 | 3024 | 3024 | 10.10.10.2 (via OPNsense SNAT) |

```bash
# Generic pattern
iptables -t nat -A PREROUTING -d 95.217.87.114 -p tcp --dport <EXT_PORT> -j DNAT --to-destination <VLAN_IP>:<SVC_PORT>
iptables -t nat -A POSTROUTING -d <VLAN_IP> -j SNAT --to-source <PVE_VLAN_GW>
iptables -I INPUT -p tcp --dport <EXT_PORT> -j ACCEPT
```

### Debugging DNAT failures

1. **Check `bridge-nf-call-iptables`**: Must be 0. If 1, DNAT replies never return.
2. **Check conntrack**: `conntrack -L | grep <VLAN_IP>` — reply tuple must show the real client IP, not 10.10.X.2. If it shows the gateway IP, SNAT is missing or `bridge-nf-call-iptables` is 1.
3. **tcpdump on VLAN interface**: `tcpdump -i vmbr3.20 -n 'host <VLAN_IP> and tcp port <PORT>'` — if SYN reaches VM but no SYN-ACK returns, the reply path is broken (SNAT issue).
4. **Self-test caveat**: `curl https://95.217.87.114:8443` from PVE itself may NOT trigger DNAT (self-connecting packets skip PREROUTING). Always test from an external host.
5. **Check ts-forward chain**: Tailscale's `ts-forward` chain in FORWARD may DROP traffic from 100.64.0.0/10 to tailscale0. Add explicit ACCEPT rules before ts-forward for your DNAT targets: `iptables -I FORWARD 1 -d <VLAN_IP> -p tcp --dport <PORT> -j ACCEPT`.

## Subnet Info

PVE host: 95.217.87.114/26 (vmbr0)
Gateway: 95.217.87.65
Available IPs: .66-.113, .115-.126 (excluding .114)
OPNsense WAN: 10.0.0.2/24 (NAT via PVE)
OPNsense LAN: 10.10.10.1/24 (VLAN 10 on vmbr3)