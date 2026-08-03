#!/usr/bin/env sh
# There is no build. The app is one static file; this only stages it where the
# publisher expects to find a directory. Keeping the source OUT of dist/ matters
# because dist/ is gitignored — the first version of this app was untracked
# without anyone noticing.
set -eu
cd "$(dirname "$0")"
mkdir -p dist
cp index.html dist/index.html
echo "chirpwatch: staged dist/index.html ($(wc -c < index.html) bytes)"
