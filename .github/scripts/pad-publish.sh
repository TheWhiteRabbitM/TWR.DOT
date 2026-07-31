#!/usr/bin/env bash
#
# Publish a built bundle with `pad`, and survive a bad draw from the storage pool.
#
# WHY THIS EXISTS
#   pad picks a Bulletin storage account from a shared pool, and not every pool
#   account is authorised. On a bad draw it fails hard rather than trying
#   another:
#
#     Deployment failed: Bulletin storage account pool account 1 (5Gut8tFY...)
#     is not authorized (or its authorization expired). polkadot-app-deploy no
#     longer self-authorizes on the Bulletin chain
#
#   That cost two hourly runs in a row. Retrying by hand drew pool account 5 and
#   published first time, which is the whole diagnosis: it is a lottery, not a
#   broken account of ours.
#
# HOW BAD THE ODDS ACTUALLY ARE (measured 2026-07-31)
#   Five of the ten pool accounts are unauthorized, so a draw is close to a coin
#   flip. At four attempts a single app fails 0.5^4 = 6.25% of the time, and
#   across seven apps that is a failed run more often than not — which is what
#   happened: truereviews drew accounts 4, 2, 0, 4 and gave up. Ten attempts puts
#   it at 0.1% per app. The retries are cheap (a bad draw fails in ~9 seconds and
#   writes nothing), so the only thing more attempts costs is log lines.
#
#   This is a workaround, not a fix. The fix is for the chain's authorizer to
#   re-authorize the dead pool accounts; we cannot, because every grant path
#   fails `{"type":"Invalid","value":{"type":"Payment"}}` for want of funds on
#   Bulletin. The keepalive workflow's pool report is what surfaces that.
#
#   The failure was also invisible. The workflow piped pad through `grep`, so a
#   seven-second failure printed nothing at all and the log showed a build
#   followed by "exit code 1". Everything pad says is now kept, and shown when
#   we give up.
#
# CONFIRMATION IS "Verified on-chain", NOT THE EXIT CODE
#   pad has printed cheerful progress and then failed at the last step before.
#   The only accepted proof is that phrase in its output.
#
#   pad-publish.sh <dist-dir> <name.dot> [attempts]
set -uo pipefail

DIR="${1:?usage: pad-publish.sh <dist-dir> <name.dot> [attempts]}"
NAME="${2:?usage: pad-publish.sh <dist-dir> <name.dot> [attempts]}"
ATTEMPTS="${3:-10}"
LOG="$(mktemp)"

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "--- $NAME: publish attempt $attempt of $ATTEMPTS ---"
  pad "$DIR" "$NAME" --env devnet 2>&1 | tr -d '\r' | tee "$LOG" \
    | grep -aE 'pool account|Setting contenthash|Verified on-chain|Files:|Deployment failed' \
    | tail -5 || true

  if grep -aq 'Verified on-chain' "$LOG"; then
    echo "$NAME: published and verified on-chain"
    exit 0
  fi

  if grep -aq 'not authorized' "$LOG"; then
    echo "::warning::$NAME: drew an unauthorised storage pool account — retrying"
  else
    echo "::warning::$NAME: publish did not verify — retrying"
  fi
  sleep 10
done

echo "::error::$NAME: never verified on-chain after $ATTEMPTS attempts" >&2
echo "--- last 30 lines of pad output ---" >&2
tail -30 "$LOG" >&2
exit 1
