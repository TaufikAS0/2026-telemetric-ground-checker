# Rules for AI in this repository (TGC — Telemetric Ground Checker firmware)

This repository holds the product firmware source of **TGC — Telemetric
Ground Checker** inside the Telemetric Hardware Portal ecosystem. Read the
vault first: `obsidian-portal-hardware/README.md` (routing), then its
`AGENTS.md`, `02_Rules/firmware-package-rules.md`, and
`02_Rules/device-bootstrap-standard.md`.

## Product identity

- `productCode`: `TGC`, `productName`: `Telemetric Ground Checker`.
- This repo is NOT TMM, TVG, TPM, HGC, TGC15, or TGC30. Do not copy another
  product's BIN, manifest, partition table, or flash config. The universal
  provisioning flow concept is shared; hardware facts are never shared.

## Hardware profile rules

- One profile per verified/declared hardware target. Current profiles:
  - `profiles/TGC_LAB_ESP32S3_16M` (ESP32-S3 / 16MB / quad→qio / tgc-ota-16mb),
    evidenced by read-only `esptool flash_id` on COM11, 2026-09-04 —
    **board-proven** (`hardware/board-detection-2026-09-04.md`).
  - `profiles/TGC_LAB_ESP32_4M` (classic ESP32 / 4MB / dio / tgc-ota-4mb) —
    an explicit **LAB build target** (owner decision 2026-09-04): compile
    options declared from the "ESP32 Dev Module" board definition
    (`esp32:esp32:esp32`), NO physical board verified. `build-target-declaration`.
- Every mandatory profile field must be CONFIRMED with evidence. `UNCONFIRMED`
  mandatory fields block every build, LAB included.
- Never guess: chip family, flash geometry, pins, partition layout, Ethernet,
  product identity, board markings. A board named "ESP32 Dev Module" proves
  nothing until read-only chip detection answers.
- Never build a package that spans chip families (no universal classic/S3 BIN).
- One hardware profile = one package = two BINs (merged/full for USB +
  app-only for OTA) + manifests, bound by one canonical
  `releaseId = <PRODUCT>-<version>-<buildId>` in ONE build run.
- Every artifact family gets its own version — never reuse or overwrite a
  version/release across profiles (S3: `0.1.0-initial.1`; classic:
  `0.2.0-initial.1`).
- The COM6 investigation is closed (owner instruction 2026-09-04); do not
  resume detection of that port.

## Build and release rules

- Official release builds refuse a dirty worktree
  (`scripts/assert-clean-worktree.mjs`). Commit source first, then build.
- `buildId = git rev-parse --short=7 HEAD`; `sourceCommit` = full hash. The
  version string in `firmware_version.h` is exactly the manifest version.
- BIN files NEVER enter Git history: release assets only. Build outputs are
  git-ignored.
- Each manifest lists the SHA-256 and byte size of its BIN, re-verified
  against the physical files after build.
- App-only BIN must fit its OTA slot (`partitions.csv`); verify sizes before
  handoff.
- Stage `lab` builds embed the owner-approved PUBLIC LAB factory Wi-Fi from
  `src/config/factory-wifi.mjs` (the only credential allowed in Git).
  Production builds refuse to run while `FACTORY_WIFI_IS_LAB_DEFAULT` is true
  (enforced in `src/core/stage-guard.mjs`, not prose).
- The LAB factory password must never appear in logs, tests, manifests,
  release notes, serial output, or documentation. OTA tokens are operator
  secrets set per device over the serial console and never leave the device.

## Firmware scope rules (TGC)

- Initial firmware = provisioning/discovery/OTA base only. It must NOT
  contain Ground Checker measurement, relay/output activation, or QC logic.
- Network identity is runtime-derived from the eFuse MAC (AP
  `TELEMETRIC-SETUP-<suffix>`, hostname `telemetric-tgc-<suffix>`,
  `deviceId` suffix) — two boards never share identity.
- OTA rollback under crash is NOT claimed unless the bootloader actually
  supports app-rollback (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`); the
  firmware reports `rollback-unavailable` honestly otherwise.
- Do not claim hardware readiness, QC PASS, or flash permission without a
  physical-device test record. Publishing/importing firmware is never flash
  approval; the local portal alone owns flashing.

## Registry duties

- Register this repo in `obsidian-portal-hardware/01_Registry/FIRMWARE_REPOS.md`
  before declaring ecosystem work complete (do not guess fields — use
  `UNCONFIRMED`).
- BIN handoff to `telemetric-firmware-library` goes through the library
  publish flow; this repo never publishes library manifests itself.

## Before finishing

1. `npm test` — all tests pass.
2. `npm run build:tgc-lab` — from a clean, committed worktree.
3. Verify manifest sizes/SHA-256 against the physical BINs.
4. Report remaining unknowns explicitly. Build success is not hardware proof.