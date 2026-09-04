# Handoff — TGC Initial LAB package, classic ESP32 BUILD TARGET

Build date: 2026-09-04. Built from a clean, committed worktree by
`scripts/build-tgc-lab-esp32.ps1` (arduino-cli 1.5.0, esp32:esp32 core
3.3.10, fqbn `esp32:esp32:esp32:FlashSize=4M,FlashMode=dio,PartitionScheme=custom`).

## Nature of this package (read first)

This package was created from a **BUILD TARGET decision** (owner instruction
2026-09-04), **not** from physical board identification. No board was
connected or flashed for this profile; the previously unidentified COM6
device is closed for investigation (owner instruction) and stays UNCONFIRMED.
The pending work is hardware testing, not package creation. The ESP32-S3
package (`TGC-0.1.0-initial.1-24113fe`, see `docs/HANDOFF.md`) remains the
only board-verified package and is untouched by this build.

## Package identity

| Field | Value |
|---|---|
| productCode | `TGC` (Telemetric Ground Checker) |
| firmwareRole | `bootstrap` (Initial firmware: provisioning/discovery/OTA base, no measurement/QC) |
| stage | `lab` |
| version | `0.2.0-initial.1` (new version/tag; cannot overwrite the S3 release) |
| profileId | `TGC_LAB_ESP32_4M` (LAB design target designation) |
| chipFamily | `ESP32` (classic, non-S3) |
| flashSize / flashMode | `4MB` / `dio` (declared from the "ESP32 Dev Module" board definition menu) |
| compile fqbn | `esp32:esp32:esp32:FlashSize=4M,FlashMode=dio,PartitionScheme=custom` |
| partitionScheme | `tgc-ota-4mb` (nvs 0x9000/0x5000, otadata 0xe000/0x2000, ota_0 0x10000/0x1E0000, ota_1 0x1F0000/0x1E0000, coredump 0x3D0000/0x10000) |
| sourceRepository | https://github.com/TaufikAS0/2026-telemetric-ground-checker |
| sourceCommit | `cdd19457f7af18ee883c96cab26eace8c7f6650a` |
| buildId | `cdd1945` |
| releaseId | `TGC-0.2.0-initial.1-cdd1945` |
| releaseTag | `TGC-v0.2.0-initial.1` |

## Artifacts (build output dir: `products/tgc/build/tgc_initial_lab_esp32/`)

| Artifact | File | Size | SHA-256 |
|---|---|---|---|
| merged/full (USB, offset 0) | `tgc_initial_lab_esp32.ino.merged.bin` | 4,194,304 | `1073857fdb867b872c5ed936c6da8afa191f725e9ce6b7b34d8bb1682ebb5594` |
| app-only (OTA, offset 0x10000) | `tgc_initial_lab_esp32.ino.bin` | 998,704 | `6fd37920004bd9e4e2359917f178dfd838b443a0839403e5b54aaec9972a737d` |

- Slot check: app 998,704 ≤ 1,966,080 bytes (`ota_0`/`ota_1` = 0x1E0000) — fits
  with ~49% headroom. Bootloader (23,520 B) + partition table fit below 0x9000.
- Library manifests for handoff: `manifest-full.json`, `manifest-app-only.json`
  (same directory; shared fields identical, one `releaseId`).
- Both BINs come from the same build run and the same source commit.
- Sizes and SHA-256 re-verified independently (Get-FileHash) after the build.

## Device contract (identical universal contract as the S3 package)

- Discovery: `GET /api/device-info` (productCode/deviceId/chipFamily — runtime
  `ESP.getChipModel()` — /hardwareRevision/firmwareVersion/flashSize ("4MB")/
  flashMode/partitionScheme/otaSupported/otaPort(80)/otaPath (`/api/ota/image`)).
- Provisioning: `POST /api/provisioning` + `POST /api/provisioning/clear`;
  setup portal `http://192.168.4.1/`; AP `TELEMETRIC-SETUP-<mac-suffix>`
  closes after LAN success; identity derived at runtime from the eFuse MAC.
- OTA: `POST /api/ota/image`, multipart, `Authorization: Bearer <token>`
  (token via serial `ota-token-set`), app-only image into the inactive A/B
  slot, persistent pending-verify, 15s stability confirm. Crash-rollback NOT
  claimed (stock Arduino bootloader; honest `rollback-unavailable` reporting).
- mDNS: `_telemetric-ota._tcp` + TXT productCode/hwRev/fwVer/path.

## Flash prerequisites (when a physical classic board appears)

- Read-only chip detection must answer classic ESP32 with 4MB flash first
  (`esptool flash_id` — no flash write). A mismatched board must never
  receive this BIN.
- USB: `arduino-cli upload -p <COM> --fqbn
  esp32:esp32:esp32:FlashSize=4M,FlashMode=dio,PartitionScheme=custom
  --input-dir products/tgc/build/tgc_initial_lab_esp32` — after owner approval.
- No flash target is claimed by this document; nothing was flashed.

## Remaining unknowns

See `profiles/TGC_LAB_ESP32_4M/profile.json` → `unknowns`: no physical board
verified for this target, vendor marking, PSRAM/part number, Ethernet, setup
control, bootloader rollback support, and all physical flash/provision/OTA
behaviour (pending live LAB verification).