---
name: test-mobile-emulator
description: Run and visually verify the NotesGraph mobile (Android) app in a local emulator VM — no device needed. Use when a mobile UI change needs confirmation, when told "test it on a VM/emulator", or before/after shipping an APK. Screenshots let you actually see the UI instead of guessing.
---

# Test the mobile app in an Android emulator

Wraps `scripts/mobile-emulator.sh`. Requires the SDK from `scripts/install-android-deps.sh`
(macOS / Apple Silicon → arm64 system image).

## Flow

```bash
scripts/mobile-emulator.sh up        # install emulator+image (first run ~1GB) + create AVD + boot headless
scripts/mobile-emulator.sh install   # install the last-built stable APK + launch it
scripts/mobile-emulator.sh shot /tmp/s.png   # screenshot -> Read it to see the UI
scripts/mobile-emulator.sh url       # print the WebView's current route/URL
scripts/mobile-emulator.sh down      # stop the emulator when done
```

After `shot`, **Read the PNG** to inspect the UI. Drive the app with adb:
`adb shell input tap X Y`, `adb shell input swipe X1 Y1 X2 Y2`,
`adb shell am start -n app.notesgraph.pro/.MainActivity`.

## Key facts

- The app **auto-creates a local workspace** on first launch — you can see the whole
  UI/sidebar **without logging in**.
- It **opens to the `/all` tab** (docs grid: Docs/Collections/Tags). The navigation
  sidebar (Favorites, Projects, Notes, Organize, Collections, Tags) is on the
  **`/home` tab** — the **leftmost bottom icon**. Tap it (≈ `input tap 150 2280`) or
  navigate before looking for sidebar sections.
- Confirm the build's server with `scripts/mobile-emulator.sh url` — it should show
  `https://localhost/workspace/<id>/...` (localhost is just the Capacitor WebView
  origin; the *API* server is baked in — verify that with the `deploy-android-apk` skill).
- WebView JS console shows up in `adb logcat | grep -i "Capacitor/Console"`.
- The emulator is a long-lived background process; `adb devices` shows `emulator-5554`.

## Verifying a specific change

1. Build the APK (see `deploy-android-apk` skill) or point `NG_APK=<path>`.
2. `up` → `install` → navigate to the affected screen → `shot` → Read the screenshot.
3. Compare against the expectation; if wrong, iterate on the source and rebuild.
