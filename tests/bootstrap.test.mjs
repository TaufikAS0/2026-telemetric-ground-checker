import test from "node:test";
import assert from "node:assert/strict";
import {
  API_PATHS,
  SETUP_AP_PREFIX,
  SETUP_PORTAL_URL,
  hostnameFor,
  setupApSsid,
  TelemetricBootstrap
} from "../src/core/bootstrap.mjs";
import { FACTORY_WIFI, FACTORY_WIFI_IS_LAB_DEFAULT } from "../src/config/factory-wifi.mjs";

// Fake HAL: records every call so tests can assert the universal order
// without any hardware. Call records never contain credential values.
function fakeHal({ stored = null, stationQueue = [], deviceSuffix = "a1b2c3" } = {}) {
  let queue = [...stationQueue];
  return {
    calls: [],
    stored,
    savedCredentials: [],
    clearedCount: 0,
    apOpen: null,
    otaBootState: { pendingVerify: false },
    counters: { beginOta: 0, abortOta: 0, confirmOta: 0, rollbackOta: 0, reboot: 0 },
    deviceIdSuffix: () => deviceSuffix,
    async loadWifiCredentials() {
      this.calls.push("loadWifiCredentials");
      return this.stored;
    },
    async saveWifiCredentials(credentials) {
      this.calls.push(`saveWifiCredentials:${credentials.ssid}`);
      this.savedCredentials.push(credentials);
      this.stored = credentials; // mirrors the atomic NVS write
    },
    async clearWifiCredentials() {
      this.calls.push("clearWifiCredentials");
      this.clearedCount += 1;
      this.stored = null;
    },
    async tryStation(credentials) {
      this.calls.push(`tryStation:${credentials.ssid}`);
      return queue.length ? queue.shift() : true;
    },
    async startSetupAp(suffix) {
      this.calls.push(`startSetupAp:${suffix}`);
      this.apOpen = suffix;
      return { ssid: setupApSsid(suffix), ip: "192.168.4.1" };
    },
    isSetupApOpen() {
      return this.apOpen !== null;
    },
    async stopSetupAp() {
      this.calls.push("stopSetupAp");
      this.apOpen = null;
    },
    async advertiseOnLan() {
      this.calls.push("advertiseOnLan");
    },
    async loadOtaBootState() {
      return { ...this.otaBootState };
    },
    async markOtaPendingVerify() {
      this.otaBootState.pendingVerify = true; // persists across reboots
    },
    async beginOta() { this.counters.beginOta += 1; },
    async abortOta() { this.counters.abortOta += 1; },
    async confirmOta() { this.counters.confirmOta += 1; this.otaBootState.pendingVerify = false; },
    async rollbackOta() { this.counters.rollbackOta += 1; this.otaBootState.pendingVerify = false; },
    async reboot() { this.counters.reboot += 1; }
  };
}

const operatorWifi = { ssid: "operator-net", password: "operator-pass-123" };
const config = { productCode: "TGC", hardwareRevision: "TGC_LAB_ESP32S3_16M", stationTimeoutMs: 100 };

test("universal contract constants", () => {
  assert.equal(SETUP_AP_PREFIX, "TELEMETRIC-SETUP-");
  assert.equal(SETUP_PORTAL_URL, "http://192.168.4.1/");
  assert.equal(setupApSsid("a1b2c3"), "TELEMETRIC-SETUP-a1b2c3");
  assert.equal(hostnameFor("TGC", "a1b2c3"), "telemetric-tgc-a1b2c3");
  assert.equal(API_PATHS.deviceInfo, "/api/device-info");
  assert.equal(API_PATHS.provisioning, "/api/provisioning");
  assert.equal(API_PATHS.provisioningClear, "/api/provisioning/clear");
  assert.equal(API_PATHS.otaImage, "/api/ota/image");
  assert.equal(API_PATHS.health, "/api/health");
});

test("factory Wi-Fi is an explicitly labelled LAB default", async () => {
  assert.equal(FACTORY_WIFI_IS_LAB_DEFAULT, true);
  assert.equal(typeof FACTORY_WIFI.ssid, "string");
  assert.ok(FACTORY_WIFI.ssid.length > 0 && FACTORY_WIFI.ssid.length <= 32);
  assert.ok(typeof FACTORY_WIFI.password === "string" && FACTORY_WIFI.password.length >= 8);
  const source = await readFileUtf8("../src/config/factory-wifi.mjs");
  assert.ok(source.includes("LAB DEFAULT — NOT FOR PRODUCTION"));
  assert.ok(source.includes("stays in Git history"));
});

test("NVS credential succeeds and nothing else is tried", async () => {
  const hal = fakeHal({ stored: operatorWifi, stationQueue: [true] });
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  const result = await device.boot();
  assert.equal(result.ok, true);
  assert.equal(result.via, "stored");
  assert.equal(device.state, "online");
  assert.deepEqual(hal.calls, [
    "loadWifiCredentials", `tryStation:${operatorWifi.ssid}`, "advertiseOnLan"
  ]);
  assert.equal(hal.apOpen, null);
});

