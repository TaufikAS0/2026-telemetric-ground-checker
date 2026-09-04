import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildArtifactManifest,
  releaseIdFor,
  validateArtifactManifest
} from "../src/core/artifact-manifest.mjs";

const validPair = {
  productCode: "TGC",
  version: "v0.1.0-initial.1",
  buildId: "0a9113e",
  sourceCommit: "0a9113ebc0bd1dd284e7245acd0694027424e115",
  profileId: "TGC_LAB_ESP32S3_16M",
  chipFamily: "ESP32-S3",
  flashSize: "16MB",
  flashMode: "qio",
  partitionScheme: "tgc-ota-16mb",
  stage: "lab",
  artifacts: [
    { imageType: "app", fileName: "tgc_initial_lab.ino.bin", sizeBytes: 1200000, sha256: "a".repeat(64), offset: 0x10000 },
    { imageType: "full", fileName: "tgc_initial_lab.ino.merged.bin", sizeBytes: 16777216, sha256: "b".repeat(64), offset: 0 }
  ]
};

test("canonical releaseId keeps version's v-prefix out of the id", () => {
  assert.equal(releaseIdFor("TGC", "v0.1.0-initial.1", "0a9113e"), "TGC-0.1.0-initial.1-0a9113e");
  assert.equal(releaseIdFor("TMM", "0.6.1", "b13e556"), "TMM-0.6.1-b13e556");
});

test("one build binds both artifacts to one release", () => {
  const manifest = buildArtifactManifest(validPair);
  assert.equal(manifest.releaseId, "TGC-0.1.0-initial.1-0a9113e");
  assert.equal(manifest.artifacts.length, 2);
  const [app, full] = manifest.artifacts;
  assert.equal(app.transport, "ota");
  assert.equal(full.transport, "usb");
  for (const artifact of manifest.artifacts) {
    assert.equal(artifact.releaseId, manifest.releaseId);
    assert.equal(artifact.sourceCommit, manifest.sourceCommit);
    assert.equal(artifact.profileId, manifest.profileId);
  }
  assert.deepEqual(validateArtifactManifest(manifest), []);
});

test("a missing artifact makes the package invalid", () => {
  for (const drop of ["app", "full"]) {
    const pair = { ...validPair, artifacts: validPair.artifacts.filter((a) => a.imageType !== drop) };
    assert.throws(() => buildArtifactManifest(pair), new RegExp(drop));
  }
  const both = { ...validPair, artifacts: [validPair.artifacts[0], validPair.artifacts[0]] };
  assert.throws(() => buildArtifactManifest(both), /one 'app' and one 'full'/);
});

test("checksum, size, and releaseId drift invalidate the package", () => {
  const manifest = buildArtifactManifest(validPair);
  const badSha = structuredClone(manifest);
  badSha.artifacts[0].sha256 = "not-a-checksum";
  assert.ok(validateArtifactManifest(badSha).some((e) => e.includes("sha256")));

  const badSize = structuredClone(manifest);
  badSize.artifacts[1].sizeBytes = 0;
  assert.ok(validateArtifactManifest(badSize).some((e) => e.includes("sizeBytes")));

  const badBinding = structuredClone(manifest);
  badBinding.artifacts[1].releaseId = "TGC-0.1.0-initial.1-deadbee";
  assert.ok(validateArtifactManifest(badBinding).some((e) => e.includes("not bound")));

  const badId = structuredClone(manifest);
  badId.releaseId = "TGC-v0.1.0-initial.1-0a9113e";
  assert.ok(validateArtifactManifest(badId).some((e) => e.includes("canonical")));
});

test("hardware-profile template stays UNCONFIRMED everywhere", async () => {
  const template = JSON.parse(await readFile(new URL("../profiles/_template/profile.json", import.meta.url), "utf8"));
  const scalar = ["profileId", "productCode", "hardwareRevision", "chipFamily", "flashSize", "flashMode", "partitionScheme", "wifiSupported", "ethernetSupported", "setupControl"];
  for (const field of scalar) assert.equal(template[field], "UNCONFIRMED", field);
  assert.deepEqual(template.evidence, [], "template carries no evidence claims");
});