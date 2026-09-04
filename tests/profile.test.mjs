import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PROFILE_MANDATORY_FIELDS, validateProfile } from "../src/core/profile.mjs";

const labProfileUrl = new URL("../profiles/TGC_LAB_ESP32S3_16M/profile.json", import.meta.url);
const templateUrl = new URL("../profiles/_template/profile.json", import.meta.url);

test("mandatory profile fields are exactly the agreed build set", () => {
  assert.deepEqual([...PROFILE_MANDATORY_FIELDS], [
    "productCode", "profileId", "hardwareRevision", "chipFamily",
    "flashSize", "flashMode", "partitionScheme", "wifiSupported"
  ]);
});

test("the verified TGC LAB profile validates with its unconfirmed features disabled", async () => {
  const profile = JSON.parse(await readFile(labProfileUrl, "utf8"));
  const check = validateProfile(profile);
  assert.deepEqual(check.errors, [], JSON.stringify(check.errors));
  assert.deepEqual(check.disabledFeatures, ["ethernet", "physical-setup-control"]);
});

test("an UNCONFIRMED mandatory field blocks even a LAB build", async () => {
  const profile = JSON.parse(await readFile(labProfileUrl, "utf8"));
  for (const field of PROFILE_MANDATORY_FIELDS) {
    const broken = { ...profile, [field]: "UNCONFIRMED" };
    const check = validateProfile(broken);
    assert.ok(check.errors.some((error) => error.includes(field)), field);
  }
  const missing = { ...profile };
  delete missing.flashMode;
  assert.ok(validateProfile(missing).errors.some((error) => error.includes("flashMode")));
});

test("optional feature fields may stay UNCONFIRMED (disabled) or be booleans", async () => {
  const base = { ...JSON.parse(await readFile(labProfileUrl, "utf8")) };
  assert.deepEqual(validateProfile({ ...base, ethernetSupported: true }).errors, []);
  assert.deepEqual(
    validateProfile({ ...base, ethernetSupported: false }).disabledFeatures,
    ["physical-setup-control"],
    "only the still-UNCONFIRMED feature is disabled"
  );
  const bad = validateProfile({ ...base, ethernetSupported: "W5500" });
  assert.ok(bad.errors.some((error) => error.includes("ethernetSupported")));
});

test("stage is mandatory and must be a declared build stage", async () => {
  const base = JSON.parse(await readFile(labProfileUrl, "utf8"));
  assert.ok(validateProfile({ ...base, stage: "UNCONFIRMED" }).errors.some((e) => e.includes("stage")));
  assert.ok(validateProfile({ ...base, stage: undefined }).errors.some((e) => e.includes("stage")));
  assert.deepEqual(validateProfile({ ...base, stage: "production" }).errors, []);
});

test("the template stays UNCONFIRMED everywhere and fails validation", async () => {
  const template = JSON.parse(await readFile(templateUrl, "utf8"));
  for (const field of [...PROFILE_MANDATORY_FIELDS, "stage", "ethernetSupported", "setupControl"]) {
    assert.equal(template[field], "UNCONFIRMED", field);
  }
  const check = validateProfile(template);
  assert.ok(check.errors.length >= PROFILE_MANDATORY_FIELDS.length, "template cannot build BINs");
});

test("the TGC profile claims only board-proven facts with evidence, no classic-ESP32 claim", async () => {
  const profile = JSON.parse(await readFile(labProfileUrl, "utf8"));
  assert.equal(profile.productCode, "TGC");
  assert.equal(profile.chipFamily, "ESP32-S3");
  assert.equal(profile.flashSize, "16MB");
  assert.equal(profile.flashMode, "qio");
  assert.equal(profile.partitionScheme, "tgc-ota-16mb");
  assert.equal(profile.stage, "lab");
  assert.equal(profile.wifiSupported, true);
  assert.ok(profile.evidence.length >= 5, "every claim carries evidence");
  const unknowns = profile.unknowns.join(" ");
  assert.ok(unknowns.includes("COM6"), "the unidentified second board must stay an unknown");
  assert.ok(!unknowns.includes("UNCONFIRMED nothing"), "unknowns list is populated");
});