#!/usr/bin/env bash
set -euo pipefail

: "${SUBSTREAMER_IOS_BUNDLE_IDENTIFIER:?required}"
: "${SUBSTREAMER_IOS_DISPLAY_NAME:?required}"
: "${SUBSTREAMER_IOS_VERSION:?required}"
: "${SUBSTREAMER_IOS_BUILD_NUMBER:?required}"
: "${SUBSTREAMER_IOS_IPA_PATH:?required}"

export SUBSTREAMER_IOS_SIDESTORE=1
npx expo prebuild --clean --platform ios

DERIVED_DATA="${SUBSTREAMER_IOS_DERIVED_DATA:-build/sidestore-derived}"
xcodebuild -quiet -workspace ios/substreamer.xcworkspace -scheme substreamer \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA" CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO COMPILER_INDEX_STORE_ENABLE=NO

APP_PATH="$DERIVED_DATA/Build/Products/Release-iphoneos/substreamer.app"
PLIST="$APP_PATH/Info.plist"
test -d "$APP_PATH"
test -f "$APP_PATH/main.jsbundle"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")" = "$SUBSTREAMER_IOS_BUNDLE_IDENTIFIER"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$PLIST")" = "$SUBSTREAMER_IOS_DISPLAY_NAME"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")" = "$SUBSTREAMER_IOS_VERSION"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST")" = "$SUBSTREAMER_IOS_BUILD_NUMBER"
test "$(find "$APP_PATH" -type d -name '*.appex' | wc -l | tr -d ' ')" = 0

PACKAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$PACKAGE_DIR"' EXIT
mkdir -p "$PACKAGE_DIR/Payload" "$(dirname "$SUBSTREAMER_IOS_IPA_PATH")"
cp -R "$APP_PATH" "$PACKAGE_DIR/Payload/substreamer.app"
(cd "$PACKAGE_DIR" && zip -qry "$SUBSTREAMER_IOS_IPA_PATH" Payload)
unzip -tq "$SUBSTREAMER_IOS_IPA_PATH"
