// Builds the release manifest for one dual-artifact TGC Initial LAB package
// using the universal core (src/core/artifact-manifest.mjs), so the real
// build output is validated by exactly the same code the tests exercise.
//
// Usage:
//   node scripts/emit-manifest.mjs \
//     --app <app-bin> --merged <merged-bin> --out <manifest.json> \
//     --build-id <short-commit> --source-commit <full-commit> \
//     --profile <profile.json> --version vX.Y.Z

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { buildArtifactManifest, validateArtifactManifest } from "../src/core/artifact-manifest.mjs";
import { validateProfile } from "../src/core/profile.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function artifactInfo(path, imageType) {
  const bytes = readFileSync(path);
  if (bytes.length < 1) throw new Error(`${imageType} artifact is empty: ${path}`);
  return {
    imageType,
    fileName: path.split(/[\\/]/).pop(),
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    offset: imageType === "app" ? 0x10000 : 0
  };
}

const appPath = argument("--app");
const mergedPath = argument("--merged");
const outPath = argument("--out");
const buildId = argument("--build-id");
const sourceCommit = argument("--source-commit");
const profilePath = argument("--profile");
const version = argument("--version");
if (!appPath || !mergedPath || !outPath || !buildId || !sourceCommit || !profilePath || !version) {
  console.error("missing required arguments");
  process.exit(1);
}

const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const profileCheck = validateProfile(profile);
if (profileCheck.errors.length) {
  console.error(`profile invalid: ${profileCheck.errors.join("; ")}`);
  process.exit(1);
}
if (profileCheck.disabledFeatures.length) {
  console.log(`profile optional features stay UNCONFIRMED and are DISABLED/unclaimed: ${profileCheck.disabledFeatures.join(", ")}`);
}
if (profile.profileId === "UNCONFIRMED" || profile.chipFamily === "UNCONFIRMED") {
  console.error("profile contains UNCONFIRMED mandatory facts; BIN build is not allowed");
  process.exit(1);
}

const manifest = buildArtifactManifest({
  productCode: profile.productCode,
  version,
  buildId,
  sourceCommit,
  profileId: profile.profileId,
  chipFamily: profile.chipFamily,
  flashSize: profile.flashSize,
  flashMode: profile.flashMode,
  partitionScheme: profile.partitionScheme,
  stage: profile.stage,
  disabledFeatures: profileCheck.disabledFeatures,
  artifacts: [artifactInfo(appPath, "app"), artifactInfo(mergedPath, "full")]
});

const errors = validateArtifactManifest(manifest);
if (errors.length) {
  console.error(`manifest invalid: ${errors.join("; ")}`);
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");

// Re-verify the persisted manifest against the physical files.
const persisted = JSON.parse(readFileSync(outPath, "utf8"));
for (const artifact of persisted.artifacts) {
  const bytes = readFileSync(`${outPath.split(/[\\/]/).slice(0, -1).join("/")}/${artifact.fileName}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== artifact.sha256 || bytes.length !== artifact.sizeBytes) {
    console.error(`checksum drift for ${artifact.fileName}`);
    process.exit(1);
  }
}

console.log(JSON.stringify({
  releaseId: persisted.releaseId,
  stage: persisted.stage,
  version: persisted.version,
  profileId: persisted.profileId,
  artifacts: persisted.artifacts.map((artifact) => ({
    imageType: artifact.imageType,
    fileName: artifact.fileName,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    offset: artifact.offset,
    transport: artifact.transport
  }))
}, null, 2));