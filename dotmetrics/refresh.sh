#!/usr/bin/env bash
#
# One-command self-update for dotmetrics: re-index the .dot registry, re-measure
# ecosystem activity, upload the fresh directory to Bulletin, and republish the
# site. Run it on a schedule (cron / Windows Task Scheduler) and the dashboard
# keeps itself current — no manual step.
#
# Why a scheduled script and not a runtime pointer: the app fetches its directory
# from a Bulletin CID, and the honest way to point at "the latest" would be a
# DotNS text record. That record CAN be set, but this devnet's resolver doesn't
# expose it to a plain eth_call (it reverts), so the browser can't read a mutable
# pointer today. A scheduled re-publish is the working alternative.
set -uo pipefail
export PATH="/usr/local/bin:$HOME/.cargo/bin:$PATH"
export MNEMONIC="$(node -p 'JSON.parse(require("fs").readFileSync(process.env.HOME + "/.cdm/accounts.json","utf8")).devnet.mnemonic')"
export DOTNS_MNEMONIC="$MNEMONIC"
[ -z "${MNEMONIC:-}" ] && { echo "no mnemonic" >&2; exit 1; }

APP="/mnt/c/Users/miche/Downloads/DOT APP/dotmetrics"
cd "$APP" || exit 1

echo "===== 1/5 re-index registry + records + timestamps + activity ====="
# index-apps admits a name only when registry.owner() confirms it; enrich-onchain
# then reads each admitted name's owner, manifest, contenthash and executable
# record straight off the content resolver. Everything the UI shows comes from
# these two passes, so neither may be skipped.
node indexer/index-apps.mjs
node indexer/enrich-onchain.mjs
node indexer/enrich-times.mjs
WINDOW=150 node indexer/measure-activity.mjs

echo "===== 2/5 copy fresh data into the app ====="
cp indexer/apps.json src/lib/discovered.json
cp indexer/ecosystem.json src/lib/ecosystem.json
# history.jsonl -> JSON array the app imports (last 240 points ≈ 60 days at 6h)
node -e '
const fs = require("fs");
const lines = fs.readFileSync("indexer/history.jsonl", "utf8").trim().split("\n").filter(Boolean);
const arr = lines.slice(-240).map((l) => JSON.parse(l));
fs.writeFileSync("src/lib/history.json", JSON.stringify(arr) + "\n");
console.log("history points:", arr.length);
'

echo "===== 3/5 upload directory to Bulletin ====="
CID=$(dotns bulletin upload src/lib/discovered.json --env devnet 2>&1 | tr -d '\r' | grep -aoE 'baf[a-z0-9]{50,}' | head -1)
[ -z "$CID" ] && { echo "upload failed" >&2; exit 1; }
echo "new directory CID: $CID"
# pin the fresh CID as the runtime source (baked fallback stays current too)
sed -i "s|export const DIRECTORY_CID = '[a-z0-9]*'|export const DIRECTORY_CID = '$CID'|" src/lib/directory.ts

echo "===== 4/5 build (Windows node via interop) ====="
# node_modules here is installed for win32: tsc/rolldown native binaries have no
# linux variant on disk, so an in-WSL build crashes and pad re-publishes the old
# dist. cmd.exe interop runs the build with Windows node against the same tree.
cmd.exe /c "npm run build" || { echo "build failed — aborting publish so the old UI is not re-published as fresh" >&2; exit 1; }

echo "===== 5/5 publish ====="
pad ./dist dotmetrics.dot --env devnet 2>&1 | grep -aE 'Setting contenthash|Verified on-chain|Files:' | tail -4
echo "done: dotmetrics.dot refreshed $(date -u +%Y-%m-%dT%H:%MZ)"
