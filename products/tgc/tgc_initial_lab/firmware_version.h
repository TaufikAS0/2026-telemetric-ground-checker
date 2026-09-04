#pragma once

// Embedded source of truth for the TGC Initial LAB firmware version.
// The prerelease suffix marks the Initial LAB stage (0.1.0-initial.1):
// bootstrap/provisioning base firmware without any Ground Checker
// measurement or QC function. The version string is EXACTLY the runtime
// FIRMWARE_VERSION, so manifest, runtime identity, and releaseId agree.

#define TGC_BOOT_VERSION_MAJOR 0
#define TGC_BOOT_VERSION_MINOR 1
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
