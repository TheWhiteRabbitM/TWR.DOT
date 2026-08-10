#!/usr/bin/env bash
# Publish dotmetrics' built bundle, showing everything pad says.
#
# CI has failed this exact step twice, in seven seconds, with nothing in the log
# — the workflow pipes pad through grep, so a fast failure prints nothing at all.
# Running it by hand is the only way to read the reason.
#
# The mnemonic is loaded into the environment and never printed.
set -uo pipefail

# Never publish older numbers over newer ones. Done once on 10 August, from a
# checkout 188 commits behind, and nothing anywhere said so.
tr -d "" < "/mnt/c/Users/miche/Downloads/DOT APP/.github/scripts/check-index-fresh.sh" > /tmp/check-index-fresh.sh
bash /tmp/check-index-fresh.sh || exit 1

APP="/mnt/c/Users/miche/Downloads/DOT APP/dotmetrics"

ADDR=$(node -e '
const fs=require("fs"),os=require("os");
process.stdout.write(JSON.parse(fs.readFileSync(os.homedir()+"/.cdm/accounts.json","utf8")).devnet.address);
')
echo "signing account (public address): $ADDR"

export MNEMONIC=$(node -e '
const fs=require("fs"),os=require("os");
process.stdout.write(JSON.parse(fs.readFileSync(os.homedir()+"/.cdm/accounts.json","utf8")).devnet.mnemonic);
')
export DOTNS_MNEMONIC="$MNEMONIC"
[ -z "$MNEMONIC" ] && { echo "FAILED: no mnemonic in the keystore" >&2; exit 1; }

cd "$APP" || { echo "FAILED: $APP unreachable" >&2; exit 1; }
[ -f dist/index.html ] || { echo "FAILED: dist/index.html missing — build first" >&2; exit 1; }
echo "publishing $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
echo

# NOT piped through grep: the whole point is to see what CI could not.
pad ./dist dotmetrics.dot --env devnet 2>&1 | tr -d '\r' | tee /tmp/pad-dotmetrics.log
echo
echo "===== verdict ====="
if grep -aq 'Verified on-chain' /tmp/pad-dotmetrics.log; then
  echo "PUBLISHED and verified on-chain"
  grep -aE 'Setting contenthash|Verified on-chain|Files:|Root CID' /tmp/pad-dotmetrics.log | tail -5
else
  echo "NOT CONFIRMED — full output above; last lines:"
  tail -20 /tmp/pad-dotmetrics.log
  exit 1
fi
