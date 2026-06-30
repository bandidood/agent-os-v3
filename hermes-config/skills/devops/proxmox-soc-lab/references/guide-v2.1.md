# Guide de déploiement v2.1 — SOC Lab IT + OT sur Proxmox

## Contexte

Déploiement coexistant avec labs étudiants existants (Bloc1/Bloc2 sur vmbr0/vmbr1).
Le SOC Lab utilise **vmbr2** exclusivement — aucun conflit réseau.

## Architecture

- vmbr2 = bridge VLAN-aware dédié SOC Lab (VLANs 10-70)
- OPNsense = firewall central (WAN sur vmbr0, LAN trunk sur vmbr2)
- Wazuh single-node SIEM (12G RAM, 200G disque)
- Zone OT structurée IEC 62443 (zone/conduits)

## Segments

| Segment     | VLAN | Subnet          | Purpose                          |
|-------------|-----:|-----------------|----------------------------------|
| MGMT        | 10   | 10.10.10.0/24   | Proxmox admin, bastion, backups |
| SOC         | 20   | 10.10.20.0/24   | Wazuh, TheHive, Cortex, MISP   |
| IT          | 30   | 10.10.30.0/24   | AD, workstations, servers       |
| DMZ         | 40   | 10.10.40.0/24   | Vulnerable web apps, reverse proxy|
| OT          | 50   | 10.10.50.0/24   | OpenPLC, ScadaBR, OT-ENG        |
| SENSOR/SPAN | 60   | 10.10.60.0/24   | Suricata, Zeek                  |
| QUARANTINE  | 70   | 10.10.70.0/24   | Isolated hosts for IR/forensic  |

## VM Inventory

| Workload           | Type | VMID | vCPU | RAM  | Disk   | VLAN | Priority  |
|--------------------|------|-----:|-----:|-----:|-------:|------|-----------|
| OPNsense           | VM   | 200  | 2    | 2G   | 20G    | trunk| Critical  |
| Wazuh all-in-one   | VM   | 201  | 8    | 12G  | 200G   | 20   | Critical  |
| TheHive + Cortex   | VM   | 202  | 4    | 6G   | 80G    | 20   | High      |
| Windows Server/AD  | VM   | 203  | 4    | 6G   | 80G    | 30   | High      |
| Ubuntu Server IT   | VM   | 204  | 2    | 2G   | 40G    | 30   | High      |
| OT Core            | VM   | 205  | 4    | 4G   | 60G    | 50   | High      |
| OT-ENG Station     | VM   | 206  | 2    | 2G   | 40G    | 50   | Medium    |
| Suricata Sensor    | VM   | 207  | 2    | 2G   | 20G    | 60   | Medium    |
| Bastion            | LXC  | 208  | 2    | 2G   | 20G    | 10   | High      |
| MISP (optional)    | VM   | 209  | 2    | 4G   | 60G    | 20   | Low       |

Total RAM ≈ 42G (sans MISP). Marge 8-10G pour Proxmox.

## ILM Wazuh

- Hot: 7 jours
- Warm: 14 jours
- Delete: 30 jours
- Compression activée

## PRA

- vzdump quotidien → storage externe (USB/NFS)
- Export config Proxmox: /etc/pve + /etc/network/interfaces
- Snapshots avant changements risqués, mais **un snapshot ne remplace jamais un backup vzdump**

## Flux inter-VLAN (via OPNsense)

Default deny, puis ouverture progressive:
- MGMT(10) → Proxmox: SSH/HTTPS bastion uniquement
- MGMT(10) → SOC(20): Admin Wazuh/TheHive/Cortex
- IT(30) → SOC(20): Agents Wazuh, syslog, WinRM
- DMZ(40) → SOC(20): Logs web, Suricata
- OT(50) → SOC(20): Logs OT, NTP/DNS si nécessaire
- SENSOR(60) → SOC(20): Export EVE JSON
- QUARANTINE(70) → SOC(20): Autorisé (analyse, forensic)
- OT(50) → Internet: Interdit ou très limité

## Build Timeline

| Week | Focus         | Deliverables                                    |
|------|---------------|-------------------------------------------------|
| 1    | Network       | vmbr2, OPNsense, bastion, initial PRA           |
| 2    | SOC core      | Wazuh, TheHive/Cortex, first log flows          |
| 3    | IT targets    | Windows AD, Ubuntu IT, Suricata, IT use cases  |
| 4    | DMZ           | Exposed services, web logs, webshell playbook   |
| 5    | OT            | OpenPLC+ScadaBR, OT-ENG, IT/OT flows, OT UCs   |
| 6    | Purple team   | KPIs, Atomic Red Team, maturity scoring         |