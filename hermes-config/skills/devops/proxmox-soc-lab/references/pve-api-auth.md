# Proxmox VE API Authentication

## Server Details

- **Tailscale IP**: `100.70.37.62` (port 8006)
- **Public IP**: `95.217.87.114`
- **API base**: `https://100.70.37.62:8006/api2/json/`
- **Node name**: `Debian-trixie-latest-amd64-base`
- **PVE version**: 9.1.9
- **CPU**: i9-9900K, 8 cores / 16 threads
- **RAM**: 62G total

## Auth Methods

### API Token (WORKING — primary method)

```
Token ID: hermes@pam!mcp-hermes
Env var: PVE_API_TOKEN (in /opt/data/.env)
Env var: PVE_HOST=https://100.70.37.62:8006 (in /opt/data/.env)
Env var: PVE_NODE=Debian-trixie-latest-amd64-base (in /opt/data/.env)

Usage:
  curl -sk -H "Authorization: PVEAPIToken=$PVE_API_TOKEN" \
    $PVE_HOST/api2/json/nodes/$PVE_NODE/status

⚠️ Header format matters: must be "Authorization: PVEAPIToken <token>" — using bare
"PVEAPIToken: <token>" (without "Authorization:" prefix) returns 401 "No ticket".

Note: Previous token root@pam!hermes returned 401 — it was likely invalid
at the time due to server crash, not a general API limitation. Token auth works.
```

### Cookie-based Ticket Auth (fallback)

```bash
# Step 1: Get ticket + CSRF
curl -sk -X POST https://100.70.37.62:8006/api2/json/access/ticket \
  -d "username=root@pam&password=<ROOT_PASSWORD>"

# Step 2: Use ticket as cookie
curl -sk -H "Cookie: PVEAuthCookie=<TICKET>" \
  -H "CSRFPreventionToken:<CSRF>" \
  https://100.70.37.62:8006/api2/json/nodes
```

## Current Bridge Layout (as of May 2026)

| Bridge   | IP               | Purpose                       |
|----------|------------------|-------------------------------|
| vmbr0    | 95.217.87.114/26 | WAN on eno1 (gateway 95.217.87.65) |
| vmbr1    | 192.168.200.1/24 | Student labs SDN (NAT → vmbr0) |
| vmbr2    | 10.1.0.1/24      | Techshop staging (VMs 201-210) DO NOT REUSE |
| vmbr3    | manual/no IP     | SOC Lab VLAN-aware (VIDs 10-70) |
| vmbr3.10 | 10.10.10.2/24    | VLAN MGMT (Proxmox access) |
| vmbr-lab | 10.255.0.254/24  | Lab bridge                    |
| vmbrl01  | -                | SDN lab                       |
| vmbrl02  | -                | SDN lab                       |

## VMID Ranges

| Range  | Purpose              |
|--------|----------------------|
| 101-110| SDN/OpenFlow + VXLAN student labs |
| 200-210| Techshop staging     |
| 300-309| SOC Lab (OPNsense=300, Wazuh=301, ...) |
| 600+   | Techshop misc        |
| 701    | Coolify              |
| 85xx   | Techshop web         |
| 9000   | Debian 12 cloud template |

## IMPORTANT

- SSH key at `/opt/data/keys/hermes_proxmox` does NOT exist
- SSH password auth also failed for `hermes` and `root` users
- API is the only reliable access method