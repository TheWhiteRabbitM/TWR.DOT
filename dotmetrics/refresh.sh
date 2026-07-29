#!/usr/bin/env bash
#
# One-command self-update for dotmetrics: re-index the .dot registry, re-measure
# ecosystem activity, probe bundle liveness, and — ONLY when something
# meaningfully changed — upload the fresh directory and move the `directory`
# text record on dotmetrics.dot to it. The page reads that record at runtime,
# so moving the record IS the deploy; the site itself is rebuilt and
# republished only when the app source actually changed.
#
# (An earlier version of this header claimed the resolver would not expose text
# records to a plain eth_call. That was true of the DEAD resolver behind
# registry.resolver(); the content resolver answers eth_call fine when called
# directly, which is what the app does — see src/lib/dotns.ts.)
#
# Every Bulletin write counts against a finite transaction quota, so an
# unchanged run costs zero transactions and says so. This is the local (WSL)
# mirror of .github/workflows/dotmetrics-refresh.yml — keep the two in step.
set -uo pipefail
export PATH="/usr/local/bin:$HOME/.cargo/bin:$PATH"
export MNEMONIC="$(node -p 'JSON.parse(require("fs").readFileSync(process.env.HOME + "/.cdm/accounts.json","utf8")).devnet.mnemonic')"
export DOTNS_MNEMONIC="$MNEMONIC"
[ -z "${MNEMONIC:-}" ] && { echo "no mnemonic" >&2; exit 1; }

APP="/mnt/c/Users/miche/Downloads/DOT APP/dotmetrics"
cd "$APP" || exit 1

echo "===== 1/5 re-index registry + records + timestamps + activity + liveness ====="
# index-apps admits a name only when registry.owner() confirms it; enrich-onchain
# then reads each admitted name's owner, manifest, contenthash and executable
# record straight off the content resolver. Everything the UI shows comes from
# these two passes, so neither may be skipped. probe-liveness asks our gateway
# whether each contenthash is still served, with a mass-death guard so one bad
# gateway minute is never recorded as an ecosystem death.
node indexer/index-apps.mjs
node indexer/enrich-onchain.mjs
node indexer/enrich-times.mjs
WINDOW=150 node indexer/measure-activity.mjs
node indexer/probe-liveness.mjs
# track-changes runs AFTER probe-liveness: velocity needs the fresh contenthash
# and the changelog reads the CONFIRMED liveness state. build-feed writes the
# static feed straight into public/ (Vite copies it into dist on the next
# publish). Both diff against snapshots kept in state.json / src/lib.
node indexer/track-changes.mjs
node indexer/build-feed.mjs

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

echo "===== 3/5 directory: upload + move the record, only when it changed ====="
# grep WITHOUT -q, deliberately: -q exits on the first match, tee upstream can
# then die of SIGPIPE, and under pipefail that would read as "skip" — a silent
# lie. Plain grep drains its input and echoes the decision line into the log.
if node indexer/directory-digest.mjs check | tee /tmp/dirgate.log | grep '^PUBLISH'; then
  CID=$(dotns bulletin upload src/lib/discovered.json --env devnet 2>&1 | tr -d '\r' | grep -aoE 'baf[a-z0-9]{50,}' | head -1)
  [ -z "$CID" ] && { echo "upload failed" >&2; exit 1; }
  echo "new directory CID: $CID"
  # Move the mutable pointer the page reads at runtime, then CONFIRM it by
  # reading it back over eth_call: a set we cannot read back did not happen,
  # whatever the CLI printed. A few retries absorb propagation lag.
  dotns text set dotmetrics.dot directory "$CID" --env devnet 2>&1 | tr -d '\r'
  CONFIRMED=""
  for i in 1 2 3; do
    GOT=$(node indexer/read-record.mjs dotmetrics.dot directory || true)
    [ "$GOT" = "$CID" ] && { CONFIRMED=yes; break; }
    echo "read-back attempt $i: record is '$GOT', want '$CID' — retrying"
    sleep 6
  done
  [ -z "$CONFIRMED" ] && { echo "directory record set did NOT confirm on read-back" >&2; exit 1; }
  echo "record confirmed: dotmetrics.dot directory -> $CID"
  node indexer/directory-digest.mjs commit "$CID"
  # Re-pin the baked fallback for the NEXT site publish. The pin is masked out
  # of app-tree-hash, so this sed alone never triggers one.
  sed -i "s|export const DIRECTORY_CID = '[a-z0-9]*'|export const DIRECTORY_CID = '$CID'|" src/lib/directory.ts
fi

echo "===== 4/5 site: build + publish, only when the app source changed ====="
if node indexer/app-tree-hash.mjs check | tee /tmp/sitegate.log | grep '^PUBLISH'; then
  # node_modules here is installed for win32: tsc/rolldown native binaries have
  # no linux variant on disk, so an in-WSL build crashes and pad re-publishes
  # the old dist. cmd.exe interop runs the build with Windows node against the
  # same tree.
  cmd.exe /c "npm run build" || { echo "build failed — aborting publish so the old UI is not re-published as fresh" >&2; exit 1; }
  pad ./dist dotmetrics.dot --env devnet 2>&1 | tee /tmp/pad.log | grep -aE 'Setting contenthash|Verified on-chain|Files:' | tail -4
  grep -aq 'Verified on-chain' /tmp/pad.log || { echo "publish not verified on-chain" >&2; exit 1; }
  node indexer/app-tree-hash.mjs commit
fi

echo "===== 5/5 done ====="
echo "done: dotmetrics.dot refreshed $(date -u +%Y-%m-%dT%H:%MZ)"
