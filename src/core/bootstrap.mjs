// Telemetric Device Bootstrap — universal connection state machine (core,
// TGC firmware repo). Pure logic only: every hardware interaction goes
// through the injected HAL, so product/hardware adapters stay separate from
// the universal flow (Telemetric Device Bootstrap Standard). This module
// never touches real radios and never logs credential values.

export const BOOTSTRAP_UI_NAME = "Telemetric Device Setup";
export const SETUP_AP_PREFIX = "TELEMETRIC-SETUP-";
export const SETUP_PORTAL_URL = "http://192.168.4.1/";

export const API_PATHS = Object.freeze({
  deviceInfo: "/api/device-info",
  provisioning: "/api/provisioning",
  provisioningClear: "/api/provisioning/clear",
  otaImage: "/api/ota/image",
  health: "/api/health"
});

export const WIFI_SSID_MAX_LENGTH = 32;
export const WIFI_PASSWORD_MAX_LENGTH = 63;

// XXXXXX / device-suffix come from a stable non-secret identifier such as the
// final six hexadecimal characters of the base MAC (adapter responsibility).
export function setupApSsid(deviceSuffix) {
  return `${SETUP_AP_PREFIX}${deviceSuffix}`;
}

export function hostnameFor(productCode, deviceSuffix) {
  return `telemetric-${String(productCode).toLowerCase()}-${deviceSuffix}`;
}

export function validateCredentials(credentials) {
  if (!credentials || typeof credentials.ssid !== "string" || !credentials.ssid.trim()) {
    return "ssid is required";
  }
  if (credentials.ssid.length > WIFI_SSID_MAX_LENGTH) return "ssid too long";
  if (credentials.password !== undefined && credentials.password !== null) {
    if (typeof credentials.password !== "string") return "password must be a string";
    if (credentials.password.length > WIFI_PASSWORD_MAX_LENGTH) return "password too long";
  }
  return null;
}

// HAL contract (implemented per product/hardware adapter):
//   deviceIdSuffix() -> "a1b2c3"              stable non-secret suffix
//   loadWifiCredentials() -> credentials|null persisted operator credentials
//   saveWifiCredentials(credentials)          atomic NVS write
//   clearWifiCredentials()                    erase NVS, fall back to factory
//   tryStation(credentials, timeoutMs) -> bool  non-blocking connect attempt
//   startSetupAp(deviceSuffix) -> { ssid, ip }  unique fallback AP
//   isSetupApOpen?() -> boolean                whether the AP is actually up
//   stopSetupAp()                             close the fallback AP
//   advertiseOnLan()                          identity + OTA on the LAN
//   loadOtaBootState() -> { pendingVerify }   persistent OTA boot metadata
//   markOtaPendingVerify()                    persist before the OTA reboot
//   beginOta() / abortOta()                   inactive-slot image writer
//   confirmOta() / rollbackOta()              health confirmation / rollback
//   reboot()
export class TelemetricBootstrap {
  constructor({ hal, config }) {
    if (!hal) throw new Error("hal is required");
    this.hal = hal;
    this.config = {
      stationTimeoutMs: 15000,
      factoryWifi: null, // LAB default lives in src/config; production injects secrets
      ...config
    };
    this.state = "boot";
    this.lastError = null;
    this.apInfo = null;
    this.otaActive = false;
    this.otaPendingVerify = false;
    this.log = [];
  }

