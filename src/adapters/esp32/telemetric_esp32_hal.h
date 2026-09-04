#pragma once

#include <Arduino.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <Update.h>
#include <WiFi.h>
#include <esp_ota_ops.h>

// ESP32 HAL for the Telemetric Device Bootstrap universal flow
// (Telemetric Device Bootstrap Standard, src/core/bootstrap.mjs).
//
// TGC scope: the Initial LAB firmware serves the ONE verified LAB profile
// only (profiles/TGC_LAB_ESP32S3_16M: ESP32-S3, 16MB, quad/qio, tgc-ota-16mb
// partition layout — board-proven via read-only esptool flash_id on COM11,
// 2026-09-04). The code uses the common ESP32 Arduino APIs, so a future
// classic-ESP32 profile can reuse this HAL — but until a classic board is
// verified by chip detection, NO classic build or claim is made.
// The factory Wi-Fi LAB default is injected by the product sketch from
// src/config/factory-wifi.mjs (generated header) — never hard-coded here.

struct TelemetricWifiCredentials {
  String ssid;
  String password;
};

struct TelemetricOtaBootState {
  bool pendingVerify = false;
};

class TelemetricEsp32Hal {
 public:
  // ---- lifecycle -----------------------------------------------------------

  bool begin() {
    if (!nvsWifi_.begin("tgc-wifi", false)) return false;
    nvsWifi_.end();
    if (!nvsOta_.begin("tgc-ota", false)) return false;
    nvsOta_.end();
    return true;
  }

  uint32_t now() { return millis(); }

  void reboot() {
    Serial.println(F("{\"bootstrap\":{\"event\":\"reboot\"}}"));
    delay(100);
    ESP.restart();
  }

  // ---- stable non-secret device identity ------------------------------------

  // Final six hexadecimal characters of the base MAC (eFuse). Two boards with
  // different MACs therefore never share an AP name, hostname, or deviceId.
  String deviceIdSuffix() {
    const uint64_t efuse = ESP.getEfuseMac();
    char suffix[7];
    snprintf(suffix, sizeof(suffix), "%02x%02x%02x",
             static_cast<unsigned>((efuse >> 16) & 0xFF),
             static_cast<unsigned>((efuse >> 8) & 0xFF),
             static_cast<unsigned>(efuse & 0xFF));
    return String(suffix);
  }

  // ---- Wi-Fi credentials (NVS, atomic best-effort) ---------------------------
  //
  // saveWifiCredentials writes both values and verifies their lengths; if the
  // second write fails, the first is erased so the pair is never half-stored.

  bool loadWifiCredentials(TelemetricWifiCredentials &out) {
    if (!nvsWifi_.begin("tgc-wifi", true)) return false;
    out.ssid = nvsWifi_.getString("ssid", "");
    out.password = nvsWifi_.getString("pass", "");
    nvsWifi_.end();
    return out.ssid.length() > 0;
  }

  bool saveWifiCredentials(const TelemetricWifiCredentials &credentials) {
    if (!nvsWifi_.begin("tgc-wifi", false)) return false;
    const bool saved = nvsWifi_.putString("ssid", credentials.ssid) == credentials.ssid.length()
      && nvsWifi_.putString("pass", credentials.password) == credentials.password.length();
    if (!saved) nvsWifi_.clear();
    nvsWifi_.end();
    return saved;
  }

  bool clearWifiCredentials() {
    if (!nvsWifi_.begin("tgc-wifi", false)) return false;
    const bool cleared = nvsWifi_.clear();
    nvsWifi_.end();
    return cleared;
  }

  // ---- station and fallback AP ----------------------------------------------

  bool tryStation(const TelemetricWifiCredentials &credentials, uint32_t timeoutMs) {
    WiFi.persistent(false);
    WiFi.mode(apOpen_ ? WIFI_AP_STA : WIFI_STA);
    WiFi.begin(credentials.ssid.c_str(), credentials.password.c_str());
    const uint32_t deadline = millis() + timeoutMs;
    while (static_cast<int32_t>(millis() - deadline) < 0) {
      if (WiFi.status() == WL_CONNECTED) return true;
      if (WiFi.status() == WL_CONNECT_FAILED) return false;
      delay(50);
    }
    return WiFi.status() == WL_CONNECTED;
  }

