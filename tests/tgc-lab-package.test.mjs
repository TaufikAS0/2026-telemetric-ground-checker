import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildArtifactManifest, validateArtifactManifest } from "../src/core/artifact-manifest.mjs";
import { assertStageAllowed } from "../src/core/stage-guard.mjs";

const profileUrl = new URL("../profiles/TGC_LAB_ESP32S3_16M/profile.json", import.meta.url);
const classicProfileUrl = new URL("../profiles/TGC_LAB_ESP32_4M/profile.json", import.meta.url);
const partitionsUrl = new URL("../products/tgc/tgc_initial_lab/partitions.csv", import.meta.url);
const classicPartitionsUrl = new URL("../products/tgc/tgc_initial_lab_esp32/partitions.csv", import.meta.url);
const halUrl = new URL("../src/adapters/esp32/telemetric_esp32_hal.h", import.meta.url);
const inoUrl = new URL("../products/tgc/tgc_initial_lab/tgc_initial_lab.ino", import.meta.url);
const classicInoUrl = new URL("../products/tgc/tgc_initial_lab_esp32/tgc_initial_lab_esp32.ino", import.meta.url);
const classicVersionUrl = new URL("../products/tgc/tgc_initial_lab_esp32/firmware_version.h", import.meta.url);
const classicBuildScriptUrl = new URL("../scripts/build-tgc-lab-esp32.ps1", import.meta.url);

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

// Classic ESP32 BUILD TARGET facts (owner decision 2026-09-04). These are
// declared compile targets from the 'ESP32 Dev Module' board definition,
// explicitly NOT physical-board verification.
const CLASSIC = {
  profileId: "TGC_LAB_ESP32_4M",
  productCode: "TGC",
  hardwareRevision: "TGC_LAB_ESP32_4M",
  chipFamily: "ESP32",
  flashSize: "4MB",
  flashMode: "dio",
  partitionScheme: "tgc-ota-4mb"
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

test("the classic build target profile matches its declared facts and stays lab-stage", async () => {
  const profile = JSON.parse(await readFile(classicProfileUrl, "utf8"));
  for (const [field, expected] of Object.entries(CLASSIC)) {
    assert.equal(profile[field], expected, `${field} must match the declared target value`);
  }
  assert.equal(profile.stage, "lab");
  assert.ok(profile.wifiSupported === true, "classic ESP32 Wi-Fi capability is datasheet-proven");
  for (const unknown of ["ethernetSupported", "setupControl"]) {
    assert.equal(profile[unknown], "UNCONFIRMED", `${unknown} stays UNCONFIRMED`);
  }
  assert.ok(Array.isArray(profile.evidence) && profile.evidence.length >= 3, "claims carry evidence");
  assert.ok(Array.isArray(profile.unknowns) && profile.unknowns.length >= 3, "unknowns are listed");
});

test("the classic partition table matches the TGC tgc-ota-4mb layout (4MB, 1.875MB A/B slots)", async () => {
  const csv = (await readFile(classicPartitionsUrl, "utf8")).split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#")).join("\n");
  assert.equal(csv, [
    "nvs,        data, nvs,      0x9000,   0x5000,",
    "otadata,    data, ota,      0xe000,   0x2000,",
    "ota_0,      app,  ota_0,    0x10000,  0x1E0000,",
    "ota_1,      app,  ota_1,    0x1F0000, 0x1E0000,",
    "coredump,   data, coredump, 0x3D0000, 0x10000,"
  ].join("\n"));
  // Layout sanity: contiguous offsets that never exceed the 4MB target and
  // differ from every other partition table in this repo.
  const end = 0x3D0000 + 0x10000;
  assert.ok(end <= 0x400000, "partition table must fit the 4MB target");
  assert.ok(0x10000 + 0x1E0000 === 0x1F0000 && 0x1F0000 + 0x1E0000 === 0x3D0000,
    "OTA slots must be contiguous without overlap");
  // Distinctness: never a copy of the TMM table or the TGC S3 table.
  const s3Csv = (await readFile(partitionsUrl, "utf8")).split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#")).join("\n");
  assert.notEqual(csv, s3Csv, "classic table must not be the S3 table");
  assert.ok(!csv.split("\n").some((line) => line.trim().startsWith("ota_0") && line.includes("0x1F0000,")),
    "classic ota_0 slot size must differ from the TMM 0x1F0000 slots");
});

test("the classic sketch mirrors the universal contract and stays separate from the S3 build", async () => {
  const ino = await readFile(classicInoUrl, "utf8");
  for (const marker of [
    "/api/device-info", "/api/health", "/api/provisioning",
    "/api/provisioning/clear", "/api/ota/image", "Authorization",
    "kFactoryWifiCredentials", "static_assert"
  ]) {
    assert.ok(ino.includes(marker), `classic sketch marker missing: ${marker}`);
  }
  assert.ok(ino.includes('"TGC_LAB_ESP32_4M"'), "classic sketch must carry its own profile");
  assert.ok(ino.includes('"tgc-ota-4mb"'), "classic sketch must carry its own partition scheme");
  assert.ok(!ino.includes("TGC_LAB_ESP32S3_16M") && !ino.includes("tgc-ota-16mb"),
    "classic sketch must not reference the S3 profile");
  assert.ok(!ino.includes("ESP32-S3"), "classic sketch must not claim the S3 chip family");
});

test("the classic build target uses a NEW version and its own fqbn (never the S3 release)", async () => {
  const versionHeader = await readFile(classicVersionUrl, "utf8");
  assert.ok(versionHeader.includes("#define TGC_BOOT_VERSION_MAJOR 0"));
  assert.ok(versionHeader.includes("#define TGC_BOOT_VERSION_MINOR 2"), "new minor version");
  assert.ok(versionHeader.includes("#define TGC_BOOT_VERSION_PATCH 0"));
  assert.ok(versionHeader.includes("#define TGC_BOOT_VERSION_PRERELEASE initial.1"));
  const buildScript = await readFile(classicBuildScriptUrl, "utf8");
  assert.ok(buildScript.includes("esp32:esp32:esp32:FlashSize=4M,FlashMode=dio,PartitionScheme=custom"),
    "classic fqbn must use the classic ESP32 Dev Module board definition");
  assert.ok(!buildScript.includes("esp32s3"), "classic build must not use an S3 fqbn");
  assert.ok(buildScript.includes("tgc_initial_lab_esp32.ino.bin"), "classic app-only BIN name");
  assert.ok(buildScript.includes("tgc_initial_lab_esp32.ino.merged.bin"), "classic merged BIN name");
  const s3Script = await readFile(new URL("../scripts/build-tgc-lab.ps1", import.meta.url), "utf8");
  assert.ok(s3Script.includes("esp32:esp32:esp32s3"), "S3 build script stays intact");
});

// The proven S3 LAB profile builds a valid manifest; production stays blocked.
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