  #transition(state) {
    this.state = state;
    this.log.push({ state, at: this.hal.now?.() ?? null });
  }

  // Universal boot order: stored NVS -> factory/bootstrap Wi-Fi -> setup AP.
  async boot() {
    // Persistent OTA boot metadata survives the reboot (pending-verify).
    const otaState = await this.hal.loadOtaBootState();
    this.otaPendingVerify = Boolean(otaState?.pendingVerify);
    this.otaActive = false;

    this.#transition("connecting-stored");
    const stored = await this.hal.loadWifiCredentials();
    if (stored && (await this.hal.tryStation(stored, this.config.stationTimeoutMs))) {
      return this.#enterLan("stored");
    }

    const factory = this.config.factoryWifi;
    if (factory) {
      this.#transition("connecting-factory");
      if (await this.hal.tryStation(factory, this.config.stationTimeoutMs)) {
        // The factory value becomes the persisted first-priority credential.
        await this.hal.saveWifiCredentials(factory);
        return this.#enterLan("factory");
      }
    }

    this.#transition("setup-ap");
    this.apInfo = await this.hal.startSetupAp(this.hal.deviceIdSuffix());
    return { ok: false, state: this.state, ap: this.apInfo, portalUrl: SETUP_PORTAL_URL };
  }

  // POST /api/provisioning: validate, persist atomically, then reboot.
  // The universal boot flow re-tests the new stored credentials first, so a
  // successful provisioning lands online while a failure re-opens the AP
  // automatically. The open setup AP is closed by #enterLan through the HAL
  // (apInfo is kept until that real closure, never cleared early).
  async provision(credentials) {
    if (this.state !== "setup-ap") {
      return { ok: false, error: "not_in_setup_mode", state: this.state };
    }
    const invalid = validateCredentials(credentials);
    if (invalid) {
      this.lastError = invalid;
      return { ok: false, error: invalid, state: this.state };
    }
    await this.hal.saveWifiCredentials(credentials);
    await this.hal.reboot();
    this.state = "boot";
    return this.boot();
  }

  // POST /api/provisioning/clear: erase stored credentials and fall back to
  // the factory Wi-Fi (or the setup AP when the factory network is gone).
  // Any open setup AP is closed by #enterLan once the LAN is actually up.
  async clearProvisioning() {
    await this.hal.clearWifiCredentials();
    this.state = "boot";
    return this.boot();
  }

  async #enterLan(via) {
    // Close the setup AP for real before declaring the LAN session online.
    // Two independent signals guard this: the HAL's own AP state (when the
    // adapter implements isSetupApOpen) and this core's apInfo bookkeeping,
    // which is only cleared AFTER stopSetupAp succeeds — never before.
    const halReportsOpen = (await this.hal.isSetupApOpen?.()) === true;
    if (halReportsOpen || this.apInfo !== null) {
      await this.hal.stopSetupAp();
      this.apInfo = null;
    }
    this.#transition("online");
    this.lastError = null;
    await this.hal.advertiseOnLan();
    return { ok: true, state: this.state, via };
  }

  // Reboot path: the universal order restarts at stored NVS credentials, so a
  // provisioned device never re-opens the AP unless the network disappears.
  async reboot() {
    await this.hal.reboot();
    return this.boot();
  }

  // Reopen setup mode after repeated LAN failures without erasing NVS.
  async reopenSetupMode() {
    this.#transition("setup-ap");
    this.apInfo = await this.hal.startSetupAp(this.hal.deviceIdSuffix());
    return { ok: false, state: this.state, ap: this.apInfo, portalUrl: SETUP_PORTAL_URL };
  }

  // A/B OTA lifecycle: begin writes the inactive slot, finish persists the
  // pending-verify flag BEFORE rebooting, then health confirm or rollback.
  async beginOta() {
    if (this.state !== "online") {
      return { ok: false, error: "not_online", state: this.state };
    }
    if (this.otaActive) {
      return { ok: false, error: "ota_already_active", state: this.state };
    }
    await this.hal.beginOta();
    this.otaActive = true;
    return { ok: true, state: "ota-writing" };
  }

  async abortOta() {
    if (!this.otaActive) {
      return { ok: false, error: "ota_not_started", state: this.state };
    }
    await this.hal.abortOta();
    this.otaActive = false;
    return { ok: true, state: this.state };
  }

  async finishOta({ imageValid }) {
    if (!this.otaActive) {
      return { ok: false, error: "ota_not_started", state: this.state };
    }
    this.otaActive = false;
    if (!imageValid) {
      await this.hal.abortOta();
      return { ok: false, state: this.state };
    }
    // Persist first: a crash right after the reboot must still roll back.
    await this.hal.markOtaPendingVerify();
    this.otaPendingVerify = true;
    await this.hal.reboot();
    return { ok: true, state: "ota-pending-verify" };
  }

  // Healthy firmware confirms the new slot.
  async confirmHealth() {
    if (!this.otaPendingVerify) {
      return { ok: false, error: "no_pending_verify", state: this.state };
    }
    await this.hal.confirmOta();
    this.otaPendingVerify = false;
    return { ok: true, state: "ota-confirmed" };
  }

  // Failed boot/health check rolls back to the previous slot.
  async reportUnhealthy() {
    if (!this.otaPendingVerify) {
      return { ok: false, error: "no_pending_verify", state: this.state };
    }
    await this.hal.rollbackOta();
    this.otaPendingVerify = false;
    return { ok: true, state: "ota-rolled-back" };
  }
}