test("NVS fails, factory Wi-Fi succeeds and is saved to NVS", async () => {
  const hal = fakeHal({ stored: operatorWifi, stationQueue: [false, true] });
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  const result = await device.boot();
  assert.equal(result.ok, true);
  assert.equal(result.via, "factory");
  assert.deepEqual(hal.calls, [
    "loadWifiCredentials", `tryStation:${operatorWifi.ssid}`,
    `tryStation:${FACTORY_WIFI.ssid}`, `saveWifiCredentials:${FACTORY_WIFI.ssid}`, "advertiseOnLan"
  ]);
  assert.ok(hal.savedCredentials[0].password === FACTORY_WIFI.password,
    "the exact factory credential must be persisted unchanged");
});

test("next reboot reads the stored factory credential from NVS first", async () => {
  const hal = fakeHal({ stationQueue: [true] });
  const first = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  await first.boot(); // factory path saved the credential
  const beforeReboot = hal.calls.length;
  const second = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  const result = await second.boot();
  assert.equal(result.via, "stored");
  const rebootBootCalls = hal.calls.slice(beforeReboot);
  assert.deepEqual(rebootBootCalls, [
    "loadWifiCredentials", `tryStation:${FACTORY_WIFI.ssid}`, "advertiseOnLan"
  ], "the rebooted boot must try exactly one network: the stored credential");
});

test("provisioning replaces the factory credential, reboots, and stays online", async () => {
  const hal = fakeHal({ stationQueue: [false, true] });
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  await device.boot(); // factory path -> setup not needed; force setup mode:
  await device.reopenSetupMode();
  assert.equal(hal.apOpen, "a1b2c3", "precondition: the setup AP is up");
  const result = await device.provision(operatorWifi);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.via, "stored", "after reboot the operator credential has first priority");
  assert.equal(device.state, "online");
  assert.equal(hal.counters.reboot, 1);
  assert.equal(hal.apOpen, null, "the setup AP must be closed for real after provisioning");
  assert.ok(hal.calls.includes("stopSetupAp"), "HAL stopSetupAp must be invoked");
  assert.ok(hal.calls.includes("clearWifiCredentials") === false);
  const operatorSave = hal.savedCredentials.at(-1);
  assert.equal(operatorSave.ssid, operatorWifi.ssid);
  assert.ok(operatorSave.password === operatorWifi.password,
    "the operator credential must be persisted unchanged");
  assert.ok(!hal.calls.slice(-3).some((c) => c.startsWith(`tryStation:${FACTORY_WIFI.ssid}`)));
});

test("provisioning rejects invalid credentials and stays in setup mode", async () => {
  const hal = fakeHal({ stationQueue: [false] });
  const device = new TelemetricBootstrap({ hal, config });
  await device.boot();
  const result = await device.provision({ ssid: "" });
  assert.equal(result.ok, false);
  assert.equal(device.state, "setup-ap");
  assert.equal(hal.apOpen, "a1b2c3");
  assert.equal(hal.counters.reboot, 0);
});

test("clearing NVS falls back to the factory credential and closes the AP", async () => {
  const hal = fakeHal({ stationQueue: [false, true] });
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  await device.boot(); // nothing stored, factory unreachable -> setup AP opens
  assert.equal(device.state, "setup-ap");
  assert.equal(hal.apOpen, "a1b2c3", "precondition: the setup AP is up");
  const cleared = await device.clearProvisioning();
  assert.equal(hal.clearedCount, 1);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.via, "factory", "after clearing NVS the factory value takes over");
  assert.equal(hal.savedCredentials.at(-1).ssid, FACTORY_WIFI.ssid);
  assert.equal(hal.apOpen, null, "the setup AP must be closed for real once the LAN is up");
  assert.ok(hal.calls.includes("stopSetupAp"), "HAL stopSetupAp must be invoked");
});

test("all Wi-Fi fails, the unique setup AP opens", async () => {
  const hal = fakeHal({ stored: null, stationQueue: [false, false] });
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  const result = await device.boot();
  assert.equal(result.ok, false);
  assert.equal(device.state, "setup-ap");
  assert.equal(result.ap.ssid, "TELEMETRIC-SETUP-a1b2c3");
  assert.ok(hal.calls.includes("startSetupAp:a1b2c3"));
  assert.equal(hal.apOpen, "a1b2c3");
});

test("credential values never appear in state, log, or result snapshots", async () => {
  const hal = fakeHal({ stored: null, stationQueue: [false, true] });
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  await device.boot();
  await device.reopenSetupMode();
  await device.provision(operatorWifi);
  await device.reopenSetupMode();
  const snapshot = JSON.stringify({
    state: device.state,
    lastError: device.lastError,
    log: device.log,
    apInfo: device.apInfo,
    calls: hal.calls
  });
  assert.ok(!snapshot.includes(FACTORY_WIFI.password), "factory password leaked into the snapshot");
  assert.ok(!snapshot.includes(operatorWifi.password), "operator password leaked into the snapshot");
});

