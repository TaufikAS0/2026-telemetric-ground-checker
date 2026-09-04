// ===========================================================================
// LAB DEFAULT — NOT FOR PRODUCTION
// ===========================================================================
// The device owner explicitly decided (2026-08-31, recorded in the
// 2026-telemetric-device-bootstrap repository) to publish this factory Wi-Fi
// credential as a PUBLIC lab convenience value:
//   - it is tracked in Git and stays in Git history forever;
//   - it is embedded in every LAB firmware BIN built from this repo;
//   - anyone who can read this repository can read it;
//   - treat the LAB network as untrusted by design.
//
// This is the SAME owner-approved LAB value defined in the official source of
// truth: 2026-telemetric-device-bootstrap/src/config/factory-wifi.mjs.
// It is the only credential permitted in Git. Production credentials,
// per-unit credentials, and OTA tokens remain forbidden in Git, manifests,
// release notes, and logs. Before production this default MUST be removed or
// replaced by per-unit secret injection, and real credentials must be
// provisioned through POST /api/provisioning.
// Never print FACTORY_WIFI.password to serial logs, test output, or errors.

export const FACTORY_WIFI = Object.freeze({
  ssid: "UntukMasyarakatMiskin",
  password: "UTANGgaji"
});

// Documentation flag consumed by tests and build guards so a production
// profile cannot silently inherit the LAB default.
export const FACTORY_WIFI_IS_LAB_DEFAULT = true;
