#!/usr/bin/env bash
#
# Build local native modules that require a compile step.
#
# Usage:
#   scripts/build-modules.sh          # build all modules
#   scripts/build-modules.sh rntp     # build only react-native-track-player
#
# The built output (lib/) is committed to the repo so that `npm install`
# does not need to run a build step.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

build_rntp() {
  echo "==> Building react-native-track-player (TypeScript → lib/)"
  cd "$REPO_ROOT/modules/react-native-track-player"
  npx react-native-builder-bob build
  echo "    Done. lib/ updated."
}

# expo-ssl-trust does not need a build step — its main points to src/index.ts
# and Expo handles the transpilation at build time.

if [[ $# -eq 0 ]]; then
  build_rntp
  echo ""
  echo "All modules built successfully."
elif [[ "$1" == "rntp" ]]; then
  build_rntp
else
  echo "Unknown module: $1"
  echo "Available modules: rntp"
  exit 1
fi
