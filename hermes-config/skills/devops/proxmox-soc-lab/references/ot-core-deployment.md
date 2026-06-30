# OT-Core (VM 305) Deployment Reference

## VM Configuration
- **VMID**: 305
- **Source**: Cloned from template 9000 (debian12-cloud-template, Coolify-derived)
- **CPU**: 4 vCPU
- **RAM**: 4 GB
- **Disk**: 60 GB (raw, resized from 3G template)
- **Network**: vmbr1 bypass (192.168.200.114/24, gw 192.168.200.1) — to be moved to vmbr3 VLAN 50 when OPNsense ready
- **BIOS**: SeaBIOS (template default)
- **SCSI**: virtio-scsi-pci
- **QEMU Agent**: enabled, active
- **Credentials**: root / SOClab2026!
- **SSH from Hermes**: `SSH_ASKPASS=/tmp/sshpass_305.sh SSH_ASKPASS_REQUIRE=force ssh root@192.168.200.114`

## Installed Software

### OpenPLC v4 (Modbus/TCP simulator)
- **Port**: 8443 (HTTPS REST API), 502 (Modbus TCP C backend)
- **Service**: `openplc-runtime.service` (enabled)
- **Auth**: admin/SOClab2026!, JWT via `POST /api/login`
- **Program**: Custom blink — Coils 0-1 toggle every second, Holding registers 0-1 increment as counters
- **Status**: RUNNING (not in safe-mode)

#### Key Pitfalls
- `.so` must export symbols: `config_run__`, `config_init__`, `glueVars`, `setBufferPointers`, etc. (NOT `Config0_run`)
- `compile.sh` outputs `new_libplc.so` — must rename to `libplc_<timestamp>.so`
- `start-plc` API does NOT exit safe-mode — use `systemctl restart openplc-runtime` after fixing .so
- API is HTTPS, not HTTP
- Modbus TCP 502 is served by C plc_main, not Python plugin
- Upload ZIP must contain C source files + `conf/modbus_slave_config.json`

### ScadaBR 1.2 (HMI/SCADA)
- **Tomcat 9** on port 8080 (NOT Tomcat 10 — javax namespace incompatibility)
- **DB**: MariaDB 10.11, database `scadabr`, user `scadabr`, password `ScadaBR2026!`
- **Default login**: admin/admin
- **Full automation reference**: See `references/scadabr-dwr-automation.md`

#### Configured Data Points ✅
- DP_Coil0 (ID=1) — coil_status offset 0, binary
- DP_Coil1 (ID=2) — coil_status offset 1, binary
- DP_Register0 (ID=5) — holding_register offset 0, 2byte_unsigned_int
- DP_Counter (ID=6) — holding_register offset 1, 2byte_unsigned_int

**NOTE**: Points 3-4 were originally created via DWR with wrong types (all Binary/Coil). Deleted and re-created as 5-6 using Selenium to set correct `range` and `modbusDataType`.

#### Configured HMI View ✅
- **Name**: SOC_OT_Dashboard, ID=1, XID=GV_SOC_OT_001
- **Components**: HTML title, 4 simple point components, section labels
- **Access**: `http://192.168.200.114:8080/ScadaBR/view.shtm?viewId=1`

#### ScadaBR Automation Lessons
1. **DWR2 Object_Object bug**: `saveModbusPointLocator` ignores enum properties (`range`, `modbusDataType`) — always defaults to 1 (Binary/Coil). Use Selenium + Chromium headless to configure non-binary types.
2. **View creation requires form POST**: DWR `addComponent` adds components in-memory only. View persists only when the page form is submitted.
3. **Selenium + Chromium on Debian**: `apt install chromium` + `pip3 install selenium`. Use `--headless=new` flag for Chrome 109+.

### Wazuh Agent — ACTIVE ✅
- Connected to Wazuh manager at 192.168.200.110

## Remaining Work
1. Enhance HMI view (analog graphics, trend charts)
2. Network migration vmbr1 → vmbr3 VLAN 50
3. Connect Wazuh to ScadaBR/OpenPLC for OT security monitoring