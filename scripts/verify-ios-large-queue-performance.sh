#!/usr/bin/env bash
#
# Runs the RNQP iOS regression test for the 1,500-item gapless-queue stall.
# The test uses synthetic file:// AVPlayerItems: no server, credentials, or
# copyrighted audio fixture is required.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE_PLAYER_ROOT="$REPO_ROOT/node_modules/react-native-queue-player"
HARNESS_ROOT="$QUEUE_PLAYER_ROOT/ios/tests-harness"

if [[ ! -d "$HARNESS_ROOT" ]]; then
  echo "react-native-queue-player test harness not found. Run npm install first."
  exit 1
fi

SIMULATOR_UDID="${IOS_SIMULATOR_UDID:-}"
if [[ -z "$SIMULATOR_UDID" ]]; then
  SIMULATOR_UDID="$({ xcrun simctl list devices booted -j || true; } | /usr/bin/python3 -c '
import json, sys
payload = json.load(sys.stdin)
for runtime in payload.get("devices", {}).values():
    for device in runtime:
        if device.get("state") == "Booted":
            print(device["udid"])
            raise SystemExit(0)
')"
fi

if [[ -z "$SIMULATOR_UDID" ]]; then
  echo "No booted iOS Simulator found. Boot one or set IOS_SIMULATOR_UDID."
  exit 1
fi

# The published package hoists its development dependencies into the app's
# node_modules. The standalone CocoaPods harness expects them below the package
# root, so provide a local symlink on first run.
if [[ ! -e "$QUEUE_PLAYER_ROOT/node_modules" ]]; then
  ln -s "$REPO_ROOT/node_modules" "$QUEUE_PLAYER_ROOT/node_modules"
fi

if [[ ! -d "$HARNESS_ROOT/TestHost.xcworkspace" ]]; then
  echo "Preparing QueuePlayer XCTest harness..."
  (
    cd "$HARNESS_ROOT"
    pod install --silent
  )
fi

export GIT_CEILING_DIRECTORIES="$REPO_ROOT"

echo "Running large-queue responsiveness test on Simulator $SIMULATOR_UDID..."
xcodebuild test -quiet \
  -workspace "$HARNESS_ROOT/TestHost.xcworkspace" \
  -scheme QueuePlayer-Unit-Tests \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -only-testing:QueuePlayer-Unit-Tests/NativeQueueWindowTests \
  CODE_SIGNING_ALLOWED=NO

echo "Large-queue responsiveness test passed."
