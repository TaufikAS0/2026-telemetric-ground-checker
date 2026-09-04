import test from "node:test";
import assert from "node:assert/strict";
import { assertStageAllowed, BUILD_STAGES } from "../src/core/stage-guard.mjs";
import { buildArtifactManifest, validateArtifactManifest } from "../src/core/artifact-manifest.mjs";
import { FACTORY_WIFI_IS_LAB_DEFAULT } from "../src/config/factory-wifi.mjs";

const validPair = {
  productCode: "TGC",
  version: "v0.1.0-initial.1",
  buildId: "0000000",
  sourceCommit: "0000000000000000000000000000000000000000",
  profileId: "TGC_LAB_ESP32S3_16M",
  chipFamily: "ESP32-S3",
  flashSize: "16MB",
  flashMode: "qio",
  partitionScheme: "tgc-ota-16mb",
  artifacts: [
    { imageType: "app", fileName: "app.bin", sizeBytes: 1024, sha256: "a".repeat(64), offset: 0x10000 },
    { imageType: "full", fileName: "merged.bin", sizeBytes: 16777216, sha256: "b".repeat(64), offset: 0 }
  ]
};

test("the LAB flag is active, so this repo is a LAB-stage source tree", () => {
  assert.equal(FACTORY_WIFI_IS_LAB_DEFAULT, true);
  assert.deepEqual([...BUILD_STAGES], ["lab", "production"]);
});

test("LAB builds are allowed while the public factory default is active", () => {
  assert.deepEqual(assertStageAllowed({ stage: "lab" }), { ok: true, stage: "lab" });
  assert.deepEqual(buildArtifactManifest({ ...validPair, stage: "lab" }).releaseId, "TGC-0.1.0-initial.1-0000000");
});

test("production builds are rejected while the LAB default is active", () => {
  assert.throws(
    () => assertStageAllowed({ stage: "production" }),
    /production build refused.*FACTORY_WIFI_IS_LAB_DEFAULT/s
  );
  assert.throws(
    () => buildArtifactManifest({ ...validPair, stage: "production" }),
    /production build refused/,
    "the manifest builder enforces the guard, not just the helper"
  );
  assert.throws(() => assertStageAllowed({ stage: "staging" }), /unknown build stage/);
});

test("stage is mandatory: a manifest without a stage is rejected", () => {
  for (const stage of [undefined, null, ""]) {
    assert.throws(
      () => buildArtifactManifest({ ...validPair, stage }),
      /stage is required: 'lab' or 'production'/
    );
  }
  // Regression: the old optional-stage path must be gone entirely.
  const manifest = buildArtifactManifest({ ...validPair, stage: "lab" });
  assert.equal(manifest.stage, "lab", "the built manifest records its stage");
  assert.deepEqual(validateArtifactManifest(manifest), [], "revalidation keeps the stage binding");
});