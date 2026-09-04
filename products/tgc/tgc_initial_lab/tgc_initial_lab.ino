#include <Arduino.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>
#include <esp_ota_ops.h>

#include <factory_wifi_lab.h>
#include <telemetric_esp32_hal.h>
#include <firmware_version.h>

// TGC — Telemetric Ground Checker — Initial LAB firmware.
//
// Scope guard: this sketch implements the universal Telemetric Device
// Bootstrap flow (provisioning, discovery, OTA) for the ONE verified LAB
// profile only (TGC_LAB_ESP32S3_16M: ESP32-S3 / 16MB / qio / tgc-ota-16mb,
// board-proven via read-only esptool flash_id on COM11, 2026-09-04). It is
// not a universal BIN and makes no claim about other hardware, including
// ESP32 classic (no classic board is verified; no classic build exists).
// The factory Wi-Fi value is the owner-approved PUBLIC LAB default
// (generated from src/config/factory-wifi.mjs); production profiles must
// inject secrets instead — the generated header's static_assert blocks this
// sketch outside the LAB.
//
// This Initial firmware deliberately contains NO Ground Checker measurement,
// relay/output, or QC function. Any pin/output activation would be a defect.

static const char *const kProductCode = "TGC";
static const char *const kProductName = "Telemetric Ground Checker";
static const char *const kHardwareRevision = "TGC_LAB_ESP32S3_16M";
static const char *const kPartitionScheme = "tgc-ota-16mb";
static const char *const kFirmwareVersion = FIRMWARE_VERSION;

static constexpr uint32_t kStationTimeoutMs = 15000;
static constexpr uint32_t kStabilityConfirmMs = 15000;
static constexpr size_t kOtaTokenMinLength = 8;
static constexpr size_t kOtaTokenMaxLength = 64;
static constexpr size_t kCommandBufferLength = 128;

TelemetricEsp32Hal hal;
DNSServer dnsServer;
WebServer webServer(80);
String commandBuffer;

struct BootState {
  String apSsid;
  bool apOpen = false;
  bool online = false;
  bool otaActive = false;
  bool otaPendingVerify = false;
  uint32_t stabilityStartMs = 0;
  uint32_t restartAtMs = 0;
} state;

String deviceSuffix;

// ---------------------------------------------------------------------------
// Universal boot order (mirror of src/core/bootstrap.mjs):
//   stored NVS -> factory Wi-Fi LAB -> TELEMETRIC-SETUP-<suffix> AP
// ---------------------------------------------------------------------------

void enterLan(const char *via) {
  if (state.apOpen) {
    hal.stopSetupAp();  // real closure; the flag is only cleared after it
    dnsServer.stop();
    state.apOpen = false;
    state.apSsid = "";
  }
  state.online = true;
  hal.advertiseOnLan(kProductCode, kHardwareRevision, kFirmwareVersion, deviceSuffix.c_str());
  Serial.printf("{\"bootstrap\":{\"online\":true,\"via\":\"%s\",\"ip\":\"%s\"}}\n",
                via, WiFi.localIP().toString().c_str());
}

void startSetupMode() {
  state.online = false;
  if (!hal.startSetupAp(deviceSuffix, state.apSsid)) {
    Serial.println(F("{\"bootstrap\":{\"event\":\"soft_ap_failed\"}}"));
    return;
  }
  state.apOpen = true;
  dnsServer.start(53, "*", WiFi.softAPIP());
  Serial.printf("{\"bootstrap\":{\"setupAp\":true,\"ssid\":\"%s\",\"url\":\"http://192.168.4.1/\"}}\n",
                state.apSsid.c_str());
}

void loadOtaBootState() {
  TelemetricOtaBootState otaState;
  if (hal.loadOtaBootState(otaState)) {
    state.otaPendingVerify = otaState.pendingVerify;
    if (state.otaPendingVerify) {
      Serial.println(F("{\"ota\":{\"state\":\"pending-verify\",\"restored\":true}}"));
      state.stabilityStartMs = millis();
    }
  }
}

void boot() {
  state.online = false;
  loadOtaBootState();

  TelemetricWifiCredentials stored;
  if (hal.loadWifiCredentials(stored)) {
    Serial.println(F("{\"bootstrap\":{\"step\":\"try-stored\"}}"));
    if (hal.tryStation(stored, kStationTimeoutMs)) {
      enterLan("stored");
      return;
    }
  }

  Serial.println(F("{\"bootstrap\":{\"step\":\"try-factory\"}}"));
  TelemetricWifiCredentials factory{kFactoryWifiCredentials.ssid, kFactoryWifiCredentials.password};
  if (hal.tryStation(factory, kStationTimeoutMs)) {
    // Factory value becomes the persisted first-priority credential.
    hal.saveWifiCredentials(factory);
    enterLan("factory");
    return;
  }

  Serial.println(F("{\"bootstrap\":{\"step\":\"setup-ap\"}}"));
  startSetupMode();
}

