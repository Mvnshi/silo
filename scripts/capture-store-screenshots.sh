#!/usr/bin/env bash
#
# Capture App Store screenshots at Apple's required 6.9" size (1320 x 2868).
#
# Boots an iPhone 17 Pro Max, installs the current build, and — because a fresh
# install lands in onboarding with an empty library — copies the app's data
# container across from another simulator that is already onboarded and seeded.
# Navigation is by deep link (`simctl openurl`), so no tapping is required and
# the run is reproducible.
#
# Usage:
#   scripts/capture-store-screenshots.sh                       # uses the default source sim
#   SOURCE_UDID=<udid> scripts/capture-store-screenshots.sh    # copy state from a specific sim
#
# IMPORTANT: run this against a **Release** build. A Debug build renders React
# Native's LogBox warning toast over the bottom of the screen, and Apple rejects
# screenshots with development UI in them:
#   npx expo run:ios --configuration Release --device "iPhone 17 Pro Max"
set -euo pipefail

DEVICE_NAME="${DEVICE_NAME:-iPhone 17 Pro Max}"
BUNDLE_ID="${BUNDLE_ID:-com.silo.app}"
OUT_DIR="${OUT_DIR:-docs/store}"
SOURCE_UDID="${SOURCE_UDID:-}"

udid_for() {
  xcrun simctl list devices available \
    | grep -F "$1 (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'
}

MAX_UDID="$(udid_for "$DEVICE_NAME")"
if [ -z "$MAX_UDID" ]; then
  echo "No '$DEVICE_NAME' simulator found. Create one in Xcode → Devices." >&2
  exit 1
fi

echo "▸ booting $DEVICE_NAME ($MAX_UDID)"
xcrun simctl boot "$MAX_UDID" 2>/dev/null || true
until xcrun simctl list devices | grep -q "$MAX_UDID) (Booted)"; do sleep 2; done

APP_PATH="$(find ~/Library/Developer/Xcode/DerivedData -maxdepth 5 -name 'Silo.app' \
  -path '*iphonesimulator*' -print -quit 2>/dev/null || true)"
if [ -n "$APP_PATH" ]; then
  echo "▸ installing $APP_PATH"
  xcrun simctl install "$MAX_UDID" "$APP_PATH"
fi

xcrun simctl privacy "$MAX_UDID" grant calendar "$BUNDLE_ID" 2>/dev/null || true

# Onboarding + an empty library make for useless screenshots. Lift the state
# from a simulator that already has both.
if [ -n "$SOURCE_UDID" ]; then
  echo "▸ copying app state from $SOURCE_UDID"
  xcrun simctl terminate "$SOURCE_UDID" "$BUNDLE_ID" 2>/dev/null || true
  xcrun simctl terminate "$MAX_UDID" "$BUNDLE_ID" 2>/dev/null || true
  sleep 2
  SRC="$(xcrun simctl get_app_container "$SOURCE_UDID" "$BUNDLE_ID" data)"
  DST="$(xcrun simctl get_app_container "$MAX_UDID" "$BUNDLE_ID" data)"
  rsync -a --delete "$SRC/Library/" "$DST/Library/"
fi

mkdir -p "$OUT_DIR"
xcrun simctl launch "$MAX_UDID" "$BUNDLE_ID" >/dev/null
echo "▸ waiting for first render"
sleep 25

# Navigation is NOT automated, and cannot be: `simctl openurl` raises iOS's
# "Open in Silo?" confirmation sheet (the URL comes from SpringBoard, not the
# app), and simctl has no tap primitive. Every deep-linked capture therefore
# photographs that dialog instead of the screen you wanted.
#
# So this script automates the fiddly half — right device, right size, seeded
# library, onboarding already past — and you drive the five screens by hand,
# calling `shoot` after each. Attach the simulator panel and tap through:
#
#   1-today        Silo tab → Today, with a fired trigger visible
#   2-stacks       Stacks
#   3-your-silo    the avatar → Your Silo
#   4-calendar     Silo tab → Calendar
#   5-map          Silo tab → Map
shoot() {
  local name="${1:?usage: shoot <name>}"
  xcrun simctl io "$MAX_UDID" screenshot "$OUT_DIR/$name.png" >/dev/null 2>&1
  echo "  ✓ $OUT_DIR/$name.png  ($(sips -g pixelWidth -g pixelHeight "$OUT_DIR/$name.png" | tail -2 | tr -d ' \n' | sed 's/pixelWidth:/ /;s/pixelHeight:/x/'))"
}

if [ "${1:-}" = "shoot" ]; then
  shift
  shoot "$@"
  exit 0
fi

cat <<EOF

▸ ready. The simulator is booted, seeded and past onboarding.

  Navigate to each screen, then capture it:
      scripts/capture-store-screenshots.sh shoot 1-today

  Screens to capture: 1-today · 2-stacks · 3-your-silo · 4-calendar · 5-map

EOF
