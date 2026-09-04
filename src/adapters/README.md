# Adapters (HAL)

Hardware abstraction for the universal bootstrap flow
(`src/core/bootstrap.mjs`). The core never touches radios, flash, or NVS
directly — every hardware interaction goes through the injected HAL, so
product adapters never fork the universal flow.

## Contract (`src/adapters/esp32/telemetric_esp32_hal.h`)

| HAL method | Responsibility |
|---|---|
| `deviceIdSuffix()` | stable non-secret identity from the eFuse base MAC (final 6 hex chars) |
| `loadWifiCredentials` / `saveWifiCredentials` / `clearWifiCredentials` | atomic NVS credential store (`tgc-wifi` namespace) |
| `tryStation(credentials, timeoutMs)` | bounded station connect attempt |
| `startSetupAp(suffix)` / `isSetupApOpen()` / `stopSetupAp()` | unique fallback AP lifecycle |
| `advertiseOnLan(...)` | mDNS `_telemetric-ota._tcp` advertisement + TXT records |
| `loadOtaBootState()` / `markOtaPendingVerify()` | OTA pending-verify persisted across reboots (`tgc-ota` namespace) |
| `beginOta()` / `writeOta()` / `abortOta()` / `finishOta()` | A/B inactive-slot image writer |
| `confirmOta()` / `rollbackOta()` | health confirmation / honest rollback (no fake slot switch without bootloader support) |
| `reboot()` | controlled restart |

## Rules

- The HAL never contains credentials. The LAB factory Wi-Fi value is
  generated from `src/config/factory-wifi.mjs` by the build script and
  included by the product sketch only.
- One HAL per hardware family. A new chip family or flash geometry needs a
  new verified profile and its own build — never edit the profile of an
  already-built package.