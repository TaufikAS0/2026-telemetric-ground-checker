// Build-stage guard (real enforcement, not documentation).
//
// Build/profile tooling MUST call assertStageAllowed before compiling any
// BIN. A production build refuses to run while the public LAB factory Wi-Fi
// default is still active; LAB builds pass. The flag is read at call time
// from src/config/factory-wifi.mjs, so replacing that file (or injecting a
// per-unit secret config) is the production unlock.

import { FACTORY_WIFI_IS_LAB_DEFAULT } from "../config/factory-wifi.mjs";

export const BUILD_STAGES = Object.freeze(["lab", "production"]);

export function assertStageAllowed({ stage }) {
  if (!BUILD_STAGES.includes(stage)) {
    throw new Error(`unknown build stage: ${stage} (expected one of: ${BUILD_STAGES.join(", ")})`);
  }
  if (stage === "production" && FACTORY_WIFI_IS_LAB_DEFAULT) {
    throw new Error(
      "production build refused: the public LAB factory Wi-Fi default is still active " +
      "(FACTORY_WIFI_IS_LAB_DEFAULT). Remove src/config/factory-wifi.mjs or replace it with " +
      "per-unit secret injection before building for production."
    );
  }
  return { ok: true, stage };
}
