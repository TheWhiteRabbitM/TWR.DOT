#!/usr/bin/env bash
#
# Refuse to publish a dashboard built from data older than what is already on
# origin.
#
# WHY THIS EXISTS
#   The hourly GitHub Actions job measures the ecosystem and commits its
#   snapshots to origin. A local checkout that has not pulled them is not just
#   out of date, it is DANGEROUS: building and publishing from it silently
#   replaces the live dashboard with older numbers, and the site says nothing
#   because stale data renders exactly as well as fresh data.
#
#   Done once, on 10 August: published from a checkout 188 commits behind and
#   took the live survival figure from 158 apps measured that morning back to
#   107 measured six days earlier. Nothing failed. Nothing warned.
#
# WHAT IT CHECKS
#   Only whether origin holds a NEWER measurement than the working copy, which
#   is the one question that matters. Being behind on code is a normal state of
#   affairs and not this script's business.
#
# Exit 0 to proceed, 1 to stop.
set -uo pipefail

REPO="${1:-/mnt/c/Users/miche/Downloads/DOT APP}"
cd "$REPO" || { echo "no repo at $REPO"; exit 1; }

# A fetch failure is NOT a licence to publish: it means the question could not
# be asked, and publishing anyway is precisely the mistake this guards.
if ! git fetch --quiet origin 2>/dev/null; then
  echo "REFUSING: could not reach origin to compare data freshness."
  echo "  Not knowing whether origin is ahead is not the same as it being behind."
  exit 1
fi

stamp_of() {
  # measuredAt out of an ecosystem.json on stdin; 0 when it cannot be read.
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try { console.log(JSON.parse(s).measuredAt ?? 0); } catch { console.log(0); }
  })" 2>/dev/null || echo 0
}

LOCAL_ECO="dotmetrics/src/lib/ecosystem.json"
mine=$(cat "$LOCAL_ECO" 2>/dev/null | stamp_of)
theirs=$(git show "origin/master:$LOCAL_ECO" 2>/dev/null | stamp_of)

# The liveness series, which is the figure a reader actually reads.
day_of() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try { const j=JSON.parse(s); const p=j.series?.[j.series.length-1]; console.log(p ? p.at ?? 0 : 0); }
    catch { console.log(0); }
  })" 2>/dev/null || echo 0
}
LOCAL_LIVE="dotmetrics/src/lib/liveness.json"
mineLive=$(cat "$LOCAL_LIVE" 2>/dev/null | day_of)
theirsLive=$(git show "origin/master:$LOCAL_LIVE" 2>/dev/null | day_of)

behind=0
[ "${theirs:-0}" -gt "${mine:-0}" ] && behind=1
[ "${theirsLive:-0}" -gt "${mineLive:-0}" ] && behind=1

if [ "$behind" -eq 1 ]; then
  echo "REFUSING: origin has a newer measurement than this working copy."
  echo "  vitals   local $(date -u -d "@${mine:-0}" '+%Y-%m-%d %H:%M' 2>/dev/null)  origin $(date -u -d "@${theirs:-0}" '+%Y-%m-%d %H:%M' 2>/dev/null)"
  echo "  liveness local $(date -u -d "@${mineLive:-0}" '+%Y-%m-%d %H:%M' 2>/dev/null)  origin $(date -u -d "@${theirsLive:-0}" '+%Y-%m-%d %H:%M' 2>/dev/null)"
  echo
  echo "  Publishing now would put those older numbers on the live dashboard."
  echo "  Run: git merge origin/master   (then rebuild and publish)"
  exit 1
fi

echo "index data is current with origin"
exit 0
