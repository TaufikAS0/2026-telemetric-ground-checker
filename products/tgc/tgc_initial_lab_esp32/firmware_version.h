#pragma once

// Embedded source of truth for the TGC Initial LAB firmware version,
// classic ESP32 build target (profile TGC_LAB_ESP32_4M).
// Version policy: every rebuilt artifact family gets its own version so BINs
// can never be confused with other profiles/releases. 0.2.0-initial.1 is a
// NEW version/tag that has never been used before — it can never overwrite
// the ESP32-S3 release 0.1.0-initial.1. The prerelease suffix marks the
// Initial LAB stage. No physical board is verified for this target.

#define TGC_BOOT_VERSION_MAJOR 0
#define TGC_BOOT_VERSION_MINOR 2
#define TGC_BOOT_VERSION_PATCH 0
#define TGC_BOOT_VERSION_PRERELEASE initial.1

#define TGC_BOOT_VERSION_STRINGIFY_(value) #value
#define TGC_BOOT_VERSION_STRINGIFY(value) TGC_BOOT_VERSION_STRINGIFY_(value)

#define TGC_BOOT_VERSION_BASE \
  TGC_BOOT_VERSION_STRINGIFY(TGC_BOOT_VERSION_MAJOR) "." \
  TGC_BOOT_VERSION_STRINGIFY(TGC_BOOT_VERSION_MINOR) "." \
  TGC_BOOT_VERSION_STRINGIFY(TGC_BOOT_VERSION_PATCH)

#ifdef TGC_BOOT_VERSION_PRERELEASE
#define FIRMWARE_VERSION TGC_BOOT_VERSION_BASE "-" TGC_BOOT_VERSION_STRINGIFY(TGC_BOOT_VERSION_PRERELEASE)
#else
#define FIRMWARE_VERSION TGC_BOOT_VERSION_BASE
#endif