// Generates a C++ header from the tracked LAB factory Wi-Fi config
// (src/config/factory-wifi.mjs) so the JS config stays the single source of
// truth. The generated header carries a static_assert that blocks the sketch
// if the LAB default is ever switched off (production injection).
//
// Usage: node scripts/generate-factory-wifi-header.mjs <output-header-path>

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { FACTORY_WIFI, FACTORY_WIFI_IS_LAB_DEFAULT } from "../src/config/factory-wifi.mjs";

const output = process.argv[2];
if (!output) {
  console.error("usage: node scripts/generate-factory-wifi-header.mjs <output-header-path>");
  process.exit(1);
}

const header = `#pragma once
// GENERATED from src/config/factory-wifi.mjs — do not edit by hand.
//
// LAB DEFAULT — NOT FOR PRODUCTION
// The device owner explicitly approved this factory Wi-Fi credential as a
// PUBLIC lab value (2026-08-31): it is tracked in Git, stays in Git history,
// and is embedded in every LAB BIN. The password must never be printed to
// serial logs, test output, or errors. Production must inject per-unit
// secrets instead; the static_assert below blocks this sketch if the LAB
// default is ever disabled.

#include <Arduino.h>

struct TelemetricFactoryWifi {
  const char *ssid;
  const char *password;
};

static const TelemetricFactoryWifi kFactoryWifiCredentials = {
    ${JSON.stringify(FACTORY_WIFI.ssid)}, ${JSON.stringify(FACTORY_WIFI.password)}};

static constexpr bool kFactoryWifiIsLabDefault = ${FACTORY_WIFI_IS_LAB_DEFAULT};
static_assert(kFactoryWifiIsLabDefault,
    "LAB factory Wi-Fi default is disabled: production must inject secrets, not reuse this sketch");
`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, header);
console.log(`generated: ${output}`);