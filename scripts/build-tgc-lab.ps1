# Builds the TGC Telemetric Ground Checker Initial LAB firmware and emits
# ONE dual-artifact release package bound by one releaseId (stage=lab):
#   - merged/full BIN for USB bootstrap/recovery;
#   - app-only BIN for OTA/LAN;
#   - manifest.json produced by the universal core manifest builder.
#
# Board facts (ESP32-S3 / 16MB / quad->qio / tgc-ota-16mb) come from the
# board-proven TGC_LAB_ESP32S3_16M profile (read-only esptool flash_id on
# COM11, 2026-09-04). This build claims nothing about other hardware,
# including ESP32 classic — no classic board is verified. No flashing.
#
# The repo path contains spaces, which the ESP32 toolchain cannot handle in
# include flags, so the generated factory-Wi-Fi header and the HAL header are
# staged into a space-free temporary include directory (same trick as the
# esp32 core's partition hook).
param(
  [string]$OutputDir = "products/tgc/build/tgc_initial_lab"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$outPath = Join-Path $repoRoot $OutputDir
$includeDir = Join-Path $env:TEMP "tgc-initial-include"
New-Item -ItemType Directory -Force -Path $outPath, $includeDir | Out-Null

# Stage a space-free include dir: HAL header + generated LAB factory header.
Copy-Item (Join-Path $repoRoot "src\adapters\esp32\telemetric_esp32_hal.h") $includeDir -Force
node (Join-Path $repoRoot "scripts\generate-factory-wifi-header.mjs") (Join-Path $includeDir "factory_wifi_lab.h")
if ($LASTEXITCODE -ne 0) { throw "factory header generation failed" }
# The sketch also includes its local firmware_version.h next to the .ino.
Copy-Item (Join-Path $repoRoot "products\tgc\tgc_initial_lab\firmware_version.h") $includeDir -Force

$buildId = git -C $repoRoot rev-parse --short=7 HEAD
$sourceCommit = git -C $repoRoot rev-parse HEAD

# Official release gate: the worktree must be fully committed (ignored build
# outputs are excluded by git itself), so the manifest's provenance SHAs can
# never describe uncommitted source.
node (Join-Path $repoRoot "scripts\assert-clean-worktree.mjs") $repoRoot
if ($LASTEXITCODE -ne 0) { throw "dirty-worktree gate failed" }
$versionHeader = Join-Path $repoRoot "products\tgc\tgc_initial_lab\firmware_version.h"
$defines = @{}
Get-Content -LiteralPath $versionHeader | ForEach-Object {
  if ($_ -match '^\s*#define\s+(TGC_BOOT_VERSION_(?:MAJOR|MINOR|PATCH))\s+(\d+)\s*$') {
    $defines[$matches[1]] = [int]$matches[2]
  }
  if ($_ -match '^\s*#define\s+TGC_BOOT_VERSION_PRERELEASE\s+(\S+)\s*$') {
    $defines["PRERELEASE"] = $matches[1]
  }
}
if ($defines.TGC_BOOT_VERSION_MAJOR -eq $null -or $defines.TGC_BOOT_VERSION_MINOR -eq $null -or $defines.TGC_BOOT_VERSION_PATCH -eq $null) {
  throw "Could not read TGC_BOOT_VERSION_* macros from $versionHeader"
}
# The version string is EXACTLY the runtime FIRMWARE_VERSION (no v-prefix),
# so the manifest, the runtime identity, and the releaseId all agree:
# 0.1.0-initial.1 -> releaseId TGC-0.1.0-initial.1-<commit>.
$version = "$($defines.TGC_BOOT_VERSION_MAJOR).$($defines.TGC_BOOT_VERSION_MINOR).$($defines.TGC_BOOT_VERSION_PATCH)"
if ($defines["PRERELEASE"]) { $version = "$version-$($defines['PRERELEASE'])" }

$compileArgs = @(
  "compile",
  "--fqbn", "esp32:esp32:esp32s3:FlashSize=16M,FlashMode=qio,PartitionScheme=custom",
  "--build-property", "compiler.cpp.extra_flags=-I$($includeDir -replace '\\','/')",
  "--output-dir", $outPath,
  (Join-Path $repoRoot "products\tgc\tgc_initial_lab")
)
& arduino-cli @compileArgs
if ($LASTEXITCODE -ne 0) { throw "arduino-cli compile failed with exit code $LASTEXITCODE" }

$appBin = Join-Path $outPath "tgc_initial_lab.ino.bin"
$mergedBin = Join-Path $outPath "tgc_initial_lab.ino.merged.bin"
if (!(Test-Path -LiteralPath $appBin)) { throw "app-only BIN not produced: $appBin" }
if (!(Test-Path -LiteralPath $mergedBin)) { throw "merged BIN not produced: $mergedBin" }

node (Join-Path $repoRoot "scripts\emit-manifest.mjs") `
  --app $appBin `
  --merged $mergedBin `
  --out (Join-Path $outPath "manifest.json") `
  --build-id $buildId `
  --source-commit $sourceCommit `
  --profile (Join-Path $repoRoot "profiles\TGC_LAB_ESP32S3_16M\profile.json") `
  --version $version
if ($LASTEXITCODE -ne 0) { throw "manifest emission or verification failed" }

node (Join-Path $repoRoot "scripts\emit-library-manifests.mjs") `
  --manifest (Join-Path $outPath "manifest.json") `
  --out-dir $outPath `
  --source-repository "https://github.com/TaufikAS0/2026-telemetric-ground-checker"
if ($LASTEXITCODE -ne 0) { throw "library manifest emission failed" }

Write-Host "Release package written to: $outPath"
Get-ChildItem $outPath -Filter *.bin | Select-Object Name, Length