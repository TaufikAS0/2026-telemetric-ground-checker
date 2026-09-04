# Handoff — TGC Initial LAB package (for GLM superior / firmware library)

Build date: 2026-09-04. Built from a clean, committed worktree by
`scripts/build-tgc-lab.ps1` (arduino-cli 1.5.0, esp32:esp32 core 3.3.10,
fqbn `esp32:esp32:esp32s3:FlashSize=16M,FlashMode=qio,PartitionScheme=custom`).

## Package identity

| Field | Value |
|---|---|
| productCode | `TGC` (Telemetric Ground Checker) |
| firmwareRole | `bootstrap` (Initial firmware: provisioning/discovery/OTA base, no measurement/QC) |
| stage | `lab` |
| version | `0.1.0-initial.1` |
| profileId | `TGC_LAB_ESP32S3_16M` |
| chipFamily | `ESP32-S3` |
| flashSize / flashMode | `16MB` / `qio` |
| partitionScheme | `tgc-ota-16mb` (nvs 0x9000/0x5000, otadata 0xe000/0x2000, ota_0 0x10000/0x300000, ota_1 0x310000/0x300000, coredump 0x610000/0x10000) |
| sourceRepository | https://github.com/TaufikAS0/2026-telemetric-ground-checker |
| sourceCommit | `04062b9f95a899de302ddd54d08d157966c15277` |
| buildId | `04062b9` |
| releaseId | `TGC-0.1.0-initial.1-04062b9` |
| releaseTag | `TGC-v0.1.0-initial.1` |

## Artifacts (build output dir: `products/tgc/build/tgc_initial_lab/`)

| Artifact | File | Size | SHA-256 |
|---|---|---|---|
| merged/full (USB, offset 0) | `tgc_initial_lab.ino.merged.bin` | 16,777,216 | `24d910571e28b26c91acf6dde8939612526c0a06640617eb9a11260a2e98f2bc` |
| app-only (OTA, offset 0x10000) | `tgc_initial_lab.ino.bin` | 980,752 | `512965a3124f07dba6fd975b301ad67bdf67202928d6189a98fd16c7b5648186` |

- Slot check: app 980,752 ≤ 3,145,728 bytes (`ota_0`/`ota_1` = 0x300000) — fits.
- Library manifests for handoff: `manifest-full.json`, `manifest-app-only.json`
  (same directory; shared fields identical, one `releaseId`).
- Both BINs come from the same build run and the same source commit.

## Device contract (portal-compatible, verified against portal source)

- Discovery: `GET /api/device-info` → productCode/deviceId/chipFamily/
  hardwareRevision/firmwareVersion/flashSize ("16MB")/otaSupported/otaPort(80)/
  otaPath (`/api/ota/image`).
- Provisioning: `POST /api/provisioning` (form ssid/password) +
  `POST /api/provisioning/clear`; setup portal at `http://192.168.4.1/`.
- OTA: `POST /api/ota/image`, multipart file part, `Authorization: Bearer
  <token>` (token set once per device via serial `ota-token-set`), app-only
  image into the inactive A/B slot, persistent pending-verify, 15s
  stability confirm. Crash-rollback NOT claimed (stock Arduino bootloader;
  honest `rollback-unavailable` reporting).
- AP fallback `TELEMETRIC-SETUP-<mac-suffix>` closes after LAN success.
- mDNS: `_telemetric-ota._tcp` + TXT productCode/hwRev/fwVer/path.

## Board detection (2026-09-04, read-only; no flash write)

| Port | Bridge | Result |
|---|---|---|
| COM11 | CH343 | **ESP32-S3 rev v0.2**, MAC `e0:72:a1:f4:c0:a4`, flash **16MB**, quad. Profiled. Flash candidate — **requires owner approval**. |
| COM6 | CH340 | UNIDENTIFIED — esptool connect failed twice ("No serial data received", 115200 + 74880 baud). chip/MAC/flash UNCONFIRMED. No profile, no package. |
| COM5 | STLink | STM32 debug probe — out of scope. |

## Flash approval request (do NOT flash without owner confirmation)

Candidate target: **COM11, MAC e0:72:a1:f4:c0:a4, ESP32-S3/16MB**, merged BIN
over USB. The COM6 board cannot receive any package from this run.

## Remaining unknowns

See `profiles/TGC_LAB_ESP32S3_16M/profile.json` → `unknowns` and
`hardware/board-detection-2026-09-04.md`: COM6 identity, vendor PCB marking,
PSRAM/part number, Ethernet, physical setup control, bootloader rollback
support, and all physical flash/provision/OTA behaviour (pending live LAB
verification).