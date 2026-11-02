# Syncs crates downloaded through the rsproxy mirror into the crates.io cache
# directory, so plain `cargo build --offline` works on this machine.
#
# Background: static.crates.io connections stall on this network, so dependencies
# are fetched with:
#   cargo --config <mirror.toml> fetch ...
# This script then copies the resulting .crate files into the crates.io cache.
# Cargo verifies every file against Cargo.lock, so the copy is safe.

$ErrorActionPreference = 'Stop'

$cacheRoot = Join-Path $env:USERPROFILE '.cargo\registry\cache'
$target = Get-ChildItem $cacheRoot -Directory -Filter 'index.crates.io-*' | Select-Object -First 1
$source = Get-ChildItem $cacheRoot -Directory -Filter 'rsproxy.cn-*' | Select-Object -First 1

if (-not $target) { throw 'crates.io cache dir not found' }
if (-not $source) { Write-Output 'no mirror cache, nothing to sync'; exit 0 }

$copied = 0
Get-ChildItem $source.FullName -File -Filter *.crate | ForEach-Object {
    $dest = Join-Path $target.FullName $_.Name
    if (-not (Test-Path -LiteralPath $dest)) {
        Copy-Item -LiteralPath $_.FullName -Destination $dest
        $script:copied++
    }
}

Write-Output ("synced {0} crates into {1}" -f $copied, $target.Name)
