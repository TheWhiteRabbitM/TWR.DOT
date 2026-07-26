#!/usr/bin/env bash
# Daily self-update: pull the latest ERA5 days from Open-Meteo (the original
# app's own pipeline, reused verbatim), rebuild, republish to Bulletin.
# Scheduled via Windows Task Scheduler -> refresh.cmd (WSL entry point).
set -uo pipefail
export PATH="/usr/local/bin:$HOME/.cargo/bin:$PATH"
export MNEMONIC="$(node -p 'JSON.parse(require("fs").readFileSync(process.env.HOME + "/.cdm/accounts.json","utf8")).devnet.mnemonic')"
export DOTNS_MNEMONIC="$MNEMONIC"
cd "/mnt/c/Users/miche/Downloads/DOT APP/italiarovente" || exit 1

echo "===== 1/3 refresh climate data (Open-Meteo, resilient to 429s) ====="
cmd.exe /c "npm run update-data" || echo "update-data had failures — committed data is reused for those cities"
cmd.exe /c "npm run update-sea" || echo "update-sea failed — keeping previous sea data"

echo "===== 2/3 build (Windows node via interop) ====="
cmd.exe /c "npm run build" || { echo "build failed — aborting publish" >&2; exit 1; }

echo "===== 3/3 publish ====="
pad ./dist italiarovente.dot --env devnet 2>&1 | grep -aE 'Setting contenthash|Verified on-chain|Files:' | tail -3
echo "done: italiarovente.dot refreshed $(date -u +%Y-%m-%dT%H:%MZ)"
