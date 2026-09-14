---
name: deploy-android-apk
description: Build the NotesGraph Android APK and publish it to the notesgraph.com download page. Use when asked to build/rebuild/redeploy/ship the Android app or update the downloadable APK. Encodes the channel + verification gotchas that caused wrong-server bugs.
---

# Build & deploy the NotesGraph Android APK

The download page serves `notesgraph.com/download/notesgraph-0.26.3-android.apk`.
The self-hosted server is `app.notesgraph.com`, which is the **stable** channel URL,
so you almost always want a **stable** build.

## Critical gotchas (these caused real bugs)

1. **`BUILD_TYPE` must be `export`ed, not an inline prefix.** In multi-line/background
   commands the inline `BUILD_TYPE=stable yarn ...` prefix does NOT reach the bundler,
   which then defaults to **canary** (`process.env.BUILD_TYPE ?? 'canary'` in
   `tools/cli/src/rspack/index.ts`). A canary build points the app at
   `canary.notesgraph.com` → login/preflight fails. Always `export BUILD_TYPE=stable`.
2. **Verify the channel inside the APK bytes, not with a loose grep.** A grep for
   `app.notesgraph.com` matches `apple.notesgraph.com` (iOS) and the dead
   telemetry endpoint. Unzip the APK and check the real server config.
3. **The channel is dead-code-eliminated**: a stable APK contains only
   `baseUrl:"https://app.notesgraph.com"` and **zero** `canary` baseUrl.
4. **SSH IP rotates** (cellular/CGNAT). If SSH times out, re-authorize:
   `MYIP=$(curl -s https://checkip.amazonaws.com); aws ec2 authorize-security-group-ingress --group-id sg-0802d2901b2f1a5b6 --protocol tcp --port 22 --cidr "$MYIP/32" --region us-east-2`

## Steps

```bash
# 1. BUILD — web bundle -> prune -> capacitor sync -> gradle, all in one call.
#    scripts/build-android.sh is allowlisted and encapsulates the env
#    (JAVA_HOME/ANDROID_HOME/PATH) and `export BUILD_TYPE` for you. It uses
#    `yarn notesgraph bundle -p @notesgraph/android` — do NOT use
#    `yarn notesgraph @notesgraph/android build`, which is BROKEN (the repo CLI
#    chokes on the `&&` inside that package script).
scripts/build-android.sh                       # stable (app.notesgraph.com)
# BUILD_TYPE=canary scripts/build-android.sh   # canary channel
# Long build: run detached (Bash run_in_background) + a Monitor grepping
# `==>|BUILD SUCCESSFUL|BUILD FAILED|for \[.*\] channel|done:`. Confirm the log
# said "Building [@notesgraph/android] for [stable] channel".

# 2. VERIFY the actual APK bytes (the reliable gate)
APK=packages/frontend/apps/android/App/app/build/outputs/apk/stable/debug/app-stable-debug.apk
unzip -p "$APK" 'assets/public/js/*.js' | grep -oh 'baseUrl:"https://[a-z.]*notesgraph.com"' | sort -u   # expect only app.notesgraph.com
unzip -p "$APK" 'assets/public/js/*.js' | grep -c 'baseUrl:"https://canary.notesgraph.com"'              # expect 0

# 3. upload (backup + atomic swap; keeps a .prev). Needs SSH to the box — if it
#    times out, the IP allowlist rotated: re-authorize (gotcha #4), and if `aws`
#    says the session expired, the user must run `aws login` first.
KEY=~/.ssh/notesgraph-prod.pem; H=ubuntu@18.225.203.37; D=/opt/notesgraph/landing/download
scp -i $KEY "$APK" "$H:$D/notesgraph-0.26.3-android.apk.new"
ssh -i $KEY $H "cp -f $D/notesgraph-0.26.3-android.apk $D/notesgraph-0.26.3-android.apk.prev 2>/dev/null; mv -f $D/notesgraph-0.26.3-android.apk.new $D/notesgraph-0.26.3-android.apk && chmod 644 $D/notesgraph-0.26.3-android.apk"

# 4. confirm served (cache-bust — client/browser caches downloads hard)
curl -sI "https://notesgraph.com/download/notesgraph-0.26.3-android.apk?v=$RANDOM" | grep -iE "HTTP/|content-length|last-modified"
```

## Install note for the user

All flavors share appId `app.notesgraph.pro`, so a new install replaces the old.
Tell them to **uninstall first**, then download fresh with a cache-buster
(`...apk?v=fresh`). Data re-syncs from the server on sign-in.

To visually confirm the build before/after shipping, use the `test-mobile-emulator` skill.
