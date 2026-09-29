#!/usr/bin/env bash
# Cache-busting for GitHub Pages (which lets browsers cache every file for 10 minutes; the Quest
# browser in particular holds on to old modules/textures). Run in CI just before upload:
#   bash tools/stamp_version.sh "$SHORT_SHA"
# Appends ?v=<version> to every relative module import, importmap entry, script tag and texture
# path ("./x.js", "./assets/x.jpg", ...) in index.html and src/**/*.js, so every deploy fetches
# fresh files. All URLs get the same version, so each module is still loaded exactly once.
# It edits the working copy only; nothing is committed. Safe to run twice (already-stamped URLs
# contain "?" and no longer match).
set -euo pipefail
V="${1:?usage: stamp_version.sh VERSION}"
cd "$(dirname "$0")/.."
export V
files=$(ls index.html; find src -name '*.js')
# shellcheck disable=SC2086
perl -0pi -e 's{([\x27"`])(\./[\w./-]+\.(?:m?js|jpg|jpeg|png|webp|json))\1}{$1$2?v=$ENV{V}$1}g' $files
# a small build tag so you can see which deploy you are on (desktop / phone)
perl -0pi -e 's{</body>}{  <div id="build" style="position:fixed;right:8px;bottom:6px;opacity:.35;font:11px monospace;pointer-events:none">build $ENV{V}</div>\n</body>}' index.html
echo "stamped $V"
