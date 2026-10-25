#!/usr/bin/env bash
# Builds "NotesGraph Capture.app": a macOS launcher with the capture icon that
# opens the desktop app's capture window (notesgraph://capture). Pin it to the
# Dock or open it from Spotlight.
#
#   scripts/make-capture-launcher.sh [protocol] [destination]
#
# protocol: notesgraph (stable, default), notesgraph-beta, notesgraph-canary,
#           notesgraph-internal or notesgraph-dev
# destination: folder the app goes in, ~/Applications by default
set -euo pipefail

protocol="${1:-notesgraph}"
dest="${2:-$HOME/Applications}"
here="$(cd "$(dirname "$0")" && pwd)"
icon="$here/../resources/icons/icon_capture.png"
app="$dest/NotesGraph Capture.app"

if [[ "$(uname)" != Darwin ]]; then
  echo "This builds a macOS app; on Windows and Linux use the tray menu or Control+Alt+Space." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

iconset="$work/capture.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$icon" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$icon" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
iconutil -c icns "$iconset" -o "$app/Contents/Resources/capture.icns"

cat > "$app/Contents/MacOS/capture" <<EOF
#!/bin/sh
exec /usr/bin/open "${protocol}://capture"
EOF
chmod +x "$app/Contents/MacOS/capture"

cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>NotesGraph Capture</string>
  <key>CFBundleDisplayName</key>
  <string>NotesGraph Capture</string>
  <key>CFBundleIdentifier</key>
  <string>app.notesgraph.capture-launcher</string>
  <key>CFBundleExecutable</key>
  <string>capture</string>
  <key>CFBundleIconFile</key>
  <string>capture</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
EOF

echo "Made $app (opens ${protocol}://capture)"