test("OTA pending-verify persists across a simulated reboot", async () => {
  const hal = fakeHal({ stored: operatorWifi, stationQueue: [true] });
  const device = new TelemetricBootstrap({ hal, config });
  await device.boot();
  await device.beginOta();
  const finished = await device.finishOta({ imageValid: true });
  assert.equal(finished.state, "ota-pending-verify");
  assert.equal(hal.otaBootState.pendingVerify, true, "flag must be persisted before the reboot");
  assert.equal(hal.counters.reboot, 1);

  const rebooted = new TelemetricBootstrap({ hal, config }); // fresh boot after the OTA reboot
  await rebooted.boot();
  assert.equal(rebooted.otaPendingVerify, true, "pending-verify must survive the reboot");
  const confirmed = await rebooted.confirmHealth();
  assert.equal(confirmed.state, "ota-confirmed");
  assert.equal(hal.otaBootState.pendingVerify, false);
});

test("OTA confirm and rollback work, with state guards", async () => {
  const hal = fakeHal({ stored: operatorWifi, stationQueue: [true] });
  const device = new TelemetricBootstrap({ hal, config });
  await device.boot();

  assert.equal((await device.finishOta({ imageValid: true })).error, "ota_not_started");
  assert.equal((await device.abortOta()).error, "ota_not_started");
  assert.equal((await device.confirmHealth()).error, "no_pending_verify");

  await device.beginOta();
  assert.equal((await device.beginOta()).error, "ota_already_active");
  await device.finishOta({ imageValid: true });
  assert.equal((await device.confirmHealth()).state, "ota-confirmed");
  assert.equal(hal.counters.confirmOta, 1);
  assert.equal(hal.counters.rollbackOta, 0);

  await device.beginOta();
  await device.finishOta({ imageValid: true });
  assert.equal((await device.reportUnhealthy()).state, "ota-rolled-back");
  assert.equal(hal.counters.rollbackOta, 1);
});

test("an invalid OTA image is aborted and never reboots into it", async () => {
  const hal = fakeHal({ stored: operatorWifi, stationQueue: [true] });
  const device = new TelemetricBootstrap({ hal, config });
  await device.boot();
  await device.beginOta();
  const result = await device.finishOta({ imageValid: false });
  assert.equal(result.ok, false);
  assert.equal(device.otaPendingVerify, false);
  assert.equal(hal.counters.abortOta, 1);
  assert.equal(hal.counters.reboot, 0);
});

test("repeated LAN failure reopens setup mode without erasing stored credentials", async () => {
  const hal = fakeHal({ stored: operatorWifi, stationQueue: [false, false] });
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  await device.boot();
  const reopened = await device.reopenSetupMode();
  assert.equal(reopened.state, "setup-ap");
  assert.equal(reopened.ap.ssid, "TELEMETRIC-SETUP-a1b2c3");
  assert.equal(hal.savedCredentials.length, 0, "NVS must be preserved on reopen");
});

// Regression: the core must close the AP even when the adapter does not
// implement isSetupApOpen — apInfo bookkeeping alone must be enough.
function stripIsSetupApOpen(hal) {
  const { isSetupApOpen, ...rest } = hal;
  return rest;
}

test("regression: provisioning closes the AP without an optional HAL probe", async () => {
  const hal = stripIsSetupApOpen(fakeHal({ stationQueue: [false, true] }));
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  await device.boot(); // factory unreachable -> setup AP opens
  await device.reopenSetupMode();
  assert.equal(hal.apOpen, "a1b2c3", "precondition: AP is up, HAL has no isSetupApOpen");
  const result = await device.provision(operatorWifi);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(hal.apOpen, null, "AP must be closed through stopSetupAp, not by clearing apInfo");
  assert.ok(hal.calls.includes("stopSetupAp"));
});

test("regression: clear NVS closes the AP without an optional HAL probe", async () => {
  const hal = stripIsSetupApOpen(fakeHal({ stationQueue: [false, true] }));
  const device = new TelemetricBootstrap({ hal, config: { ...config, factoryWifi: FACTORY_WIFI } });
  await device.boot(); // setup AP opens
  assert.equal(hal.apOpen, "a1b2c3", "precondition: AP is up, HAL has no isSetupApOpen");
  const cleared = await device.clearProvisioning();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.via, "factory");
  assert.equal(hal.apOpen, null, "AP must be closed through stopSetupAp, not by clearing apInfo");
  assert.ok(hal.calls.includes("stopSetupAp"));
});

test("regression: a stale AP reported by the HAL is closed even when core forgot it", async () => {
  const hal = fakeHal({ stored: operatorWifi, stationQueue: [true] });
  hal.isSetupApOpen = () => true; // adapter says the AP is still radiating
  const device = new TelemetricBootstrap({ hal, config });
  const result = await device.boot(); // stored success, core apInfo is null
  assert.equal(result.ok, true);
  assert.equal(hal.apOpen, null);
  assert.ok(hal.calls.includes("stopSetupAp"), "the defensive close must run");
});

async function readFileUtf8(relativePath) {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = new URL(relativePath, import.meta.url);
  return readFile(fileURLToPath(path), "utf8");
}