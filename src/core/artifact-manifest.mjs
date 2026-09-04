// Universal dual-artifact release manifest (TGC firmware repo):
// one version + one hardware profile builds BOTH artifacts in one run,
// bound by one releaseId. Missing or drifting artifacts invalidate the
// package. Pure validation logic; the compile step lives in product adapters.

import { assertStageAllowed } from "./stage-guard.mjs";

export const ARTIFACT_IMAGE_TYPES = Object.freeze(["app", "full"]);
export const ARTIFACT_TRANSPORTS = Object.freeze({ app: "ota", full: "usb" });

// Canonical releaseId: <PRODUCT>-<version without leading v>-<buildId>,
// e.g. TGC-0.1.0-initial.1-0a9113e. The version field itself keeps its v-prefix.
export function releaseIdFor(productCode, version, buildId) {
  return `${productCode}-${String(version).replace(/^v/, "")}-${buildId}`;
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

// Builds the manifest for one release package. `artifacts` carries the
// physical-file facts recorded by the build script:
//   { imageType, fileName, sizeBytes, sha256, offset }
export function buildArtifactManifest({
  productCode,
  version,
  buildId,
  sourceCommit,
  profileId,
  chipFamily,
  flashSize,
  flashMode,
  partitionScheme,
  stage,
  disabledFeatures = [],
  artifacts
}) {
  // stage is mandatory: a release package must declare its build stage so the
  // production guard below can never be bypassed by omitting it.
  if (stage === undefined || stage === null || stage === "") {
    throw new Error("stage is required: 'lab' or 'production'");
  }
  assertStageAllowed({ stage });
  const errors = [];
  if (!productCode) errors.push("productCode is required");
  if (!version) errors.push("version is required");
  if (!buildId) errors.push("buildId is required");
  if (!profileId) errors.push("profileId is required");
  if (!Array.isArray(artifacts) || artifacts.length !== 2) {
    errors.push("exactly two artifacts (app + full) are required in one run");
  } else {
    const types = artifacts.map((artifact) => artifact.imageType).sort();
    if (types.join(",") !== "app,full") {
      errors.push("one 'app' and one 'full' artifact are required");
    }
    for (const artifact of artifacts) {
      if (!artifact.fileName) errors.push(`${artifact.imageType}: fileName is required`);
      if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes < 1) {
        errors.push(`${artifact.imageType}: sizeBytes must be a positive integer`);
      }
      if (!isSha256(artifact.sha256)) {
        errors.push(`${artifact.imageType}: sha256 must be 64 lowercase hex characters`);
      }
      if (!Number.isInteger(artifact.offset) || artifact.offset < 0) {
        errors.push(`${artifact.imageType}: offset must be a non-negative integer`);
      }
    }
    const app = artifacts.find((artifact) => artifact.imageType === "app");
    const full = artifacts.find((artifact) => artifact.imageType === "full");
    if (app && app.transport && app.transport !== ARTIFACT_TRANSPORTS.app) {
      errors.push("app artifact transport must be 'ota'");
    }
    if (full && full.transport && full.transport !== ARTIFACT_TRANSPORTS.full) {
      errors.push("full artifact transport must be 'usb'");
    }
  }
  if (errors.length) throw new Error(errors.join("; "));

  const releaseId = releaseIdFor(productCode, version, buildId);
  const shared = { productCode, version, buildId, sourceCommit, profileId, chipFamily, flashSize, flashMode, partitionScheme, stage, disabledFeatures, releaseId };
  return {
    schemaVersion: 1,
    ...shared,
    artifacts: artifacts.map((artifact) => ({
      ...shared,
      imageType: artifact.imageType,
      fileName: artifact.fileName,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      offset: artifact.offset,
      transport: ARTIFACT_TRANSPORTS[artifact.imageType]
    }))
  };
}

// Re-validates a persisted manifest (parse from JSON before calling).
export function validateArtifactManifest(manifest) {
  const errors = [];
  try {
    buildArtifactManifest({ ...manifest, artifacts: manifest.artifacts });
  } catch (error) {
    errors.push(...String(error.message).split("; "));
  }
  if (manifest.releaseId !== releaseIdFor(manifest.productCode, manifest.version, manifest.buildId)) {
    errors.push("releaseId does not match the canonical format");
  }
  for (const artifact of manifest.artifacts ?? []) {
    if (artifact.releaseId !== manifest.releaseId) {
      errors.push(`${artifact.imageType}: artifact is not bound to the release`);
    }
  }
  return errors;
}
