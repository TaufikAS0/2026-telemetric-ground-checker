import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildArtifactManifest, validateArtifactManifest } from "../src/core/artifact-manifest.mjs";
import { assertStageAllowed } from "../src/core/stage-guard.mjs";

const profileUrl = new URL("../profiles/TGC_LAB_ESP32S3_16M/profile.json", import.meta.url);
const partitionsUrl = new URL("../products/tgc/tgc_initial_lab/partitions.csv", import.meta.url);
const halUrl = new URL("../src/adapters/esp32/telemetric_esp32_hal.h", import.meta.url);
const inoUrl = new URL("../products/tgc/tgc_initial_lab/tgc_initial_lab.ino", import.meta.url);

// Board-proven facts (hardware/board-detection-2026-09-04.md; read-only
// esptool flash_id on COM11). Nothing in the profile may go beyond these.
const PROVEN = {
  profileId: "TGC_LAB_ESP32S3_16M",
  productCode: "TGC",
  hardwareRevision: "TGC_LAB_ESP32S3_16M",
  chipFamily: "ESP32-S3",
  flashSize: "16MB",
  flashMode: "qio",
  partitionScheme: "tgc-ota-16mb"
};

test("LAB profile states only board-proven facts and stays lab-stage", async () => {
  const profile = JSON.parse(await readFile(profileUrl, "utf8"));
  for (const [field, expected] of Object.entries(PROVEN)) {
    assert.equal(profile[field], expected, `${field} must match the proven value`);
  }
  assert.equal(profile.stage, "lab");
  assert.ok(profile.wifiSupported === true, "station+AP Wi-Fi is board-proven");
  for (const unknown of ["ethernetSupported", "setupControl"]) {
    assert.equal(profile[unknown], "UNCONFIRMED", `${unknown} stays UNCONFIRMED`);
  }
  assert.ok(Array.isArray(profile.evidence) && profile.evidence.length >= 3, "claims carry evidence");
  assert.ok(Array.isArray(profile.unknowns) && profile.unknowns.length >= 3, "unknowns are listed");
});

test("the LAB partition table matches the TGC tgc-ota-16mb layout (16MB, 3MB A/B slots)", async () => {
  const csv = (await readFile(partitionsUrl, "utf8")).split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#")).join("\n");
  assert.equal(csv, [
    "nvs,        data, nvs,      0x9000,   0x5000,",
    "otadata,    data, ota,      0xe000,   0x2000,",
    "ota_0,      app,  ota_0,    0x10000,  0x300000,",
    "ota_1,      app,  ota_1,    0x310000, 0x300000,",
    "coredump,   data, coredump, 0x610000, 0x10000,"
  ].join("\n"));
  // Layout sanity: contiguous offsets that never exceed the verified 16MB.
  const end = 0x610000 + 0x10000;
  assert.ok(end <= 0x1000000, "partition table must fit the verified 16MB flash");
  assert.ok(0x10000 + 0x300000 === 0x310000 && 0x310000 + 0x300000 === 0x610000,
    "OTA slots must be contiguous without overlap");
});

test("the proven LAB profile builds a valid manifest; production stays blocked", async () => {
  const profile = JSON.parse(await readFile(profileUrl, "utf8"));
  const artifacts = [
    { imageType: "app", fileName: "tgc_initial_lab.ino.bin", sizeBytes: 1161808, sha256: "a".repeat(64), offset: 0x10000 },
    { imageType: "full", fileName: "tgc_initial_lab.ino.merged.bin", sizeBytes: 16777216, sha256: "b".repeat(64), offset: 0 }
  ];
  const manifest = buildArtifactManifest({
    productCode: profile.productCode,
    version: "v0.1.0-initial.1",
    buildId: "0000000",
    sourceCommit: "0".repeat(40),
    profileId: profile.profileId,
    chipFamily: profile.chipFamily,
    flashSize: profile.flashSize,
    flashMode: profile.flashMode,
    partitionScheme: profile.partitionScheme,
    stage: profile.stage,
    disabledFeatures: ["ethernet", "physical-setup-control"],
    artifacts
  });
  assert.equal(manifest.releaseId, "TGC-0.1.0-initial.1-0000000");
  assert.equal(manifest.stage, "lab");
  assert.deepEqual(manifest.disabledFeatures, ["ethernet", "physical-setup-control"],
    "unconfirmed features must be recorded as disabled in the release manifest");
  assert.deepEqual(validateArtifactManifest(manifest), []);
  assert.throws(
    () => assertStageAllowed({ stage: "production" }),
    /production build refused/,
    "the same profile facts cannot be packaged for production while the LAB default is active"
  );
});

test("adapter and sketch mirror the universal contract", async () => {
  const hal = await readFile(halUrl, "utf8");
  for (const marker of [
    'String("TELEMETRIC-SETUP-")', "loadWifiCredentials", "saveWifiCredentials",
    "clearWifiCredentials", "loadOtaBootState", "markOtaPendingVerify",
    "confirmOta", "rollbackOta", "stopSetupAp", "isSetupApOpen"
  ]) {
    assert.ok(hal.includes(marker), `HAL marker missing: ${marker}`);
  }
  const ino = await readFile(inoUrl, "utf8");
  for (const marker of [
    "/api/device-info", "/api/health", "/api/provisioning",
    "/api/provisioning/clear", "/api/ota/image", "Authorization",
    "kFactoryWifiCredentials", "static_assert"
  ]) {
    assert.ok(ino.includes(marker), `sketch marker missing: ${marker}`);
  }
  // The sketch must not contain any literal credential value.
  const { FACTORY_WIFI } = await import("../src/config/factory-wifi.mjs");
  assert.ok(!ino.includes(FACTORY_WIFI.password), "sketch must not embed the password directly");
  assert.ok(!hal.includes(FACTORY_WIFI.password), "HAL must not embed the password directly");
});

test("the Initial firmware stays inside its declared scope (no TGC measurement/QC)", async () => {
  const ino = await readFile(inoUrl, "utf8");
  // Strip comments so documentation words (e.g. "no relay/output function")
  // do not false-positive; only real code must be checked.
  const code = ino
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const forbidden = ["relay", "digitalWrite", "analogRead", "analogWrite",
    "ledc", "Servo", "groundResistance", "measureGround", "QC"];
  for (const marker of forbidden) {
    assert.ok(!code.includes(marker), `Initial firmware must not contain ${marker}`);
  }
  // Network identity must be derived at runtime from the MAC, never constant.
  const hal = await readFile(halUrl, "utf8");
  assert.ok(hal.includes("ESP.getEfuseMac()"), "deviceId suffix must come from the eFuse MAC (HAL)");
  assert.ok(code.includes("hal.deviceIdSuffix()"), "sketch must use the runtime MAC-derived identity");
});