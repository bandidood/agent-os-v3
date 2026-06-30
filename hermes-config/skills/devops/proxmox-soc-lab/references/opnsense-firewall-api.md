# OPNsense Firewall & Interface API Configuration

## API Endpoints for Firewall Rules

### List all firewall rules
```bash
curl -sk -u "$API_KEY:$API_SECRET" \
  "https://10.10.10.1/api/firewall/filter/get"
```

### Add firewall rules (bulk)
```bash
# The filter/set endpoint accepts a full rule set. Rules are keyed by UUID.
# Each rule object has: uuid, type, interface,ipprotocol, protocol, source_net, source_port, destination_net, destination_port, descr, enabled, etc.

# Example: Add AllowAll rules for all opt interfaces
curl -sk -u "$API_KEY:$API_SECRET" \
  -X POST "https://10.10.10./api/firewall/filter/set" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "rules": {
        "rule": {
          "<UUID>": {
            "type": "pass",
            "interface": "opt2",
            "ipprotocol": "inet",
            "protocol": "any",
            "source_net": "any",
            "destination_net": "any",
            "descr": "Allow All SOC",
            "enabled": "1"
          },
          ...
        }
      }
    }
  }'
```

### Apply firewall changes
```bash
curl -sk -u "$API_KEY:$API_SECRET" \
  -X POST "https://10.10.10.1/api/firewall/filter/apply"
# Returns: {"status":"OK\n\n"}
```

### Restart filter service
```bash
curl -sk -u "$API_KEY:$API_SECRET" \
  -X POST "https://10.10.10.1/api/core/service/restart/filter"
```

## Important Limitations

1. **API-saved rules may not be immediately active**: Even after `/filter/apply` returns OK, rules may not be enforced. Always verify in web UI.
2. **No API for interface assignment**: Adding VLAN interfaces (opt2, opt3, etc.) must be done via web UI: Interfaces → Assignments.
3. **No API for DHCP pool setup**: Kea DHCP subnets must be configured via web UI.
4. **No API for interface enable toggle**: Enabling/disabling opt interfaces must be done via web UI.

## API Endpoint for Interface Info

```bash
curl -sk -u "$API_KEY:$API_SECRET" \
  "https://10.10.10.1/api/interfaces/overview/interfacesInfo"
```

Returns detailed info per interface: device, identifier, description, addr4, vlan_tag, status, enabled, config.

## Troubleshooting: Firewall Rules Not Taking Effect

1. Check `/api/firewall/filter/get` — verify rules appear in the config
2. Confirm rules are `enabled: "1"` and `type: "pass"`
3. Call `/api/firewall/filter/apply` to reload
4. If ping still fails, use web UI: Firewall → Rules → [interface] → verify rules exist → click "Apply Changes" button
5. As last resort, restart filter: `/api/core/service/restart/filter`
6. Verify OPNsense interface is UP: `/api/interfaces/overview/interfacesInfo` — check status and addr4 for the relevant interface
7. **CRITICAL: Check that trunk interface (opt7/vtnet1) is ENABLED** — if disabled, VLAN sub-interfaces (vtnet1_vlanX) cannot receive tagged frames. Opt7 should be enabled but with no IP address.
8. **ARP INCOMPLETE from VM = OPNsense not responding on that VLAN**: If a VM on vmbr3 tag=X sends ARP for 10.10.X.1 and gets INCOMPLETE, check: (a) opt7 (vtnet1) is enabled, (b) VLAN sub-interface vtnet1_vlanX shows `status: up` and correct IP, (c) firewall rules exist on that interface AND are actually applied (web UI verification required). If all three check out, reboot OPNsense — config changes via API may not be fully committed.
9. **After any OPNsense config change (especially interface assignments), reboot**: API `POST /api/core/system/reboot` is the most reliable way to ensure all changes are applied. `filter/apply` alone is NOT sufficient for interface/VLAN changes.

## Source NAT (SNAT/Outbound) API

### Add SNAT rule for VLAN → WAN masquerade

OPNsense needs outbound NAT (SNAT) rules so VLAN traffic can reach the internet via the PVE host's public IP. Without these, VLANs can resolve DNS (UDP 53) but all TCP connections time out.

```bash
# Add SNAT rule for MGMT VLAN (10.10.10.0/24 → WAN)
curl -sk -u "$API_KEY:$API_SECRET" \
  -X POST "https://10.10.10.1/api/firewall/filter/setSNATRule" \
  -H "Content-Type: application/json" \
  -d '{
    "rule": {
      "interface": "lan",
      "protocol": "any",
      "source_net": "10.10.10.0/24",
      "destination_net": "any",
      "target": "wan_ip",
      "descr": "MGMT VLAN outbound NAT",
      "enabled": "1"
    }
  }'

# Repeat for each VLAN (opt1=SOC, opt2=IT, opt3=DMZ, opt4=OT, opt5=Suricata, opt6=QUARANTINE)
# Target "wan_ip" means use the WAN interface IP (10.0.0.2) as the SNAT source
# After adding all rules:
curl -sk -u "$API_KEY:$API_SECRET" \
  -X POST "https://10.10.10.1/api/firewall/filter/apply"
```

**Important**: The `interface` field uses the OPNsense internal name (lan, opt1, opt2, etc.), NOT the descriptive name. Use `/api/interfaces/overview/interfacesInfo` to map descriptive names to internal names.

### List current SNAT rules

```bash
curl -sk -u "$API_KEY:$API_SECRET" \
  "https://10.10.10.1/api/firewall/filter/get" | jq '.data.filter.snatrules'
```

### Delete SNAT rules

Set the `snatrules.rule` array to `[]` in a `filter/set` call to remove all SNAT rules, or use the UUID to remove specific ones.

### Pitfall: SNAT target must be wan_ip, not interface address

Using `target: "wan_ip"` (which resolves to 10.0.0.2) ensures OPNsense does the first level of NAT before PVE does the second level (10.0.0.2 → 95.217.87.114). Both levels are required for internet access. See `references/hetzner-nat-wan.md` for the two-level NAT architecture.

### Pitfall: SNAT without PVE DNAT fix breaks TCP

Even with correct SNAT rules, if PVE DNAT rules for ports 443/80 use `0.0.0.0/0` as destination instead of `-d 95.217.87.114`, all outbound TCP to those ports will be hijacked. See the CRITICAL warning in `references/hetzner-nat-wan.md`.