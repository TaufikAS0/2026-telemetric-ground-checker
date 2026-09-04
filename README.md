# TGC — Telemetric Ground Checker — Firmware Source

Product firmware repository of **TGC — Telemetric Ground Checker**
(`productCode: TGC`) inside the Telemetric Hardware Portal ecosystem.

Current artifact family: **Initial LAB firmware** (`0.1.0-initial.1`) — the
provisioning / discovery / OTA base. It deliberately contains **no** Ground
Checker measurement, relay/output, or QC function.

GitHub: https://github.com/TaufikAS0/2026-telemetric-ground-checker

## Verified hardware profile

| Field | Value | Evidence |
|---|---|---|
| profileId | `TGC_LAB_ESP32S3_16M` | this repo (`profiles/TGC_LAB_ESP32S3_16M/profile.json`) |
| chipFamily | `ESP32-S3` (rev v0.2) | read-only `esptool flash_id`, COM11, 2026-09-04 |
| MAC of profiled board | `e0:72:a1:f4:c0:a4` | same detection |
| flashSize / flashMode | `16MB` / `qio` (quad) | same detection |
| partitionScheme | `tgc-ota-16mb` (3MB A/B slots) | `products/tgc/tgc_initial_lab/partitions.csv` |

**Important honesty note:** the task requested ESP32 classic / "ESP32 Dev
Module", but read-only chip detection proved the profiled board is an
**ESP32-S3**, and the second board (COM6) never answered the bootloader
handshake (chip identity UNCONFIRMED). Per the bootstrap rules, the build
follows verified identity, not the label: there is **no** classic-ESP32 build
in this repo yet. See `hardware/board-detection-2026-09-04.md`.

## Repository layout

```text
AGENTS.md                          repo rules for humans and AI
profiles/                          hardware profiles (UNCONFIRMED blocks builds)
  _template/profile.json           starting point for a new profile
  TGC_LAB_ESP32S3_16M/profile.json verified LAB profile + evidence + unknowns
src/core/                          universal bootstrap state machine + manifest
src/config/factory-wifi.mjs        owner-approved PUBLIC LAB factory Wi-Fi (only credential allowed in Git)
src/adapters/esp32/                ESP32 HAL (telemetric_esp32_hal.h)
products/tgc/tgc_initial_lab/      firmware Initial sketch + partitions + version
scripts/                           build / manifest / clean-worktree tooling
tests/                             behavioural tests (node --test)
hardware/board-detection-2026-09-04.md  board detection record (evidence)
```

## Prerequisites

- Node.js >= 20 (tests + manifest tooling)
- `arduino-cli` on PATH
- ESP32 core: `arduino-cli core install esp32:esp32` (built with 3.3.10)

## Clone

```powershell
git clone https://github.com/TaufikAS0/2026-telemetric-ground-checker.git
cd 2026-telemetric-ground-checker
```

## Build (USB + OTA, one run, one releaseId)

```powershell
npm test                 # behavioural tests must pass
npm run build:tgc-lab    # commit first: the script refuses a dirty worktree
```

Output in `products/tgc/build/tgc_initial_lab/`:

| File | Purpose |
|---|---|
| `tgc_initial_lab.ino.merged.bin` | **merged/full** — flash over USB (bootloader + partition table + app) |
| `tgc_initial_lab.ino.bin` | **app-only** — OTA/LAN update image |
| `manifest.json` | build manifest binding both BINs to one `releaseId` |
| `manifest-full.json` | firmware-library manifest for the merged BIN (handoff) |
| `manifest-app-only.json` | firmware-library manifest for the app BIN (handoff) |

The build script prints each artifact's SHA-256 and byte size and re-verifies
them against the physical files before the package is declared complete.

## Flash over USB (first installation / recovery)

The merged/full BIN is written at offset 0x00 with the bootloader. After the
owner approves the target:

```powershell
arduino-cli upload -p COM11 --fqbn esp32:esp32:esp32s3:FlashSize=16M,FlashMode=qio,PartitionScheme=custom --input-dir products/tgc/build/tgc_initial_lab
```

or, with esptool (merged BIN already contains everything):

```powershell
python -m esptool --chip esp32s3 --port COM11 --baud 460800 write_flash 0x0 tgc_initial_lab.ino.merged.bin
```

