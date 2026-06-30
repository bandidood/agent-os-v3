# Teleport Bastion on LXC 308

## Architecture

- **LXC 308** (bastion): `10.10.10.108/24` on vmbr3 VLAN 10 (MGMT)
- **Teleport v17.5.1 CE**: Proxy/Auth/SSH on single node
- **Binary**: `/opt/teleport/system/bin/teleport` (add to PATH)
- **Config**: `/etc/teleport.yaml`
- **Data**: `/var/lib/teleport`
- **Service**: `teleport.service` (systemd, enabled)

## Ports

| Port | Service | External DNAT |
|------|---------|--------------|
| 3080 | Proxy/Web UI | 95.217.87.114:3080 → 10.10.10.108:3080 |
| 3023 | SSH | 95.217.87.114:3023 → 10.10.10.108:3023 |
| 3024 | Tunnel | 95.217.87.114:3024 → 10.10.10.108:3024 |
| 3025 | Auth (internal) | No DNAT |

## Config (without ACME — enable after DNS is set up)

```yaml
version: v3
teleport:
  nodename: bastion
  data_dir: /var/lib/teleport
  join_params:
    token_name: ""
    method: token
  log:
    output: stderr
    severity: INFO
    format:
      output: text
  ca_pin: ""
  diag_addr: ""

auth_service:
  enabled: "yes"
  listen_addr: 0.0.0.0:3025
  cluster_name: telep.ccdigital.fr
  proxy_listener_mode: multiplex

ssh_service:
  enabled: "yes"
  listen_addr: 0.0.0.0:3023

proxy_service:
  enabled: "yes"
  web_listen_addr: 0.0.0.0:3080
  public_addr: telep.ccdigital.fr:3080
  ssh_public_addr: telep.ccdigital.fr:3023
  tunnel_public_addr: telep.ccdigital.fr:3024
```

## Enabling ACME (Let's Encrypt)

After DNS `telep.ccdigital.fr → A → 95.217.87.114` is configured, add to `proxy_service` section:

```yaml
proxy_service:
  enabled: "yes"
  web_listen_addr: 0.0.0.0:3080
  public_addr: telep.ccdigital.fr:3080
  ssh_public_addr: telep.ccdigital.fr:3023
  tunnel_public_addr: telep.ccdigital.fr:3024
  acme:
    enabled: true
    email: admin@ccdigital.fr
```

Then `systemctl restart teleport`. If ACME fails with "server name component count invalid", DNS isn't resolving yet.

## Creating Users

```bash
# Via pct exec from PVE host
pct exec 308 -- bash -c 'export PATH=$PATH:/opt/teleport/system/bin; tctl users add admin --roles=editor,access --logins=root,admin'

# Output: https://telep.ccdigital.fr:3080/web/invite/<TOKEN>
```

## Pitfalls

- **ACME errors before DNS**: `acme/autocert: server name component count invalid` or `missing server name` — these appear when Teleport can't resolve its own domain. Disable ACME until DNS is ready.
- **Binary not in PATH**: `teleport` binary lives at `/opt/teleport/system/bin/teleport`, always `export PATH=$PATH:/opt/teleport/system/bin` before `tctl` or `teleport` commands.
- **lxc-attach "No such file or directory"**: The LXC attach command can't find binaries that are in `/opt/teleport/system/bin/` because the system PATH isn't set. Always wrap commands in `bash -c 'export PATH=...:$PATH; command'`.
- **No internet from bastion**: Outbound TCP from VLAN 10 is blocked by OPNsense unless SNAT outbound rules exist. See the DNAT section in hetzner-nat-wan.md.