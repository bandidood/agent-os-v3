# PVE API Token Limitations

The `hermes@pam!mcp-hermes` API token **cannot execute commands on the PVE host node**. `POST /nodes/{node}/execute` returns **403 (user != root@pam)**. Only `root@pam` can use the exec endpoint.

**What the token CAN do:**
- List/query VMs and LXCs (status, config, interfaces, RRD data)
- Modify LXC config (PUT `/lxc/{vmid}/config`) — including network settings
- Start/stop/reboot LXCs and VMs
- Create VNC/term proxy tickets (POST `/lxc/{vmid}/vncproxy` or `/termproxy`) — returns ticket + port for websocket terminal
- Read firewall rules, network interfaces, storage

**What the token CANNOT do:**
- Execute arbitrary commands on the PVE host (no iptables, no ssh, no pct exec from host)
- Read arbitrary files on the host filesystem

**Workaround for bastion debugging:** Use PVE API to check LXC interfaces and config, then ask user to check via VNC console for service-level debugging (`systemctl status`, `ss -tlnp`, `journalctl`).

# LXC Network IP Loss (Critical ⚠️)

**LXC 308 (bastion) lost its IPv4 after reboot** because `net0` was configured with `ip=dhcp` on a VLAN-tagged bridge (`vmbr3,tag=10`). There is no DHCP server on VLAN 10 — the IP silently disappears.

**Fix via PVE API:**
```
PUT /nodes/{node}/lxc/308/config
net0=name=eth0,bridge=vmbr3,hwaddr=BC:24:11:58:49:86,ip=10.10.10.108/24,gw=10.10.10.1,tag=10,type=veth
```
Then reboot: `POST /nodes/{node}/lxc/308/status/reboot`

**Verify:** `GET /nodes/{node}/lxc/308/interfaces` → check eth0 has `10.10.10.108/24`

**Always use static IPs** for SOC lab LXCs on VLAN-tagged bridges. No DHCP server = `ip=dhcp` = silent IP loss on reboot.

# Teleport "No Available Server" Error

When Teleport web UI shows "no available server", it means the **proxy is reachable but cannot connect to the auth service**. Common causes:
1. Teleport process not running → `systemctl status teleport` inside LXC 308
2. Auth service (port 3025) not listening → `ss -tlnp | grep 3025`
3. Config misfire after reboot (e.g., `teleport.yaml` references wrong `public_addr`)
4. **Network stack lost**: If LXC loses its IP (see above), ALL Teleport ports become unreachable

First check: PVE API `/lxc/308/interfaces` to confirm the LXC has its IP. No IP = no Teleport.

# DNS Verification from Sandbox

`dig` and `nslookup` are not available in the Hermes sandbox. Use **Cloudflare DNS-over-HTTPS** instead:

```python
import json, urllib.request
url = f"https://cloudflare-dns.com/dns-query?name=telep.ccdigital.fr&type=TXT"
req = urllib.request.Request(url, headers={"Accept": "application/dns-json"})
resp = urllib.request.urlopen(req, timeout=10)
data = json.loads(resp.read())
for answer in data.get("Answer", []):
    print(f"{answer['name']} → {answer['data']} (TTL: {answer['TTL']})")
```

Supports query types: A, AAAA, TXT, CNAME, MX, NS, SOA, etc. No `dig`, `nslookup`, or `host` available — go straight to DoH.