Flash only onto a board whose read-only detection matches the profile
(ESP32-S3, 16MB). Never flash this BIN onto classic ESP32 or another profile.

## Two boards, one package, unique runtime identity

The package above is built for the ONE verified profile. Because unit
identity is derived at **runtime** from the eFuse base MAC, the SAME package
serves multiple identical boards without rebuilding:

| Board | AP fallback | Hostname | deviceId |
|---|---|---|---|
| board with MAC ending `…f4:c0:a4` | `TELEMETRIC-SETUP-f0c0a4`* | `telemetric-tgc-f0c0a4`* | `f0c0a4`* |

\* suffix = final six hex characters of the base MAC, computed at boot —
every unit is unique by construction; no two boards share an AP name,
hostname, or deviceId. The COM6 board stays out of scope until it answers
read-only chip detection; if it is ever identified as classic ESP32 with a
different flash size, it needs its **own profile and separate package** (no
universal BIN across chip families).

## First boot and provisioning flow

1. Stored NVS Wi-Fi is tried first (`tgc-wifi` namespace).
2. If absent/failed: factory LAB Wi-Fi (owner-approved public LAB value,
   embedded in LAB BINs only) is tried; on success it is persisted to NVS.
3. If still offline: fallback AP `TELEMETRIC-SETUP-<suffix>` opens.
4. Operator opens `http://192.168.4.1/`, enters network credentials → saved
   to NVS → device reboots → AP closes on LAN success (contract: AP stops
   after successful provisioning).
5. Device advertises via mDNS `_telemetric-ota._tcp` and answers the LAN
   scanner at `GET /api/device-info`.

## Device API (portal contract)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/device-info` | GET | identity: productCode, productName, deviceId, hardwareRevision, firmwareVersion, chipFamily, flashSize, flashMode, partitionScheme, ip, otaSupported, otaPort, otaPath |
| `/api/health` | GET | state, uptime, OTA pending-verify |
| `/api/provisioning` | POST | form-encoded `ssid`+`password` → NVS → reboot |
| `/api/provisioning/clear` | POST | erase NVS → factory fallback |
| `/api/ota/image` | POST | multipart app-only image, `Authorization: Bearer <token>` required |

Serial console (115200): `info`, `health`, `wifi-clear`, `ota-confirm`,
`ota-rollback`, `ota-token-set <token>`, `ota-token-clear`, `help`. Tokens
and passwords are never echoed.

## OTA update (after provisioning)

1. Set a token once over serial: `ota-token-set <8..64 chars>`.
2. Portal (or curl) posts the **app-only** BIN to `http://<ip>/api/ota/image`
   with `Authorization: Bearer <token>`.
3. Image lands in the inactive A/B slot; pending-verify is persisted **before**
   the reboot; after 15s of stable runtime the slot is confirmed.
4. Rollback honesty: without a bootloader compiled with
   `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`, crash-rollback is NOT claimed;
   the device reports `rollback-unavailable` and keeps the NVS pending flag.
   USB recovery stays available in every case.

## Configuration example (factory LAB Wi-Fi)

The LAB factory credential is a single tracked source of truth
(`src/config/factory-wifi.mjs`), generated into a header at build time. To
point a LAB build at a different LAB access point, edit only that file and
rebuild; never duplicate the value into sketches, logs, or manifests:

```js
export const FACTORY_WIFI = Object.freeze({ ssid: "<lab-ssid>", password: "<lab-pass>" });
export const FACTORY_WIFI_IS_LAB_DEFAULT = true;
```

`FACTORY_WIFI_IS_LAB_DEFAULT = true` blocks any `stage=production` build —
the guard is code, not documentation. Production devices must never embed
this value.

## Tests

```powershell
npm test
```

Covers: provisioning order (NVS → factory → setup AP), AP close-after-LAN
contract, OTA pending-verify persistence + confirm/rollback guards, profile
validation (UNCONFIRMED blocks builds), canonical releaseId, dual-artifact
manifest integrity, stage guard, partition-table sanity, scope guard (no
measurement/QC code in Initial firmware).

## Release contract

One version = one package = two BINs + two library manifests under one
`releaseId` (canonical: `TGC-<version>-<buildId>`). Both artifacts of a
release come from the same source commit and build run. BINs live in release
assets (handled by the firmware library), never in Git history.