// ---------------------------------------------------------------------------
// OTA (A/B slots, pending-verify persisted before the reboot)
// ---------------------------------------------------------------------------

bool otaTokenConfigured() {
  Preferences preferences;
  if (!preferences.begin("tgc-ota", true)) return false;
  const bool configured = preferences.getString("token", "").length() >= kOtaTokenMinLength;
  preferences.end();
  return configured;
}

bool otaAuthorized() {
  Preferences preferences;
  if (!preferences.begin("tgc-ota", true)) return false;
  const String token = preferences.getString("token", "");
  preferences.end();
  if (token.length() < kOtaTokenMinLength) return false;
  String provided = webServer.header("Authorization");
  if (provided.startsWith("Bearer ")) provided = provided.substring(7);
  if (provided.length() != token.length()) return false;
  volatile uint8_t difference = 0;
  for (size_t index = 0; index < token.length(); ++index) {
    difference |= static_cast<uint8_t>(token[index]) ^ static_cast<uint8_t>(provided[index]);
  }
  return difference == 0;
}

void receiveOtaUpload() {
  HTTPUpload &upload = webServer.upload();
  if (upload.status == UPLOAD_FILE_START) {
    state.otaActive = otaAuthorized() && hal.beginOta();
    if (!state.otaActive) Serial.println(F("{\"ota\":{\"event\":\"rejected\"}}"));
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (!state.otaActive) return;
    if (hal.writeOta(upload.buf, upload.currentSize) != upload.currentSize) {
      state.otaActive = false;
    }
  } else if (upload.status == UPLOAD_FILE_END) {
    if (!state.otaActive) return;
    if (hal.finishOta()) {
      // Persist BEFORE the reboot so a crash right after still rolls back.
      hal.markOtaPendingVerify();
      Serial.printf("{\"ota\":{\"event\":\"complete\",\"bytes\":%u}}\n",
                    static_cast<unsigned>(upload.totalSize));
      state.restartAtMs = millis() + 1200;
    } else {
      hal.abortOta();
      state.otaActive = false;
      Serial.println(F("{\"ota\":{\"event\":\"failed\"}}"));
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    hal.abortOta();
    state.otaActive = false;
  }
}

void finishOtaRequest() {
  if (!state.otaActive) {
    webServer.send(401, "application/json", "{\"ok\":false,\"error\":\"unauthorized_or_not_started\"}");
    return;
  }
  webServer.send(200, "application/json", "{\"ok\":true,\"state\":\"restarting\"}");
  state.otaActive = false;
}

// ---------------------------------------------------------------------------
// HTTP endpoints of the universal contract
// ---------------------------------------------------------------------------

String buildDeviceInfoJson() {
  char flashSize[12];
  snprintf(flashSize, sizeof(flashSize), "%uMB",
           static_cast<unsigned>(ESP.getFlashChipSize() / (1024U * 1024U)));
  const char *flashMode;
  switch (ESP.getFlashChipMode()) {
    case FM_QIO: flashMode = "qio"; break;
    case FM_DIO: flashMode = "dio"; break;
    case FM_QOUT: flashMode = "qout"; break;
    case FM_DOUT: flashMode = "dout"; break;
    default: flashMode = "unknown"; break;
  }
  const IPAddress ip = state.online ? WiFi.localIP() : WiFi.softAPIP();
  String document = "{\"productCode\":\"" + String(kProductCode) + "\"";
  document += ",\"productName\":\"" + String(kProductName) + "\"";
  document += ",\"deviceId\":\"" + deviceSuffix + "\"";
  document += ",\"hardwareRevision\":\"" + String(kHardwareRevision) + "\"";
  document += ",\"firmwareVersion\":\"" + String(kFirmwareVersion) + "\"";
  document += ",\"chipFamily\":\"" + String(ESP.getChipModel()) + "\"";
  document += ",\"flashSize\":\"" + String(flashSize) + "\"";
  document += ",\"flashMode\":\"" + String(flashMode) + "\"";
  document += ",\"partitionScheme\":\"" + String(kPartitionScheme) + "\"";
  document += ",\"ip\":\"" + ip.toString() + "\"";
  document += String(",\"otaSupported\":") +
              ((state.online && otaTokenConfigured()) ? "true" : "false");
  document += ",\"otaPort\":80,\"otaPath\":\"/api/ota/image\"";
  document += ",\"mdns\":{\"service\":\"_telemetric-ota._tcp\"}}";
  return document;
}

void sendDeviceInfo() {
  webServer.sendHeader(F("Cache-Control"), F("no-store"));
  webServer.send(200, "application/json", buildDeviceInfoJson());
}

void sendHealth() {
  String body = "{\"ok\":true,\"state\":\"";
  body += state.online ? "online" : (state.apOpen ? "setup-ap" : "offline");
  body += "\",\"uptimeMs\":" + String(static_cast<unsigned long>(millis()));
  body += ",\"otaPendingVerify\":";
  body += state.otaPendingVerify ? "true" : "false";
  body += ",\"firmwareVersion\":\"" + String(kFirmwareVersion) + "\"}";
  webServer.sendHeader(F("Cache-Control"), F("no-store"));
  webServer.send(200, "application/json", body);
}

const char SETUP_PORTAL_HTML[] PROGMEM = R"html(<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telemetric Device Setup</title>
<style>body{font-family:system-ui;background:#0b1620;color:#e8f2f8;max-width:420px;margin:40px auto;padding:0 16px}
input,button{width:100%;padding:12px;margin:6px 0;border-radius:8px;border:1px solid #2a5570;box-sizing:border-box;font-size:15px}
button{background:#2fd4c3;color:#04211e;font-weight:700;border:0}
h1,p{font-size:.95rem}small{color:#7d99ad}</style></head><body>
<h1>Telemetric Device Setup</h1>
<p id="info">Memuat…</p>
<input id="ssid" placeholder="SSID Wi-Fi" autocomplete="off">
<input id="pass" type="password" placeholder="Password (kosongkan untuk jaringan terbuka)">
<button onclick="save()">Simpan &amp; hubungkan</button>
<button onclick="clearNvs()" style="background:#12303f;color:#e8f2f8">Hapus Wi-Fi tersimpan (kembali ke factory)</button>
<small id="msg"></small>
<script>
fetch('/api/device-info').then(r=>r.json()).then(d=>{document.getElementById('info').textContent=d.productName+' '+d.hardwareRevision+' · firmware '+d.firmwareVersion+' · ID '+d.deviceId;});
async function save(){
  const body=new URLSearchParams({ssid:document.getElementById('ssid').value,password:document.getElementById('pass').value});
  const r=await fetch('/api/provisioning',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  document.getElementById('msg').textContent=await r.text();
}
async function clearNvs(){
  const r=await fetch('/api/provisioning/clear',{method:'POST'});
  document.getElementById('msg').textContent=await r.text();
}
</script></body></html>)html";

void sendSetupPortal() {
  webServer.sendHeader(F("Cache-Control"), F("no-store"));
  webServer.send_P(200, "text/html; charset=utf-8", SETUP_PORTAL_HTML);
}

void saveProvisioningRequest() {
  TelemetricWifiCredentials credentials{webServer.arg("ssid"), webServer.arg("password")};
  if (credentials.ssid.length() == 0 || credentials.ssid.length() > 32 || credentials.password.length() > 63) {
    webServer.send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_credentials\"}");
    return;
  }
  if (!hal.saveWifiCredentials(credentials)) {
    webServer.send(500, "application/json", "{\"ok\":false,\"error\":\"nvs_write_failed\"}");
    return;
  }
  webServer.send(200, "application/json", "{\"ok\":true,\"state\":\"rebooting\"}");
  state.restartAtMs = millis() + 1200;
}

void clearProvisioningRequest() {
  if (!hal.clearWifiCredentials()) {
    webServer.send(500, "application/json", "{\"ok\":false,\"error\":\"nvs_clear_failed\"}");
    return;
  }
  webServer.send(200, "application/json", "{\"ok\":true,\"state\":\"rebooting\"}");
  state.restartAtMs = millis() + 1200;
}

void startWebServer() {
  webServer.on("/", HTTP_GET, sendSetupPortal);
  webServer.on("/api/device-info", HTTP_GET, sendDeviceInfo);
  webServer.on("/api/health", HTTP_GET, sendHealth);
  webServer.on("/api/provisioning", HTTP_POST, saveProvisioningRequest);
  webServer.on("/api/provisioning/clear", HTTP_POST, clearProvisioningRequest);
  webServer.on("/api/ota/image", HTTP_POST, finishOtaRequest, receiveOtaUpload);
  const char *captivePaths[] = {"/generate_204", "/hotspot-detect.html", "/ncsi.txt", "/connecttest.txt"};
  for (const char *path : captivePaths) {
    webServer.on(path, HTTP_ANY, []() {
      webServer.sendHeader(F("Location"), String(F("http://")) + WiFi.softAPIP().toString() + "/");
      webServer.send(302, "text/plain", "");
    });
  }
  webServer.onNotFound(sendSetupPortal);
  const char *headers[] = {"Authorization"};
  webServer.collectHeaders(headers, 1);
  webServer.begin();
}

// ---------------------------------------------------------------------------
// Serial console (never echoes credentials or tokens)
// ---------------------------------------------------------------------------

void printHelp() {
  Serial.println(F("Commands: info, health, wifi-clear, ota-confirm, ota-rollback, ota-token-set <token>, ota-token-clear, help"));
}

void runCommand(const String &command) {
  if (command == "info") {
    Serial.println(buildDeviceInfoJson());
    return;
  }
  if (command == "health") {
    Serial.printf("{\"health\":{\"online\":%s,\"apOpen\":%s,\"pendingVerify\":%s,\"uptimeMs\":%lu}}\n",
                  state.online ? "true" : "false", state.apOpen ? "true" : "false",
                  state.otaPendingVerify ? "true" : "false", static_cast<unsigned long>(millis()));
    return;
  }
  if (command == "wifi-clear") {
    hal.clearWifiCredentials();
    Serial.println(F("{\"wifi\":{\"cleared\":true}}"));
    state.restartAtMs = millis() + 800;
    return;
  }
  if (command == "ota-confirm") {
    const bool confirmed = hal.confirmOta();
    state.otaPendingVerify = !confirmed ? state.otaPendingVerify : false;
    Serial.println(confirmed
      ? F("{\"ota\":{\"state\":\"confirmed\"}}")
      : F("{\"ota\":{\"state\":\"confirm-failed\"}}"));
    return;
  }
  if (command == "ota-rollback") {
    Serial.println(hal.rollbackOta()
      ? F("{\"ota\":{\"state\":\"rolling-back\"}}")
      : F("{\"ota\":{\"state\":\"rollback-unavailable\"}}"));
    return;
  }
  if (command.startsWith("ota-token-set ")) {
    const String token = command.substring(14);
    if (token.length() < kOtaTokenMinLength || token.length() > kOtaTokenMaxLength) {
      Serial.println(F("{\"error\":\"token_length\"}"));
      return;
    }
    Preferences preferences;
    if (preferences.begin("tgc-ota", false)) {
      preferences.putString("token", token);
      preferences.end();
      Serial.println(F("{\"ota\":{\"token\":\"configured\"}}"));
    }
    return;
  }
  if (command == "ota-token-clear") {
    Preferences preferences;
    if (preferences.begin("tgc-ota", false)) {
      preferences.clear();
      preferences.end();
      Serial.println(F("{\"ota\":{\"token\":\"cleared\"}}"));
    }
    return;
  }
  if (command == "help" || command.length() == 0) return printHelp();
  Serial.println(F("{\"error\":\"unknown_command\"}"));
}

// ---------------------------------------------------------------------------
// setup / loop
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  deviceSuffix = hal.deviceIdSuffix();
  Serial.printf("{\"bootstrap\":{\"boot\":true,\"product\":\"%s\",\"deviceId\":\"%s\",\"version\":\"%s\",\"profile\":\"%s\",\"stage\":\"lab\"}}\n",
                kProductCode, deviceSuffix.c_str(), kFirmwareVersion, kHardwareRevision);
  if (!hal.begin()) {
    Serial.println(F("{\"bootstrap\":{\"error\":\"nvs_init_failed\"}}"));
  }
  startWebServer();
  boot();
  printHelp();
}

void loop() {
  // Health confirmation: a pending-verify slot is confirmed only after it has
  // run stably. A failed boot/health check rolls back through the HAL
  // (rollback under crash needs a bootloader with app-rollback support; see
  // profile unknowns — none is claimed for this build).
  if (state.otaPendingVerify &&
      static_cast<int32_t>(millis() - state.stabilityStartMs) >= static_cast<int32_t>(kStabilityConfirmMs)) {
    if (hal.confirmOta()) {
      state.otaPendingVerify = false;
      Serial.println(F("{\"ota\":{\"state\":\"confirmed\"}}"));
    } else {
      state.stabilityStartMs = millis();  // retry on the next window
    }
  }
  if (state.apOpen) dnsServer.processNextRequest();
  webServer.handleClient();
  if (state.restartAtMs && static_cast<int32_t>(millis() - state.restartAtMs) >= 0) {
    hal.reboot();
  }
  while (Serial.available()) {
    const char character = static_cast<char>(Serial.read());
    if (character == '\n' || character == '\r') {
      if (commandBuffer.length()) runCommand(commandBuffer);
      commandBuffer = "";
      continue;
    }
    if (commandBuffer.length() < kCommandBufferLength) commandBuffer += character;
  }
}