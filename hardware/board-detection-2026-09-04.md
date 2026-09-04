# Board detection record — 2026-09-04

Method: read-only chip detection. `esptool v4.5.1 flash_id` reads chip/flash
identity over the serial bootloader and never writes flash. Board marking
was not physically inspected in this session (reported UNCONFIRMED where not
recorded). Detection is recorded exactly as observed; nothing below is inferred.

## COM11 — IDENTIFIED (profile board)

| Field | Value | Evidence |
|---|---|---|
| COM port | `COM11` | `Win32_PnPEntity`: `USB-Enhanced-SERIAL CH343 (COM11)` |
| USB-UART bridge | CH343 | Windows device name (above) |
| Chip family | **ESP32-S3**, revision v0.2, features WiFi+BLE, 40MHz crystal | esptool `flash_id` output |
| MAC (base) | `e0:72:a1:f4:c0:a4` | esptool `flash_id` output |
| Flash size | **16MB** | esptool `flash_id` output (`Detected flash size: 16MB`, manufacturer 0x68 device 0x4018) |
| Flash mode | quad (4 data lines) → built as `qio` | esptool `flash_id` output (`Flash type set in eFuse: quad`) |
| Board marking | UNCONFIRMED | no physical inspection recorded |
| Profile | `TGC_LAB_ESP32S3_16M` | `profiles/TGC_LAB_ESP32S3_16M/profile.json` |
| Flash target status | candidate — **flash requires explicit owner approval** | this task does not flash |

Raw esptool output (COM11, 2026-09-04):

```text
esptool.py v4.5.1
Serial port COM11
Connecting....
Detecting chip type... ESP32-S3
Chip is ESP32-S3 (revision v0.2)
Features: WiFi, BLE
Crystal is 40MHz
MAC: e0:72:a1:f4:c0:a4
Uploading stub...
Running stub...
Stub running...
Manufacturer: 68
Device: 4018
Detected flash size: 16MB
Flash type set in eFuse: quad (4 data lines)
Hard resetting via RTS pin...
```

## COM6 — NOT IDENTIFIED (no profile, no package)

| Field | Value |
|---|---|
| COM port | `COM6` |
| USB-UART bridge | CH340 (`USB-SERIAL CH340 (COM6)`) |
| Chip family | UNCONFIRMED |
| MAC | UNCONFIRMED |
| Flash size | UNCONFIRMED |
| Board marking | UNCONFIRMED |
| Attempts | `esptool flash_id` twice (115200 and 74880 baud), both failed |

Failure (both attempts, identical):

```text
Connecting......................................
A fatal error occurred: Failed to connect to Espressif device: No serial data received.
```

Interpretation kept strictly factual: the device on COM6 did not answer the
Espressif ROM bootloader handshake. Possible causes include a non-Espressif
device on the adapter, a board that is unpowered/absent, a broken auto-reset
circuit, or a chip that requires a manual BOOT-button entry. None of these is
confirmed. Until COM6 answers a read-only detection, it must not be claimed as
ESP32 classic, ESP32-S3, or anything else — and it receives no firmware package.

## COM5 — out of scope

`STMicroelectronics STLink Virtual COM Port` — an STM32 debug probe, not an
ESP32 candidate. Recorded to avoid future confusion.

## Consequence for the build

- The requested "ESP32 classic / ESP32 Dev Module" target is NOT confirmed by
  physical evidence: one board is ESP32-S3, the other is undetectable.
- Per the task contract ("if identity shows ESP32-S3, do not force a classic
  build"; profiles need confirmed evidence), the Initial LAB package is built
  for the ONE verified profile: `TGC_LAB_ESP32S3_16M` (ESP32-S3 / 16MB / qio).
- A classic-ESP32 package is deliberately NOT produced. When a board answers
  read-only detection as ESP32 classic with a verified flash size, add its
  profile from `profiles/_template/profile.json` and build a separate package.
- Never flash a BIN of one profile onto a board of another profile.
