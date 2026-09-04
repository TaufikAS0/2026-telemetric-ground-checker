// Hardware-profile validation for release builds (TGC firmware repo).
//
// Rules (Telemetric Device Bootstrap Standard, "Profile rules"):
// - Mandatory build fields must be CONFIRMED: any missing or literal
//   "UNCONFIRMED" mandatory field blocks every build (LAB included).
// - Optional feature fields may stay "UNCONFIRMED" for a LAB build, but the
//   related feature MUST then be disabled and must never be claimed: the
//   validator returns them as `disabledFeatures` and the release manifest
//   records them.
// - `stage` is mandatory and must be a declared build stage.

import { BUILD_STAGES } from "./stage-guard.mjs";

export const PROFILE_MANDATORY_FIELDS = Object.freeze([
  "productCode",
  "profileId",
  "hardwareRevision",
  "chipFamily",
  "flashSize",
  "flashMode",
  "partitionScheme",
  "wifiSupported"
]);

// Optional feature fields -> the feature name recorded in disabledFeatures.
export const PROFILE_OPTIONAL_FEATURES = Object.freeze({
  ethernetSupported: "ethernet",
  setupControl: "physical-setup-control"
});

const UNCONFIRMED = "UNCONFIRMED";

export function validateProfile(profile) {
  const errors = [];
  const disabledFeatures = [];

  if (!profile || typeof profile !== "object") {
    return { errors: ["profile must be a JSON object"], disabledFeatures };
  }

  for (const field of PROFILE_MANDATORY_FIELDS) {
    const value = profile[field];
    if (value === undefined || value === null || value === "") {
      errors.push(`mandatory profile field is missing: ${field}`);
    } else if (typeof value === "string" && value === UNCONFIRMED) {
      errors.push(`mandatory profile field is ${UNCONFIRMED}: ${field}`);
    }
  }
  if ("wifiSupported" in profile && typeof profile.wifiSupported !== "boolean" && profile.wifiSupported !== UNCONFIRMED) {
    errors.push("wifiSupported must be a boolean");
  }

  for (const [field, feature] of Object.entries(PROFILE_OPTIONAL_FEATURES)) {
    const value = profile[field];
    if (value === undefined) continue; // optional field absent = feature not offered
    if (value === UNCONFIRMED) {
      // Allowed for a LAB build only as a disabled, unclaimed feature.
      disabledFeatures.push(feature);
    } else if (typeof value !== "boolean") {
      errors.push(`${field} must be a boolean or the literal ${UNCONFIRMED}`);
    }
  }

  if (!BUILD_STAGES.includes(profile.stage)) {
    errors.push(`stage is required and must be one of: ${BUILD_STAGES.join(", ")}`);
  }

  return { errors, disabledFeatures };
}