  bool startSetupAp(const String &deviceSuffix, String &ssidOut) {
    ssidOut = String("TELEMETRIC-SETUP-") + deviceSuffix;
    WiFi.persistent(false);
    WiFi.mode(apOpen_ ? WIFI_AP_STA : WIFI_AP);
    if (!WiFi.softAP(ssidOut.c_str())) return false;
    apOpen_ = true;
    return true;
  }

  bool isSetupApOpen() const { return apOpen_; }

  bool stopSetupAp() {
    const bool stopped = WiFi.softAPdisconnect(true);
    apOpen_ = false;
    WiFi.mode(WIFI_STA);
    return stopped;
  }

  void advertiseOnLan(const char *productCode, const char *hardwareRevision,
                      const char *firmwareVersion, const char *deviceIdSuffix) {
    String product = productCode;
    product.toLowerCase();
    const String hostname = String("telemetric-") + product + "-" + deviceIdSuffix;
    if (!MDNS.begin(hostname.c_str())) {
      Serial.println(F("{\"bootstrap\":{\"event\":\"mdns-failed\"}}"));
      return;
    }
    MDNS.addService("telemetric-ota", "tcp", 80);
    MDNS.addServiceTxt("telemetric-ota", "tcp", "productCode", productCode);
    MDNS.addServiceTxt("telemetric-ota", "tcp", "hwRev", hardwareRevision);
    MDNS.addServiceTxt("telemetric-ota", "tcp", "fwVer", firmwareVersion);
    MDNS.addServiceTxt("telemetric-ota", "tcp", "path", "/api/device-info");
    Serial.printf("{\"bootstrap\":{\"advertised\":true,\"hostname\":\"%s\",\"ip\":\"%s\"}}\n",
                  hostname.c_str(), WiFi.localIP().toString().c_str());
  }

  // ---- OTA boot state (persistent across reboots) ----------------------------

  bool loadOtaBootState(TelemetricOtaBootState &out) {
    if (!nvsOta_.begin("tgc-ota", true)) return false;
    out.pendingVerify = nvsOta_.getBool("pending", false);
    nvsOta_.end();
    return true;
  }

  bool markOtaPendingVerify() {
    if (!nvsOta_.begin("tgc-ota", false)) return false;
    const bool ok = nvsOta_.putBool("pending", true);
    nvsOta_.end();
    return ok;
  }

  // Healthy firmware: cancel the rollback and clear the pending flag.
  bool confirmOta() {
    if (!nvsOta_.begin("tgc-ota", false)) return false;
    const bool ok = nvsOta_.putBool("pending", false);
    nvsOta_.end();
#if defined(CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE) && CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE == 1
    esp_ota_mark_app_valid_cancel_rollback();
#else
    // Stock Arduino bootloaders usually build without app-rollback; the NVS
    // flag above is then the only pending-verify record. Hardware rollback
    // support stays UNCONFIRMED until a bootloader with the feature is proven.
#endif
    return ok;
  }

  // Failed boot/health: roll back to the previous slot. With a rollback-
  // capable bootloader this reboots straight into the old slot; without one
  // this records the request and reports failure honestly instead of faking
  // a slot switch. No crash-safe rollback is ever claimed unless the
  // bootloader feature is actually compiled in.
  bool rollbackOta() {
#if defined(CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE) && CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE == 1
    if (!nvsOta_.begin("tgc-ota", false)) return false;
    nvsOta_.putBool("pending", false);
    nvsOta_.end();
    esp_ota_mark_app_invalid_rollback_and_reboot();
    return true;  // not reached when the bootloader reboots
#else
    Serial.println(F("{\"ota\":{\"event\":\"rollback-unavailable\",\"reason\":\"bootloader_without_app_rollback\"}}"));
    return false;
#endif
  }

  // ---- A/B slot writer --------------------------------------------------------

  bool beginOta() {
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (!running) return false;
    // App-only images land in the inactive slot; a merged image cannot fit
    // and is rejected before any write.
    if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) return false;
    return Update.isRunning();
  }

  size_t writeOta(uint8_t *data, size_t length) {
    if (Update.write(data, length) != length) {
      abortOta();
      return 0;
    }
    return length;
  }

  bool abortOta() {
    if (Update.isRunning()) Update.abort();
    return true;
  }

  bool finishOta() { return Update.isRunning() && Update.end(true); }

 private:
  Preferences nvsWifi_;
  Preferences nvsOta_;
  bool apOpen_ = false;
};
