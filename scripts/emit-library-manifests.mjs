// Emits the two firmware-library manifests for one dual-artifact TGC
// release package: manifest-full.json (imageType full, transport usb) and
// manifest-app-only.json (imageType app-only, transport ota). Both carry the
// same shared fields and their own physical SHA-256 + byte size, so the
// handoff to the firmware library publisher is a straight copy.
//
// Usage:
//   node scripts/emit-library-manifests.mjs --manifest <build-manifest.json> \
//     --out-dir <package-dir> --source-repository <url>
//
// The library manifests are handoff metadata for the library publisher; they
// are NOT committed here and never contain credentials or passwords.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const manifestPath = argument("--manifest");
const outDir = argument("--out-dir");
const sourceRepository = argument("--source-repository");
if (!manifestPath || !outDir || !sourceRepository) {
  console.error("missing required arguments");
  process.exit(1);
}

const build = JSON.parse(readFileSync(manifestPath, "utf8"));
const app = build.artifacts.find((artifact) => artifact.imageType === "app");
const full = build.artifacts.find((artifact) => artifact.imageType === "full");
if (!app || !full) {
  console.error("build manifest must contain exactly one app and one full artifact");
  process.exit(1);
}

// Physical files are re-hashed here; manifest values must already match
// (emit-manifest.mjs verified this before persisting).
function physical(fileName) {
  const bytes = readFileSync(join(dirname(manifestPath), fileName));
  return {
    fileName,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

const appPhysical = physical(app.fileName);
const fullPhysical = physical(full.fileName);
for (const [label, physicalFacts, recorded] of [
  ["app", appPhysical, app],
  ["full", fullPhysical, full]
]) {
  if (physicalFacts.sha256 !== recorded.sha256 || physicalFacts.sizeBytes !== recorded.sizeBytes) {
    console.error(`${label}: physical file does not match the build manifest`);
    process.exit(1);
  }
}

const releaseNotes =
  "TGC Telemetric Ground Checker Initial LAB firmware: universal Telemetric Device " +
  "Bootstrap flow (stored NVS Wi-Fi -> factory LAB Wi-Fi -> TELEMETRIC-SETUP-<suffix> AP at " +
  "http://192.168.4.1/), device-info + LAN discovery + authenticated app-only OTA with A/B " +
  "slots and persistent pending-verify, USB merged recovery. Profile TGC_LAB_ESP32S3_16M " +
  "(ESP32-S3 / 16MB / qio / tgc-ota-16mb; board-proven via read-only chip detection). " +
  "Contains NO Ground Checker measurement, relay/output, or QC function. Stage lab; the " +
  "LAB factory Wi-Fi credential is public by owner decision and must be replaced before " +
  "production. Physical flash/provision/OTA on hardware is still pending.";

function libraryManifest(imageType, transport, facts, offset) {
  return {
    schemaVersion: 1,
    productCode: build.productCode,
    productName: "Telemetric Ground Checker",
    version: build.version,
    buildId: build.buildId,
    releaseId: build.releaseId,
    releaseTag: `${build.productCode}-v${build.version}`,
    sourceRepository,
    sourceCommit: build.sourceCommit,
    channel: "development",
    lifecycle: "draft",
    evidenceLevel: "built",
    stage: build.stage,
    firmwareRole: "bootstrap",
    hardwareRevision: build.profileId,
    chipFamily: build.chipFamily,
    flashSize: build.flashSize,
    flashMode: build.flashMode,
    partitionScheme: build.partitionScheme,
    imageType,
    offset,
    erasePolicy: "prompt",
    wifiCapable: true,
    fileName: facts.fileName,
    sizeBytes: facts.sizeBytes,
    sha256: facts.sha256,
    releaseNotes,
    createdAt: new Date().toISOString()
  };
}

const fullManifest = libraryManifest("full", "usb", fullPhysical, 0);
const appManifest = libraryManifest("app-only", "ota", appPhysical, app.offset);

writeFileSync(join(outDir, "manifest-full.json"), JSON.stringify(fullManifest, null, 2) + "\n");
writeFileSync(join(outDir, "manifest-app-only.json"), JSON.stringify(appManifest, null, 2) + "\n");

console.log(JSON.stringify({
  manifestFull: fullManifest.fileName,
  manifestAppOnly: appManifest.fileName,
  releaseId: build.releaseId,
  stage: build.stage,
  firmwareRole: "bootstrap"
}, null, 2));